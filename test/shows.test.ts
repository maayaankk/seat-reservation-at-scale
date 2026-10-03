import { describe, it, expect } from 'vitest';
import { createShow, getShow } from '../src/services/show.service.js';
import { generateUuid, isValidUuid } from '../src/lib/uuid.js';
import { canonicalizeSeats } from '../src/lib/hash.js';

describe('show service', () => {
  let createdShowId: string;

  it('creates a show with valid input', async () => {
    const show = await createShow({
      name: `test-show-${Date.now()}`,
      seats: ['A1', 'A2', 'A3'],
      price_paise: 25000,
      per_user_limit: 4,
    });
    expect(show.id).toBeDefined();
    expect(show.name).toContain('test-show-');
    expect(show.price_paise).toBe(25000);
    expect(show.per_user_limit).toBe(4);
    expect(show.total_seats).toBe(3);
    expect(show.available).toBe(3);
    expect(show.held).toBe(0);
    expect(show.confirmed).toBe(0);
    expect(show.seats).toHaveLength(3);
    createdShowId = show.id;
  });

  it('rejects duplicate seat labels', async () => {
    await expect(createShow({
      name: `dup-seats-${Date.now()}`,
      seats: ['A1', 'A1'],
      price_paise: 10000,
    })).rejects.toThrow('Duplicate seat labels');
  });

  it('rejects empty seat list', async () => {
    await expect(createShow({
      name: `empty-${Date.now()}`,
      seats: [],
      price_paise: 10000,
    })).rejects.toThrow('Seat count must be between 1 and 50,000');
  });

  it('rejects too many seats', async () => {
    const manySeats = Array.from({ length: 50001 }, (_, i) => `A${i}`);
    await expect(createShow({
      name: `many-${Date.now()}`,
      seats: manySeats,
      price_paise: 10000,
    })).rejects.toThrow('Seat count must be between 1 and 50,000');
  });

  it('rejects invalid seat labels', async () => {
    await expect(createShow({
      name: `invalid-${Date.now()}`,
      seats: ['A1!', 'A2'],
      price_paise: 10000,
    })).rejects.toThrow('Invalid seat label');
  });

  it('rejects invalid price_paise', async () => {
    await expect(createShow({
      name: `bad-price-${Date.now()}`,
      seats: ['A1'],
      price_paise: -1,
    })).rejects.toThrow('price_paise must be a safe integer');
  });

  it('gets show with seats', async () => {
    const show = await getShow(createdShowId);
    expect(show).toBeDefined();
    expect(show?.seats).toBeDefined();
  });

  it('gets show without seats (counts only)', async () => {
    const show = await getShow(createdShowId, false);
    expect(show).toBeDefined();
    expect(show?.seats).toBeUndefined();
    expect(show?.available).toBeGreaterThanOrEqual(0);
  });

  it('returns null for invalid UUID', async () => {
    const show = await getShow('not-a-uuid');
    expect(show).toBeNull();
  });

  it('canonicalizes seats correctly', () => {
    expect(canonicalizeSeats(['A2', 'A1', 'A1'])).toEqual(['A1', 'A2']);
  });

  it('validates UUIDs', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUuid('not-a-uuid')).toBe(false);
  });
});