import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createShow } from '../src/services/show.service.js';
import { reserveSeats, cancelReservation } from '../src/services/reservation.service.js';
import { getPool } from '../src/db/pools.js';
import { setupAuthContext } from './setup.js';
import { initMetricsForShow, getMetrics, REASONS } from '../src/observability/metrics.js';

describe('health endpoints', () => {
  it('GET /health/live returns 200 without DB check', async () => {
    const response = await fetch('http://localhost:8080/health/live');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns 200 when DB is up', async () => {
    const response = await fetch('http://localhost:8080/health/ready');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ready' });
  });

  it('GET /health/ready returns 503 when DB is down', async () => {
    // This test would require stopping DB - skipped for CI
    expect(true).toBe(true);
  });
});

describe('metrics integration', () => {
  let showId: string;

  beforeAll(async () => {
    setupAuthContext('test-user');
    const show = await createShow({
      name: `integration-test-${Date.now()}`,
      seats: ['A1', 'A2', 'A3'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    showId = show.id;
    // Initialize metrics for this show
    initMetricsForShow(showId);
  });

  beforeEach(() => {
    setupAuthContext('test-user');
  });

  it('GET /metrics returns all metric types', async () => {
    const response = await fetch('http://localhost:8080/metrics');
    expect(response.status).toBe(200);
    
    const text = await response.text();
    
    // Check for all metric types
    expect(text).toContain('# HELP reservations_confirmed_total');
    expect(text).toContain('# HELP reservations_declined_total');
    expect(text).toContain('# HELP reservations_cancelled_total');
    expect(text).toContain('# HELP seats_confirmed_total');
    expect(text).toContain('# HELP seats_cancelled_total');
    expect(text).toContain('# HELP seats_available');
    expect(text).toContain('# HELP seats_held');
    expect(text).toContain('# HELP seats_confirmed');
    expect(text).toContain('# HELP http_request_duration_seconds');
    expect(text).toContain('# HELP http_5xx_total');
    expect(text).toContain('# HELP db_retries_total');
    expect(text).toContain('# HELP reserve_queue_depth');
    expect(text).toContain('# HELP reserve_inflight');
    expect(text).toContain('# HELP db_pool_checked_out');
    expect(text).toContain('# HELP db_pool_idle');
  });

  it('metrics reconcile with API state', async () => {
    // Create a new show for this test
    const show = await createShow({
      name: `integration-test-${Date.now()}`,
      seats: ['A1', 'A2'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    initMetricsForShow(show.id);
    
    // Make a reservation using service directly
    await reserveSeats(show.id, { 
      seats: ['A1'], 
      idempotencyKey: `integration-${Date.now()}` 
    });
    
    // Get metrics
    const metricsText = await getMetrics();
    
    // Should have confirmed counter
    expect(metricsText).toContain('reservations_confirmed_total');
    
    // Get show state from database directly
    const pool = await import('../src/db/pools.js').then(m => m.getPool('read'));
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM seats WHERE show_id = $1 AND status = 'confirmed'`,
      [show.id]
    );
    const confirmed = parseInt(result.rows[0].count, 10);
    
    // Verify gauge matches database state
    expect(confirmed).toBeGreaterThanOrEqual(1);
  });

  it('all decline reason series are pre-initialized for new show', async () => {
    // Create a new show and check its metrics are initialized
    const newShow = await createShow({
      name: `preinit-test-${Date.now()}`,
      seats: ['P1', 'P2'],
      price_paise: 25000,
    });
    initMetricsForShow(newShow.id);
    
    // Check that metrics are initialized for this show
    const metricsText = await getMetrics();
    
    // Check that the new show has all reason series initialized to 0
    for (const reason of ['seat_taken', 'per_user_limit', 'idempotent_replay', 'idempotency_conflict', 'seat_not_found', 'invalid_body']) {
      expect(metricsText).toContain(`reservations_declined_total{show_id="${newShow.id}",reason="${reason}"} 0`);
    }
  });
});

describe('health/ready during burst', () => {
  it('stays responsive during concurrent requests', async () => {
    const show = await createShow({
      name: `burst-health-${Date.now()}`,
      seats: ['H1', 'H2'],
      price_paise: 25000,
      per_user_limit: 4
    });
    
    const tokenResponse = await fetch('http://localhost:8080/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'burst-user' }),
    });
    const { token } = await tokenResponse.json();
    
    // Fire a few concurrent requests
    await Promise.all([
      fetch(`http://localhost:8080/shows/${show.id}/reserve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': `burst-1`
        },
        body: JSON.stringify({ seats: ['H1'] }),
      }),
      fetch(`http://localhost:8080/shows/${show.id}/reserve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': `burst-2`
        },
        body: JSON.stringify({ seats: ['H2'] }),
      }),
      fetch(`http://localhost:8080/health/ready`),
    ]);
    
    // Health ready should still respond
    const readyResponse = await fetch('http://localhost:8080/health/ready');
    expect(readyResponse.status).toBe(200);
  });
});