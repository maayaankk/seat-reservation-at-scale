import { Pool } from 'pg';
import { config } from '../config.js';

const INIT_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  price_paise BIGINT NOT NULL CHECK (price_paise >= 0 AND price_paise <= 1000000000000),
  per_user_limit INTEGER NOT NULL DEFAULT 4 CHECK (per_user_limit > 0),
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  seat_count INTEGER NOT NULL,
  seat_labels TEXT[] NOT NULL,
  CHECK (seat_count = cardinality(seat_labels)),
  amount_paise BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
     CHECK (status IN ('confirmed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_label VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
     CHECK (status IN ('available','held','confirmed')),
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (show_id, seat_label),
  CHECK ((status = 'available') = (reservation_id IS NULL))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id VARCHAR(255) NOT NULL,
  key VARCHAR(255) NOT NULL,
  show_id UUID NOT NULL,
  seats_hash TEXT NOT NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_seats_show_status ON seats(show_id, status);
CREATE INDEX IF NOT EXISTS idx_res_user_show ON reservations(user_id, show_id) WHERE status='confirmed';
CREATE INDEX IF NOT EXISTS idx_seats_res ON seats(reservation_id) WHERE reservation_id IS NOT NULL;
`;

export async function runMigrations(): Promise<void> {
  // Use DATABASE_DIRECT_URL if available, otherwise fall back to DATABASE_URL
  const directUrl = config.DATABASE_DIRECT_URL || config.DATABASE_URL;
  if (!directUrl) {
    throw new Error('DATABASE_DIRECT_URL or DATABASE_URL not set');
  }

  const pool = new Pool({
    connectionString: directUrl,
    max: 1,
  });

  const client = await pool.connect();
  try {
    // Use advisory lock to prevent concurrent migrations
    await client.query("SELECT pg_advisory_xact_lock(1234567890)");
    
    // Run the inline schema
    await client.query(INIT_SQL);
    
    // ALTER existing tables to make FK constraints DEFERRABLE INITIALLY DEFERRED
    // This handles the case where tables already exist with non-deferrable FKs
    await client.query(`
      ALTER TABLE idempotency_keys 
      DROP CONSTRAINT IF EXISTS idempotency_keys_reservation_id_fkey;
    `);
    await client.query(`
      ALTER TABLE idempotency_keys 
      ADD CONSTRAINT idempotency_keys_reservation_id_fkey 
      FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE 
      DEFERRABLE INITIALLY DEFERRED;
    `);
    
    await client.query(`
      ALTER TABLE seats 
      DROP CONSTRAINT IF EXISTS seats_reservation_id_fkey;
    `);
    await client.query(`
      ALTER TABLE seats 
      ADD CONSTRAINT seats_reservation_id_fkey 
      FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE 
      DEFERRABLE INITIALLY DEFERRED;
    `);
    
    console.log('Migrations completed successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

export async function waitForDb(maxAttempts = 30, delayMs = 2000): Promise<void> {
  const directUrl = config.DATABASE_DIRECT_URL || config.DATABASE_URL;
  if (!directUrl) {
    throw new Error('DATABASE_DIRECT_URL or DATABASE_URL not set');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const pool = new Pool({ connectionString: directUrl, max: 1 });
    try {
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch {
      await pool.end();
      if (attempt === maxAttempts) throw new Error('Database unavailable after retries');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}