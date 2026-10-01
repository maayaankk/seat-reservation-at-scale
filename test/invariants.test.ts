import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createShow } from '../src/services/show.service.js';
import { reserveSeats, cancelReservation } from '../src/services/reservation.service.js';
import { getPool } from '../src/db/pools.js';
import { setupAuthContext } from './setup.js';

describe('invariants and reconciliation', () => {
  let showId: string;

  beforeAll(async () => {
    setupAuthContext('test-user');
    const show = await createShow({
      name: `invariant-test-${Date.now()}`,
      seats: ['A1', 'A2', 'A3', 'A4'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    showId = show.id;
  });

  beforeEach(() => {
    setupAuthContext('test-user');
  });

  it('available + held + confirmed == total_seats', async () => {
    const pool = getPool('read');
    const result = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM seats WHERE show_id = $1 GROUP BY status`,
      [showId]
    );
    const counts = { available: 0, held: 0, confirmed: 0 };
    for (const r of result.rows) {
      counts[r.status as keyof typeof counts] = Number(r.cnt);
    }
    const total = counts.available + counts.held + counts.confirmed;
    expect(total).toBe(4);
  });

  it('invariant holds after reservations', async () => {
    await reserveSeats(showId, { seats: ['A1'], idempotencyKey: `inv-1-${Date.now()}` });
    await reserveSeats(showId, { seats: ['A2'], idempotencyKey: `inv-2-${Date.now()}` });

    const pool = getPool('read');
    const result = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM seats WHERE show_id = $1 GROUP BY status`,
      [showId]
    );
    const counts = { available: 0, held: 0, confirmed: 0 };
    for (const r of result.rows) {
      counts[r.status as keyof typeof counts] = Number(r.cnt);
    }
    const total = counts.available + counts.held + counts.confirmed;
    expect(total).toBe(4);
    expect(counts.confirmed).toBe(2);
    expect(counts.available).toBe(2);
  });

  it('invariant holds after cancellation', async () => {
    const result = await reserveSeats(showId, { seats: ['A3'], idempotencyKey: `cancel-inv-${Date.now()}` });
    await cancelReservation(result.reservation.reservation_id);

    const pool = getPool('read');
    const result2 = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM seats WHERE show_id = $1 GROUP BY status`,
      [showId]
    );
    const counts = { available: 0, held: 0, confirmed: 0 };
    for (const r of result2.rows) {
      counts[r.status as keyof typeof counts] = Number(r.cnt);
    }
    const total = counts.available + counts.held + counts.confirmed;
    expect(total).toBe(4);
    // Just verify the invariant holds
    expect(total).toBe(4);
  });
});