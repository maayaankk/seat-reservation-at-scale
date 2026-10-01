import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const directUrl = config.DATABASE_DIRECT_URL;
  if (!directUrl) {
    throw new Error('DATABASE_DIRECT_URL not set');
  }

  const pool = new Pool({
    connectionString: directUrl,
    max: 1,
  });

  const client = await pool.connect();
  try {
    // Use advisory lock to prevent concurrent migrations
    await client.query("SELECT pg_advisory_xact_lock(1234567890)");
    
    // Run the init.sql schema
    const initSqlPath = path.join(__dirname, 'sql/init.sql');
    const sql = await fs.readFile(initSqlPath, 'utf-8');
    await client.query(sql);
    
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
  const directUrl = config.DATABASE_DIRECT_URL;
  if (!directUrl) {
    throw new Error('DATABASE_DIRECT_URL not set');
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