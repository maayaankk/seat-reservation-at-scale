import { withTransactionRetry, getPool } from '../db/retry.js';
import { loadShowMeta, setShowMeta } from '../lib/showCache.js';
import { generateUuid, isValidUuid } from '../lib/uuid.js';
import { AppError, ERROR_CODES } from '../http/errors.js';
import { canonicalizeSeats } from '../lib/hash.js';
import { initMetricsForShow } from '../observability/metrics.js';

export interface CreateShowInput {
  name: string;
  seats: string[];
  price_paise: number;
  per_user_limit?: number;
}

export interface ShowResponse {
  id: string;
  name: string;
  price_paise: number;
  per_user_limit: number;
  total_seats: number;
  available: number;
  held: number;
  confirmed: number;
  seats?: Array<{ label: string; status: string }>;
}

export async function createShow(input: CreateShowInput): Promise<ShowResponse> {
  const { name, seats, price_paise, per_user_limit = 4 } = input;

  if (!Number.isSafeInteger(price_paise) || price_paise < 0 || price_paise > 1_000_000_000_000) {
    throw new AppError(400, ERROR_CODES.INVALID_BODY, 'price_paise must be a safe integer between 0 and 1e12');
  }

  const uniqueSeats = canonicalizeSeats(seats);
  if (uniqueSeats.length !== seats.length) {
    throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Duplicate seat labels');
  }
  if (uniqueSeats.length === 0 || uniqueSeats.length > 50_000) {
    throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Seat count must be between 1 and 50,000');
  }
  const labelRegex = /^[A-Za-z0-9_-]{1,50}$/;
  for (const label of uniqueSeats) {
    if (!labelRegex.test(label)) {
      throw new AppError(400, ERROR_CODES.INVALID_BODY, `Invalid seat label: ${label}`);
    }
  }

  const showId = generateUuid();

  await withTransactionRetry('write', async (client) => {
    try {
      await client.query(
        `INSERT INTO shows (id, name, price_paise, per_user_limit, total_seats) VALUES ($1, $2, $3, $4, $5)`,
        [showId, name, price_paise, per_user_limit, uniqueSeats.length]
      );

      const seatValues = uniqueSeats.map((label, idx) => `($1, $${idx + 2}, 'available')`).join(', ');
      const seatParams = [showId, ...uniqueSeats];
      await client.query(
        `INSERT INTO seats (show_id, seat_label, status) VALUES ${seatValues}`,
        seatParams
      );
    } catch (err: unknown) {
      const errTyped = err as Error & { code?: string; constraint?: string };
      // Handle unique constraint violation on show name
      if (errTyped.code === '23505' && errTyped.constraint === 'shows_name_key') {
        throw new AppError(409, ERROR_CODES.SHOW_EXISTS, 'Show with this name already exists');
      }
      throw err;
    }
  });

  const meta = {
    id: showId,
    name,
    price_paise,
    per_user_limit,
    total_seats: uniqueSeats.length,
  };
  setShowMeta(meta);
  initMetricsForShow(showId);

  const seatList = uniqueSeats.map((label) => ({ label, status: 'available' as const }));
  return {
    ...meta,
    available: uniqueSeats.length,
    held: 0,
    confirmed: 0,
    seats: seatList,
  };
}

export async function getShow(showId: string, includeSeats = true): Promise<ShowResponse | null> {
  if (!isValidUuid(showId)) return null;

  const meta = await loadShowMeta(showId);
  if (!meta) return null;

  const pool = getPool('read');
  if (includeSeats) {
    const result = await pool.query(
      `SELECT seat_label, status FROM seats WHERE show_id = $1 ORDER BY seat_label`,
      [showId]
    );
    const seats = result.rows.map((r) => ({ label: r.seat_label, status: r.status }));
    const counts = { available: 0, held: 0, confirmed: 0 };
    for (const s of seats) counts[s.status as keyof typeof counts]++;
    return { ...meta, ...counts, seats };
  } else {
    const result = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM seats WHERE show_id = $1 GROUP BY status`,
      [showId]
    );
    const counts = { available: 0, held: 0, confirmed: 0 };
    for (const r of result.rows) {
      counts[r.status as keyof typeof counts] = Number(r.cnt);
    }
    return { ...meta, ...counts };
  }
}