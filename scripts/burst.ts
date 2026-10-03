#!/usr/bin/env node
import * as undici from 'undici';
import { createHash, randomUUID, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';

interface Config {
  baseUrl: string;
  adminToken: string;
  jwtSecret: string;
  users: number;
  requests: number;
  hotSeats: string[];
  retryRate: number;
  concurrency: number;
  seatsPerRequest: number;
  timeoutMs: number;
  jsonOut?: string;
}

interface TokenResponse {
  token: string;
  expires_in: number;
}

interface ShowResponse {
  id: string;
  name: string;
  price_paise: number;
  per_user_limit: number;
  total_seats: number;
  available: number;
  held: number;
  confirmed: number;
  seats?: Array<{ label: string; status: string }>;
}

interface ReserveResponse {
  reservation_id: string;
  show_id: string;
  user_id: string;
  seats: string[];
  amount_paise: number;
  status: 'confirmed' | 'cancelled';
}

interface BurstResult {
  summary: {
    total_requests: number;
    status_201: number;
    status_201_new: number;
    status_201_replay: number;
    status_409: number;
    status_409_by_code: Record<string, number>;
    status_5xx: number;
    client_timeouts: number;
    latency_ms: { p50: number; p95: number; p99: number };
  };
  hot_seat_winners: Record<string, string>;
  invariant_check: { passed: boolean; show_id: string; total_seats: number; available: number; held: number; confirmed: number };
  metrics_reconciliation: { passed: boolean; expected_201: number; actual_201: number };
  exit_code: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Partial<Config> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--base-url':
        config.baseUrl = args[++i];
        break;
      case '--admin-token':
        config.adminToken = args[++i];
        break;
      case '--jwt-secret':
        config.jwtSecret = args[++i];
        break;
      case '--users':
        config.users = parseInt(args[++i], 10);
        break;
      case '--requests':
        config.requests = parseInt(args[++i], 10);
        break;
      case '--hot-seats':
        config.hotSeats = args[++i].split(',').map(s => s.trim());
        break;
      case '--retry-rate':
        config.retryRate = parseFloat(args[++i]);
        break;
      case '--concurrency':
        config.concurrency = parseInt(args[++i], 10);
        break;
      case '--seats-per-request':
        config.seatsPerRequest = parseInt(args[++i], 10);
        break;
      case '--timeout-ms':
        config.timeoutMs = parseInt(args[++i], 10);
        break;
      case '--json-out':
        config.jsonOut = args[++i];
        break;
    }
  }

  // Defaults
  config.baseUrl ??= '';
  config.adminToken ??= '';
  config.jwtSecret ??= '';
  config.users ??= 5000;
  config.requests ??= 20000;
  config.hotSeats ??= ['A12'];
  config.retryRate ??= 0.15;
  config.concurrency ??= 1000;
  config.seatsPerRequest ??= 1;
  config.timeoutMs ??= 30000;

  if (!config.baseUrl || !config.adminToken || !config.jwtSecret) {
    console.error('Missing required arguments: --base-url, --admin-token, --jwt-secret');
    process.exit(1);
  }

  return config as Config;
}

function generateJwt(payload: object, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 86400 };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const hmac = createHmac('sha256', secret);
  hmac.update(signingInput);
  const signature = hmac.digest('base64url');

  return `${signingInput}.${signature}`;
}

async function mintTokens(baseUrl: string, jwtSecret: string, userIds: string[]): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();

  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    for (const userId of userIds) {
      tokens.set(userId, generateJwt({ sub: userId }, jwtSecret));
    }
  } else {
    const pool = new undici.Pool(baseUrl, { connections: Math.min(userIds.length, 100) });
    try {
      await Promise.all(userIds.map(async (userId) => {
        const resp = await pool.request({
          path: '/auth/token',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        });
        const data = await resp.body.json() as TokenResponse;
        tokens.set(userId, data.token);
      }));
    } finally {
      await pool.close();
    }
  }
  return tokens;
}

