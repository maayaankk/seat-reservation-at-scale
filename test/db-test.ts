import { createPools, getPool } from '../src/db/pools.js';
import { withTransactionRetry } from '../src/db/retry.js';
import { generateUuid } from '../src/lib/uuid.js';
import { config } from '../src/config.js';

async function test() {
  createPools();
  const pool = getPool('write');
  
  // Test simple query
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW()');
    console.log('Simple query:', result.rows[0]);
  } finally {
    client.release();
  }
  
  // Test transaction
  const showId = generateUuid();
  try {
    await withTransactionRetry('write', async (client) => {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO shows (id, name, price_paise, per_user_limit, total_seats) VALUES ($1, $2, $3, $4, $5)`,
        [showId, 'test-db', 25000, 4, 2]
      );
      const seatValues = ['A1', 'A2'].map((label, idx) => `($1, $${idx + 2}, 'available')`).join(', ');
      const seatParams = [showId, ...['A1', 'A2']];
      await client.query(
        `INSERT INTO seats (show_id, seat_label, status) VALUES ${seatValues}`,
        seatParams
      );
      await client.query('COMMIT');
    });
    console.log('Transaction successful');
  } catch (err) {
    console.error('Transaction error:', err);
  }
  
  await pool.end();
  process.exit(0);
}

test().catch(console.error);