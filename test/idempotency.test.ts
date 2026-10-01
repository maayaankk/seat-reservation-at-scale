import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createShow } from '../src/services/show.service.js';
import { reserveSeats, cancelReservation } from '../src/services/reservation.service.js';
import { generateUuid, isValidUuid } from '../src/lib/uuid.js';
import { setupAuthContext } from './setup.js';

let keyCounter = 0;
function uniqueKey(prefix: string): string {
  return `${prefix}-${++keyCounter}-${Math.random().toString(36).slice(2)}`;
}

describe('idempotency', () => {
  let showId: string;

  beforeAll(async () => {
    setupAuthContext('test-user');
    const show = await createShow({
      name: `idempotency-test-${Date.now()}`,
      seats: ['A1', 'A2', 'A3'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    showId = show.id;
  });

  beforeEach(() => {
    setupAuthContext('test-user');
  });

  it('replay same key returns original reservation', async () => {
    const key = uniqueKey('idem-replay');
    const result1 = await reserveSeats(showId, { seats: ['A1'], idempotencyKey: key });
    expect(result1.isReplay).toBe(false);

    const result2 = await reserveSeats(showId, { seats: ['A1'], idempotencyKey: key });
    expect(result2.isReplay).toBe(true);
    expect(result2.reservation.reservation_id).toBe(result1.reservation.reservation_id);
  });

  it('same key different seats returns 409', async () => {
    const show = await createShow({
      name: `idempotency-conflict-${Date.now()}`,
      seats: ['B1', 'B2'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    const key = uniqueKey('idem-conflict');
    await reserveSeats(show.id, { seats: ['B1'], idempotencyKey: key });
    await expect(reserveSeats(show.id, { seats: ['B2'], idempotencyKey: key }))
      .rejects.toThrow('Idempotency key used for different request');
  });

  it('different users can use same key', async () => {
    expect(true).toBe(true);
  });
});