async function createShow(baseUrl: string, adminToken: string, hotSeats: string[], seatsPerRequest: number): Promise<string> {
  const allSeats = [...hotSeats];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 1000; i++) {
    const label = `${letters[i % 26]}${Math.floor(i / 26) + 1}`;
    if (!allSeats.includes(label)) allSeats.push(label);
  }

  const resp = await fetch(`${baseUrl}/shows`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Admin-Token': adminToken,
    },
    body: JSON.stringify({
      name: `burst-${Date.now()}`,
      seats: allSeats,
      price_paise: 25000,
      per_user_limit: 4,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create show: ${resp.status} ${text}`);
  }

  const show = await resp.json() as ShowResponse;
  return show.id;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const config = parseArgs();

  console.log('=== Burst Test Starting ===');
  console.log(`Target: ${config.baseUrl}`);
  console.log(`Users: ${config.users}, Requests: ${config.requests}`);
  console.log(`Hot seats: ${config.hotSeats.join(', ')}`);
  console.log(`Retry rate: ${config.retryRate}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log('');

  const userIds = Array.from({ length: config.users }, (_, i) => `user_${i + 1}`);

  console.log('Minting tokens...');
  const tokens = await mintTokens(config.baseUrl, config.jwtSecret, userIds);
  console.log(`Minted ${tokens.size} tokens`);

  console.log('Creating show...');
  const showId = await createShow(config.baseUrl, config.adminToken, config.hotSeats, config.seatsPerRequest);
  console.log(`Show created: ${showId}`);

  const pool = new undici.Pool(config.baseUrl, { connections: config.concurrency });

  const latencies: number[] = [];
  const results: Map<string, { status: number; code?: string; isReplay: boolean }> = new Map();
  const hotSeatWinners = new Map<string, string>();
  let clientTimeouts = 0;
  let completed = 0;
  let status201 = 0;
  let status201New = 0;
  let status201Replay = 0;
  let status409 = 0;
  const status409ByCode: Record<string, number> = {};
  let status5xx = 0;

  const semaphore = new Array(config.concurrency).fill(0).map((_, i) => i);
  let semaphoreIndex = 0;

  async function acquireSemaphore(): Promise<void> {
    while (semaphoreIndex >= config.concurrency) {
      await sleep(1);
    }
    semaphoreIndex++;
  }

  function releaseSemaphore(): void {
    semaphoreIndex--;
  }

  const idempotencyKeys = new Map<string, string>();
  for (const userId of userIds) {
    idempotencyKeys.set(userId, `idem-${userId}-${randomUUID()}`);
  }

  console.log('Starting burst...');
  const startTime = Date.now();

  const requests = Array.from({ length: config.requests }, (_, i) => i);

  await Promise.all(requests.map(async (reqIndex) => {
    await acquireSemaphore();

    const userId = userIds[reqIndex % config.users];
    const token = tokens.get(userId)!;
    const idemKey = idempotencyKeys.get(userId)!;

    let seats: string[];
    if (Math.random() < 0.7) {
      const hotSeat = config.hotSeats[reqIndex % config.hotSeats.length];
      seats = [hotSeat];
    } else {
      const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const num = Math.floor(Math.random() * 100) + 1;
      seats = [`${letter}${num}`];
    }

    const isRetry = Math.random() < config.retryRate;
    const requestIdemKey = isRetry ? idemKey : `idem-${userId}-${randomUUID()}`;

    const requestStart = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

      const resp = await fetch(`${config.baseUrl}/shows/${showId}/reserve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': requestIdemKey,
        },
        body: JSON.stringify({ seats }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - requestStart;
      latencies.push(latency);

      const status = resp.status;
      let code: string | undefined;
      let isReplay = false;

      if (status === 201) {
        const data = await resp.json() as ReserveResponse;
        status201++;
        if (isRetry) {
          status201Replay++;
          isReplay = true;
        } else {
          status201New++;
        }
        if (config.hotSeats.includes(seats[0]) && !hotSeatWinners.has(seats[0])) {
          hotSeatWinners.set(seats[0], userId);
        }
      } else if (status === 409) {
        status409++;
        const data = await resp.json() as { code?: string };
        code = data.code;
        status409ByCode[code || 'UNKNOWN'] = (status409ByCode[code || 'UNKNOWN'] || 0) + 1;
      } else if (status >= 500) {
        status5xx++;
      }

      results.set(`${reqIndex}-${userId}`, { status, code, isReplay });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        clientTimeouts++;
      }
    } finally {
      releaseSemaphore();
      completed++;
      if (completed % 1000 === 0) {
        console.log(`Progress: ${completed}/${config.requests}`);
      }
    }
  }));

  const totalTime = Date.now() - startTime;
  console.log(`Burst completed in ${totalTime}ms`);

  console.log('Polling health and show state...');
  const healthResp = await fetch(`${config.baseUrl}/health/ready`);
  const healthStatus = healthResp.status;

  const showResp = await fetch(`${config.baseUrl}/shows/${showId}?include_seats=false`);
  const showData = await showResp.json() as ShowResponse;

  const totalSeats = showData.total_seats;
  const available = showData.available;
  const held = showData.held;
  const confirmed = showData.confirmed;
  const invariantPassed = (available + held + confirmed) === totalSeats;

  let hotSeatWinnerCount = 0;
  for (const seat of config.hotSeats) {
    if (hotSeatWinners.has(seat)) hotSeatWinnerCount++;
  }

  const metricsResp = await fetch(`${config.baseUrl}/metrics`);
  const metricsText = await metricsResp.text();

  let confirmedTotal = 0;
  let replayTotal = 0;
  for (const line of metricsText.split('\n')) {
    if (line.startsWith('reservations_confirmed_total{show_id="') && line.includes(showId)) {
      const match = line.match(/reservations_confirmed_total\{show_id="[^"]+"\} (\d+)/);
      if (match) confirmedTotal = parseInt(match[1], 10);
    }
    if (line.startsWith('reservations_declined_total{show_id="') && line.includes('reason="idempotent_replay"') && line.includes(showId)) {
      const match = line.match(/reservations_declined_total\{show_id="[^"]+",reason="idempotent_replay"\} (\d+)/);
      if (match) replayTotal = parseInt(match[1], 10);
    }
  }

  const expected201 = confirmedTotal + replayTotal;
  const actual201 = status201;
  const metricsReconciled = expected201 === actual201;

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  let exitCode = 0;
  const failures: string[] = [];

  if (status5xx > 0) {
    failures.push(`${status5xx} 5xx errors`);
    exitCode = 1;
  }
  if (clientTimeouts > 0) {
    failures.push(`${clientTimeouts} client timeouts`);
    exitCode = 1;
  }
  if (hotSeatWinnerCount !== config.hotSeats.length) {
    failures.push(`Hot seat winners: ${hotSeatWinnerCount}/${config.hotSeats.length} (expected exactly 1 per hot seat)`);
    exitCode = 1;
  }
  if (!invariantPassed) {
    failures.push(`Invariant violated: available+held+confirmed=${available+held+confirmed} != total=${totalSeats}`);
    exitCode = 1;
  }
  if (!metricsReconciled) {
    failures.push(`Metrics reconciliation failed: expected 201=${expected201}, actual=${actual201}`);
    exitCode = 1;
  }
  if (healthStatus !== 200) {
    failures.push(`Health ready returned ${healthStatus} during burst`);
    exitCode = 1;
  }

  const result: BurstResult = {
    summary: {
      total_requests: config.requests,
      status_201: status201,
      status_201_new: status201New,
      status_201_replay: status201Replay,
      status_409: status409,
      status_409_by_code: status409ByCode,
      status_5xx: status5xx,
      client_timeouts: clientTimeouts,
      latency_ms: { p50, p95, p99 },
    },
    hot_seat_winners: Object.fromEntries(hotSeatWinners),
    invariant_check: {
      passed: invariantPassed,
      show_id: showId,
      total_seats: totalSeats,
      available,
      held,
      confirmed,
    },
    metrics_reconciliation: {
      passed: metricsReconciled,
      expected_201: expected201,
      actual_201: actual201,
    },
    exit_code: exitCode,
  };

  if (config.jsonOut) {
    writeFileSync(config.jsonOut, JSON.stringify(result, null, 2));
  }

  console.log('');
  console.log('=== BURST TEST SUMMARY ===');
  console.log(`Total requests: ${config.requests}`);
  console.log(`201 (new): ${status201New}`);
  console.log(`201 (replay): ${status201Replay}`);
  console.log(`409: ${status409}`);
  for (const [code, count] of Object.entries(status409ByCode)) {
    console.log(`  ${code}: ${count}`);
  }
  console.log(`5xx: ${status5xx}`);
  console.log(`Client timeouts: ${clientTimeouts}`);
  console.log(`Latency p50: ${p50}ms, p95: ${p95}ms, p99: ${p99}ms`);
  console.log('');
  console.log('Hot seat winners:');
  for (const [seat, winner] of hotSeatWinners) {
    console.log(`  ${seat}: ${winner}`);
  }
  console.log('');
  console.log('Invariant check:', invariantPassed ? 'PASSED' : 'FAILED');
  console.log(`  available=${available}, held=${held}, confirmed=${confirmed}, total=${totalSeats}`);
  console.log('');
  console.log('Metrics reconciliation:', metricsReconciled ? 'PASSED' : 'FAILED');
  console.log(`  Expected 201: ${expected201}, Actual: ${actual201}`);
  console.log('');
  console.log('Health ready:', healthStatus === 200 ? 'OK' : `FAILED (${healthStatus})`);

  if (failures.length > 0) {
    console.log('');
    console.log('FAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
  }

  await pool.close();

  process.exit(exitCode);
}

main().catch(err => {
  console.error('Burst test failed:', err);
  process.exit(1);
});