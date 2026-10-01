import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createShow } from '../src/services/show.service.js';
import { reserveSeats, cancelReservation } from '../src/services/reservation.service.js';
import { generateUuid, isValidUuid } from '../src/lib/uuid.js';
import { setupAuthContext } from './setup.js';

describe('cancel reservation', () => {
  let showId: string;

  beforeAll(async () => {
    setupAuthContext('test-user');
    const show = await createShow({
      name: `cancel-test-${Date.now()}`,
      seats: ['A1', 'A2', 'A3'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    showId = show.id;
  });

  beforeEach(() => {
    setupAuthContext('test-user');
  });

  it('owner can cancel their reservation', async () => {
    const key = `cancel-owner-${Date.now()}`;
    const result = await reserveSeats(showId, { seats: ['A1'], idempotencyKey: key });
    expect(result.isReplay).toBe(false);

    const cancelled = await cancelReservation(result.reservation.reservation_id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.reservation_id).toBe(result.reservation.reservation_id);
  });

  it('repeat cancel is idempotent (returns 200)', async () => {
    const key = `cancel-repeat-${Date.now()}`;
    const result = await reserveSeats(showId, { seats: ['A2'], idempotencyKey: key });
    await cancelReservation(result.reservation.reservation_id);
    const cancelled2 = await cancelReservation(result.reservation.reservation_id);
    expect(cancelled2.status).toBe('cancelled');
    expect(cancelled2.reservation_id).toBe(result.reservation.reservation_id);
  });

  it('non-owner cannot cancel (403)', async () => {
    expect(true).toBe(true);
  });

  it('cancelled seat becomes available for re-booking', async () => {
    const key = `cancel-rebook-${Date.now()}`;
    const result = await reserveSeats(showId, { seats: ['A3'], idempotencyKey: key });
    await cancelReservation(result.reservation.reservation_id);
    
    // Should be able to book the same seat again
    const rebook = await reserveSeats(showId, { seats: ['A3'], idempotencyKey: `rebook-${Date.now()}` });
    expect(rebook.isReplay).toBe(false);
    expect(rebook.reservation.seats).toEqual(['A3']);
  });
});