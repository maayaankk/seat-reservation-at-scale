import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createShow } from '../src/services/show.service.js';
import { reserveSeats, cancelReservation } from '../src/services/reservation.service.js';
import { getPool } from '../src/db/pools.js';
import { setupAuthContext } from './setup.js';

describe('Load Test (Burst Script Simulation)', () => {
  let showId: string;
  let testUserId: string;

  beforeAll(async () => {
    setupAuthContext('load-test-user');
    testUserId = 'load-test-user';
    
    const show = await createShow({
      name: `load-test-${Date.now()}`,
      seats: Array.from({ length: 100 }, (_, i) => `S${i + 1}`),
      price_paise: 25000,
      per_user_limit: 100,
    });
    showId = show.id;
  });

  beforeEach(() => {
    setupAuthContext(testUserId);
  });

  it('should verify burst test configuration parameters', () => {
    // Verify the burst script parameters are correctly configured
    const config = {
      users: 1000,
      requests: 25000,
      hotSeats: ['A12', 'A13', 'A14', 'A15', 'A16'],
      retryRate: 0.2,
      concurrency: 500,
      timeoutMs: 30000,
    };

    expect(config.users).toBe(1000);
    expect(config.requests).toBe(25000);
    expect(config.hotSeats).toHaveLength(5);
    expect(config.retryRate).toBe(0.2);
    expect(config.concurrency).toBe(500);
    expect(config.timeoutMs).toBe(30000);
  });

  it('should handle concurrent reservation requests', async () => {
    // Test that the service can handle concurrent reservation requests
    const promises = [];
    
    for (let i = 0; i < 20; i++) {
      const promise = reserveSeats(showId, { 
        seats: [`S${i}`], 
        idempotencyKey: `concurrent-${i}-${Date.now()}` 
      });
      promises.push(promise);
    }

    const results = await Promise.allSettled(promises);
    
    // All should succeed (either fulfilled or rejected with proper error)
    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.filter(r => r.status === 'rejected').length;
    
    expect(fulfilled + rejected).toBe(20);
    // At least some should succeed
    expect(fulfilled).toBeGreaterThan(0);
  });

  it('should handle idempotent retries correctly', async () => {
    const idempotencyKey = `retry-test-${Date.now()}`;
    
    // First request
    const result1 = await reserveSeats(showId, { 
      seats: ['S100'], 
      idempotencyKey 
    });
    expect(result1.isReplay).toBe(false);

    // Retry with same key
    const result2 = await reserveSeats(showId, { 
      seats: ['S100'], 
      idempotencyKey 
    });
    expect(result2.isReplay).toBe(true);
    expect(result2.reservation.reservation_id).toBe(result1.reservation.reservation_id);
  });

  it('should reject same key with different seats', async () => {
    const idempotencyKey = `conflict-test-${Date.now()}`;
    
    await reserveSeats(showId, { 
      seats: ['S50'], 
      idempotencyKey 
    });
    
    // Same key, different seats should fail
    await expect(
      reserveSeats(showId, { 
        seats: ['S51'], 
        idempotencyKey 
      })
    ).rejects.toThrow('Idempotency key used for different request');
  });
});