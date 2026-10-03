import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createShow } from '../src/services/show.service.js';
import { reserveSeats, cancelReservation } from '../src/services/reservation.service.js';
import { generateUuid, isValidUuid } from '../src/lib/uuid.js';
import { setupAuthContext } from './setup.js';

describe('per-user limits', () => {
  let showId: string;

  beforeAll(async () => {
    setupAuthContext('test-user');
    const show = await createShow({
      name: `limits-test-${Date.now()}`,
      seats: ['A1', 'A2', 'A3', 'A4', 'A5'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    showId = show.id;
  });

  beforeEach(() => {
    setupAuthContext('test-user');
  });

  it('user can reserve up to per_user_limit', async () => {
    for (let i = 1; i <= 4; i++) {
      const result = await reserveSeats(showId, { seats: [`A${i}`], idempotencyKey: `limit-${Date.now()}-${i}` });
      expect(result.isReplay).toBe(false);
    }
  });

  it('5th seat exceeds limit - returns 409', async () => {
    await expect(reserveSeats(showId, { seats: ['A5'], idempotencyKey: `limit-5-${Date.now()}` }))
      .rejects.toThrow('Per-user seat limit exceeded');
  });

  it('cancel frees up limit slot', async () => {
    const show = await createShow({
      name: `cancel-limit-${Date.now()}`,
      seats: ['B1', 'B2', 'B3', 'B4', 'B5'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    const r1 = await reserveSeats(show.id, { seats: ['B1'], idempotencyKey: `cancel-limit-1-${Date.now()}` });
    const r2 = await reserveSeats(show.id, { seats: ['B2'], idempotencyKey: `cancel-limit-2-${Date.now()}` });
    const r3 = await reserveSeats(show.id, { seats: ['B3'], idempotencyKey: `cancel-limit-3-${Date.now()}` });
    const r4 = await reserveSeats(show.id, { seats: ['B4'], idempotencyKey: `cancel-limit-4-${Date.now()}` });
    
    // Cancel one
    await cancelReservation(r1.reservation.reservation_id);
    
    // Now should be able to reserve another
    const result = await reserveSeats(show.id, { seats: ['B5'], idempotencyKey: `limit-new-${Date.now()}` });
    expect(result.isReplay).toBe(false);
  });
});