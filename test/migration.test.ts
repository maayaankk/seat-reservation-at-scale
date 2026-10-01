import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations, waitForDb } from '../src/db/migrate.js';
import { getPool } from '../src/db/pools.js';
import { setupAuthContext } from './setup.js';

describe('database migrations', () => {
  beforeAll(async () => {
    setupAuthContext('test-user');
    await waitForDb();
  });

  afterAll(async () => {
    const pool = getPool('write');
    await pool.end();
  });

  it('runs migrations idempotently', async () => {
    // Should not throw
    await expect(runMigrations()).resolves.toBeUndefined();
    // Running again should also not throw
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it('creates all required tables', async () => {
    const pool = getPool('read');
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const tables = result.rows.map(r => r.table_name);
    expect(tables).toContain('shows');
    expect(tables).toContain('seats');
    expect(tables).toContain('reservations');
    expect(tables).toContain('idempotency_keys');
  });

  it('creates required indexes', async () => {
    const pool = getPool('read');
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `);
    const indexes = result.rows.map(r => r.indexname);
    expect(indexes.some(i => i.includes('seats_show_status'))).toBe(true);
    expect(indexes.some(i => i.includes('res_user_show'))).toBe(true);
    expect(indexes.some(i => i.includes('seats_res'))).toBe(true);
  });

  it('enforces constraints', async () => {
    const pool = getPool('write');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Test unique constraint on shows.name
      await client.query(
        `INSERT INTO shows (id, name, price_paise, per_user_limit, total_seats) VALUES ($1, $2, $3, $4, $5)`,
        ['11111111-1111-1111-1111-111111111111', 'dup-test', 1000, 4, 1]
      );
      await expect(client.query(
        `INSERT INTO shows (id, name, price_paise, per_user_limit, total_seats) VALUES ($1, $2, $3, $4, $5)`,
        ['22222222-2222-2222-2222-222222222222', 'dup-test', 1000, 4, 1]
      )).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});