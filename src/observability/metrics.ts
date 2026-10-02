import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';
import { getPool } from '../db/pools.js';
import { writeFileSync, appendFileSync } from 'node:fs';

const register = new Registry();
collectDefaultMetrics({ register, prefix: 'nodejs_' });

export const reservationsConfirmedTotal = new Counter({
  name: 'reservations_confirmed_total',
  help: 'Total new reservations confirmed',
  labelNames: ['show_id'],
  registers: [register],
});

export const reservationsDeclinedTotal = new Counter({
  name: 'reservations_declined_total',
  help: 'Total reservations declined by reason',
  labelNames: ['show_id', 'reason'],
  registers: [register],
});

export const reservationsCancelledTotal = new Counter({
  name: 'reservations_cancelled_total',
  help: 'Total reservations cancelled',
  labelNames: ['show_id'],
  registers: [register],
});

export const seatsConfirmedTotal = new Counter({
  name: 'seats_confirmed_total',
  help: 'Total seat units confirmed',
  labelNames: ['show_id'],
  registers: [register],
});

export const seatsCancelledTotal = new Counter({
  name: 'seats_cancelled_total',
  help: 'Total seat units cancelled',
  labelNames: ['show_id'],
  registers: [register],
});

export const seatsAvailable = new Gauge({
  name: 'seats_available',
  help: 'Current available seats per show',
  labelNames: ['show_id'],
  registers: [register],
});

export const seatsHeld = new Gauge({
  name: 'seats_held',
  help: 'Current held seats per show',
  labelNames: ['show_id'],
  registers: [register],
});

export const seatsConfirmed = new Gauge({
  name: 'seats_confirmed',
  help: 'Current confirmed seats per show',
  labelNames: ['show_id'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const http5xxTotal = new Counter({
  name: 'http_5xx_total',
  help: 'Total 5xx responses',
  labelNames: ['route'],
  registers: [register],
});

export const dbRetriesTotal = new Counter({
  name: 'db_retries_total',
  help: 'Total DB retry attempts',
  labelNames: ['reason'],
  registers: [register],
});

export const reserveQueueDepth = new Gauge({
  name: 'reserve_queue_depth',
  help: 'Current write lane queue depth',
  registers: [register],
});

export const reserveInflight = new Gauge({
  name: 'reserve_inflight',
  help: 'Current write lane in-flight requests',
  registers: [register],
});

export const dbPoolCheckedOut = new Gauge({
  name: 'db_pool_checked_out',
  help: 'Checked out connections per pool',
  labelNames: ['pool'],
  registers: [register],
});

export const dbPoolIdle = new Gauge({
  name: 'db_pool_idle',
  help: 'Idle connections per pool',
  labelNames: ['pool'],
  registers: [register],
});

export const cleanupJobDuration = new Histogram({
  name: 'cleanup_job_duration_seconds',
  help: 'Cleanup job duration',
  labelNames: ['job_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  registers: [register],
});

export const REASONS = ['seat_taken', 'per_user_limit', 'idempotent_replay', 'idempotency_conflict', 'seat_not_found', 'invalid_body'];

export function initMetricsForShow(showId: string): void {
  reservationsConfirmedTotal.inc({ show_id: showId }, 0);
  for (const reason of REASONS) {
    reservationsDeclinedTotal.inc({ show_id: showId, reason }, 0);
  }
  reservationsCancelledTotal.inc({ show_id: showId }, 0);
  seatsConfirmedTotal.inc({ show_id: showId }, 0);
  seatsCancelledTotal.inc({ show_id: showId }, 0);
  seatsAvailable.set({ show_id: showId }, 0);
  seatsHeld.set({ show_id: showId }, 0);
  seatsConfirmed.set({ show_id: showId }, 0);
}

let gaugesCache: { data: string; expires: number } | null = null;
const GAUGE_CACHE_TTL = 1000;

export async function updateSeatGauges(): Promise<void> {
  try {
    const pool = getPool('ops');
    const result = await pool.query(
      `SELECT show_id, status, COUNT(*) as cnt
       FROM seats
       GROUP BY show_id, status`
    );
    for (const row of result.rows) {
      const showId = row.show_id;
      const status = row.status;
      const count = Number(row.cnt);
      if (status === 'available') seatsAvailable.set({ show_id: showId }, count);
      else if (status === 'held') seatsHeld.set({ show_id: showId }, count);
      else if (status === 'confirmed') seatsConfirmed.set({ show_id: showId }, count);
    }
  } catch (err) {
    console.error({ err }, 'Failed to update seat gauges');
  }
}

export async function getMetrics(): Promise<string> {
  const now = Date.now();
  if (process.env.NODE_ENV === 'test') {
    // Disable cache in tests
    await updateSeatGauges();
    return register.metrics();
  }
  if (gaugesCache && gaugesCache.expires > now) {
    return gaugesCache.data;
  }
  await updateSeatGauges();
  const data = await register.metrics();
  gaugesCache = { data, expires: now + GAUGE_CACHE_TTL };
  return data;
}

export async function metricsRoutes(app: any): Promise<void> {
  app.get('/metrics', async (_request: any, reply: any) => {
    const metrics = await getMetrics();
    reply.header('Content-Type', register.contentType);
    return metrics;
  });
}

// Metrics log file path
const METRICS_LOG_FILE = process.env.METRICS_LOG_FILE || 'metrics.log';
const METRICS_LOG_INTERVAL_MS = parseInt(process.env.METRICS_LOG_INTERVAL_MS || '30000', 10);
let metricsLogInterval: NodeJS.Timeout | null = null;

export function startMetricsLogging(): void {
  if (metricsLogInterval) return;
  
  // Write initial header
  const header = `# Metrics log started at ${new Date().toISOString()}\n`;
  writeFileSync(METRICS_LOG_FILE, header);
  
  metricsLogInterval = setInterval(async () => {
    try {
      const metrics = await getMetrics();
      const timestamp = new Date().toISOString();
      // Parse key metrics from Prometheus format
      const lines = metrics.split('\n');
      const summary: Record<string, number> = {};
      
      for (const line of lines) {
        if (line.startsWith('#') || !line.trim()) continue;
        const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\{([^}]*)\}\s+([\d.]+)/);
        if (match) {
          const [, name, labels, value] = match;
          const key = `${name}{${labels}}`;
          summary[key] = parseFloat(value);
        }
      }
      
      const logEntry = {
        timestamp,
        metrics: summary,
      };
      
      appendFileSync(METRICS_LOG_FILE, JSON.stringify(logEntry) + '\n');
    } catch (err) {
      console.error('Failed to write metrics log:', err);
    }
  }, METRICS_LOG_INTERVAL_MS);
  
  metricsLogInterval.unref(); // Don't prevent process exit
}

export function stopMetricsLogging(): void {
  if (metricsLogInterval) {
    clearInterval(metricsLogInterval);
    metricsLogInterval = null;
  }
}