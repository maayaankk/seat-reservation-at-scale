import { Pool, PoolClient } from 'pg';
import { config } from '../config.js';

export type PoolName = 'write' | 'read' | 'ops';

const poolConfigs: Record<PoolName, { max: number; name: string }> = {
  write: { max: 30, name: 'write' },
  read: { max: 6, name: 'read' },
  ops: { max: 2, name: 'ops' },
};

const pools: Record<PoolName, Pool> = {} as Record<PoolName, Pool>;

export function createPools(): Record<PoolName, Pool> {
  for (const [name, { max }] of Object.entries(poolConfigs)) {
    const pool = new Pool({
      connectionString: config.DATABASE_URL,
      max,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    });

    pool.on('error', (err) => {
      console.error(`[${name}-pool] idle client error`, err);
    });

    pools[name as PoolName] = pool;
  }
  return pools;
}

export function getPool(name: PoolName): Pool {
  if (!pools[name]) {
    throw new Error(`Pool ${name} not initialized`);
  }
  return pools[name];
}

export async function closePools(): Promise<void> {
  await Promise.all(Object.values(pools).map((p) => p.end()));
}

export async function withClient<T>(
  poolName: PoolName,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool(poolName);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}