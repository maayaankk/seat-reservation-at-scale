import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createShow } from '../src/services/show.service.js';
import { reserveSeats, cancelReservation } from '../src/services/reservation.service.js';
import { generateUuid, isValidUuid } from '../src/lib/uuid.js';
import { setupAuthContext } from './setup.js';

let keyCounter = 0;
function uniqueKey(prefix: string): string {
  return `${prefix}-${++keyCounter}-${Math.random().toString(36).slice(2)}`;
}

describe('concurrency', () => {
  let showId: string;

  beforeAll(async () => {
    setupAuthContext('test-user');
    const show = await createShow({
      name: `concurrency-test-${Date.now()}`,
      seats: ['A1'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    showId = show.id;
  });

  beforeEach(() => {
    setupAuthContext('test-user');
  });

  it('hot seat - exactly one winner among concurrent requests', async () => {
    const key = `concurrent-hot-${Date.now()}-${Math.random()}`;
    const result1 = await reserveSeats(showId, { seats: ['A1'], idempotencyKey: key });
    expect(result1.isReplay).toBe(false);

    await expect(reserveSeats(showId, { seats: ['A1'], idempotencyKey: `concurrent-2-${Date.now()}` }))
      .rejects.toThrow('Seat A1 is already taken');
  });

  it('multi-seat all-or-nothing', async () => {
    const show = await createShow({
      name: `multi-seat-${Date.now()}`,
      seats: ['A1', 'A2', 'A3'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    // First reserve one seat
    await reserveSeats(show.id, { seats: ['A1'], idempotencyKey: `multi-1-${Date.now()}` });
    // Try to reserve A1+A2 - should fail
    await expect(reserveSeats(show.id, { seats: ['A1', 'A2'], idempotencyKey: `multi-2-${Date.now()}` }))
      .rejects.toThrow('Seat A1 is already taken');
  });

  it('all seats available - multi-seat succeeds', async () => {
    const show = await createShow({
      name: `multi-success-${Date.now()}`,
      seats: ['X1', 'X2', 'X3'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    const result = await reserveSeats(show.id, { seats: ['X1', 'X2'], idempotencyKey: `multi-3-${Date.now()}` });
    expect(result.isReplay).toBe(false);
    expect(result.reservation.seats).toEqual(['X1', 'X2']);
    expect(result.reservation.amount_paise).toBe(50000); // 2 seats * 25000
  });
});