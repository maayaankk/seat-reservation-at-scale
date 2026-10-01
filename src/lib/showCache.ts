import { PoolClient } from 'pg';
import { getPool } from '../db/pools.js';

export interface ShowMeta {
  id: string;
  name: string;
  price_paise: number;
  per_user_limit: number;
  total_seats: number;
}

const showCache = new Map<string, ShowMeta>();

export function getShowMeta(showId: string): ShowMeta | undefined {
  return showCache.get(showId);
}

export function setShowMeta(meta: ShowMeta): void {
  showCache.set(meta.id, meta);
}

export function invalidateShowMeta(showId: string): void {
  showCache.delete(showId);
}

export async function loadShowMeta(showId: string): Promise<ShowMeta | null> {
  const cached = getShowMeta(showId);
  if (cached) return cached;

  const pool = getPool('read');
  const result = await pool.query(
    `SELECT id, name, price_paise, per_user_limit, total_seats FROM shows WHERE id = $1`,
    [showId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const meta: ShowMeta = {
    id: row.id,
    name: row.name,
    price_paise: Number(row.price_paise),
    per_user_limit: row.per_user_limit,
    total_seats: row.total_seats,
  };
  setShowMeta(meta);
  return meta;
}