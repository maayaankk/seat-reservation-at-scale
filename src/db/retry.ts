import { PoolClient } from 'pg';
import { withClient, getPool } from './pools.js';

export { getPool } from './pools.js';

export type RetryableErrorCode =
  | '40P01' // deadlock_detected
  | '40001' // serialization_failure
  | '55P03' // lock_not_available
  | '08006' // connection_failure
  | '08001' // sqlclient_unable_to_establish_sqlconnection
  | '08004' // sqlserver_rejected_establishment_of_sqlconnection
  | '53300' // too_many_connections
  | '57P01' // admin_shutdown
  | '57P02' // crash_shutdown
  | '57P03'; // cannot_connect_now

export type RetryReason = 'tx_conflict' | 'connection' | 'contention';

const RETRYABLE_CODES: Set<string> = new Set([
  '40P01',
  '40001',
  '55P03',
  '08006',
  '08001',
  '08004',
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 10;

export function isRetryableError(err: unknown): err is Error & { code?: string } {
  return err instanceof Error && typeof (err as { code?: unknown }).code === 'string' && RETRYABLE_CODES.has((err as { code?: string }).code as string);
}

export function classifyRetryReason(err: Error & { code?: string }): RetryReason {
  const code = err.code;
  if (code === '40P01' || code === '40001') return 'tx_conflict';
  if (code === '55P03') return 'contention';
  return 'connection';
}

export function jitteredDelay(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * base * 0.5;
  return Math.floor(base + jitter);
}

export function connectionIsBroken(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return code === '08006' || code === '08001' || code === '08004' || code === '57P01' || code === '57P02' || code === '57P03';
}

export async function withRetry<T>(
  poolName: 'write' | 'read' | 'ops',
  fn: (client: PoolClient) => Promise<T>,
  onRetry?: (attempt: number, err: Error, reason: RetryReason) => void
): Promise<T> {
  let lastErr: Error;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await withClient(poolName, fn);
    } catch (err) {
      lastErr = err as Error;
      if (attempt === MAX_RETRIES || !isRetryableError(err)) {
        throw err;
      }
      const reason = classifyRetryReason(err);
      onRetry?.(attempt + 1, err, reason);
      await new Promise((r) => setTimeout(r, jitteredDelay(attempt)));
    }
  }
  throw lastErr!;
}

export async function withTransactionRetry<T>(
  poolName: 'write' | 'read' | 'ops',
  fn: (client: PoolClient) => Promise<T>,
  onRetry?: (attempt: number, err: Error, reason: RetryReason) => void
): Promise<T> {
  let lastErr: Error;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const pool = getPool(poolName);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      lastErr = err as Error;
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failure
      }
      if (attempt === MAX_RETRIES || !isRetryableError(err)) {
        throw err;
      }
      const reason = classifyRetryReason(err);
      onRetry?.(attempt + 1, err, reason);
      await new Promise((r) => setTimeout(r, jitteredDelay(attempt)));
    } finally {
      client.release(true);
    }
  }
  throw lastErr!;
}