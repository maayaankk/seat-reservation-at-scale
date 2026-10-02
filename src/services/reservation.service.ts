import { PoolClient } from 'pg';
import { withTransactionRetry, getPool } from '../db/retry.js';
import { loadShowMeta } from '../lib/showCache.js';
import { generateUuid, isValidUuid } from '../lib/uuid.js';
import { canonicalizeSeats, canonicalSeatsHash } from '../lib/hash.js';
import { AppError, ERROR_CODES } from '../http/errors.js';
import { getCurrentAuthContext } from '../http/auth.js';
import { 
  reservationsConfirmedTotal,
  reservationsDeclinedTotal,
  reservationsCancelledTotal,
  seatsConfirmedTotal,
  seatsCancelledTotal 
} from '../observability/metrics.js';

export interface ReserveInput {
  seats: string[];
  idempotencyKey: string;
}

export interface ReserveResult {
  reservation: ReservationResponse;
  isReplay: boolean;
}

export interface ReservationResponse {
  reservation_id: string;
  show_id: string;
  user_id: string;
  seats: string[];
  amount_paise: number;
  status: 'confirmed' | 'cancelled';
}

export async function reserveSeats(showId: string, input: ReserveInput): Promise<ReserveResult> {
  if (!isValidUuid(showId)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Show not found');
  }

  const { seats, idempotencyKey } = input;
  if (seats.length === 0 || seats.length > 50) {
    throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Seat count must be between 1 and 50');
  }
  if (idempotencyKey.length > 255) {
    throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Idempotency key too long');
  }

  const canonicalSeats = canonicalizeSeats(seats);
  const seatsHash = await canonicalSeatsHash(canonicalSeats);
  const meta = await loadShowMeta(showId);
  if (!meta) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Show not found');
  }

  if (canonicalSeats.length > meta.per_user_limit) {
    throw new AppError(409, ERROR_CODES.USER_LIMIT_EXCEEDED, 'Requested seats exceed per-user limit');
  }

  const authCtx = getCurrentAuthContext();
  if (!authCtx) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'No auth context');
  }
  const userId = authCtx.userId;

  const result = await withTransactionRetry('write', async (client) => {
    // Advisory lock per user/show for limit check
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [userId + ':' + showId]);

    // Idempotency check
    const idemResult = await client.query(
      `SELECT user_id, key, show_id, seats_hash, reservation_id
       FROM idempotency_keys
       WHERE user_id = $1 AND key = $2
       FOR UPDATE`,
      [userId, idempotencyKey]
    );

    if (idemResult.rows.length > 0) {
      const existing = idemResult.rows[0];
      if (existing.show_id !== showId || existing.seats_hash !== seatsHash) {
        reservationsDeclinedTotal.inc({ show_id: showId, reason: 'idempotency_conflict' });
        throw new AppError(409, ERROR_CODES.IDEMPOTENCY_CONFLICT, 'Idempotency key used for different request');
      }
      if (existing.reservation_id) {
        // Replay: fetch the original reservation
        const resResult = await client.query(
          `SELECT id, show_id, user_id, seat_labels, amount_paise, status
           FROM reservations WHERE id = $1`,
          [existing.reservation_id]
        );
        if (resResult.rows.length === 0) {
          throw new AppError(500, ERROR_CODES.INTERNAL, 'Idempotency record points to missing reservation');
        }
        const r = resResult.rows[0];
        reservationsDeclinedTotal.inc({ show_id: showId, reason: 'idempotent_replay' });
        return {
          reservation: {
            reservation_id: r.id,
            show_id: r.show_id,
            user_id: r.user_id,
            seats: r.seat_labels,
            amount_paise: Number(r.amount_paise),
            status: r.status,
          } as ReservationResponse,
          isReplay: true,
        } as ReserveResult;
      }
      throw new AppError(500, ERROR_CODES.INTERNAL, 'Incomplete idempotency record');
    }

    // Check user limit
    const limitResult = await client.query(
      `SELECT COALESCE(SUM(seat_count), 0) as used
       FROM reservations
       WHERE user_id = $1 AND show_id = $2 AND status = 'confirmed'`,
      [userId, showId]
    );
    const used = Number(limitResult.rows[0].used);
    if (used + canonicalSeats.length > meta.per_user_limit) {
      reservationsDeclinedTotal.inc({ show_id: showId, reason: 'per_user_limit' });
      throw new AppError(409, ERROR_CODES.USER_LIMIT_EXCEEDED, 'Per-user seat limit exceeded');
    }

    // Lock requested seats in deterministic order
    const lockResult = await client.query(
      `SELECT id, seat_label, status
       FROM seats
       WHERE show_id = $1 AND seat_label = ANY($2)
       ORDER BY seat_label COLLATE "C"
       FOR UPDATE`,
      [showId, canonicalSeats]
    );

    if (lockResult.rows.length !== canonicalSeats.length) {
      const foundLabels = new Set(lockResult.rows.map((r) => r.seat_label));
      const missing = canonicalSeats.find((s) => !foundLabels.has(s));
      if (missing) {
        reservationsDeclinedTotal.inc({ show_id: showId, reason: 'seat_not_found' });
        throw new AppError(404, ERROR_CODES.SEAT_NOT_FOUND, `Seat ${missing} not found`);
      }
    }

    for (const row of lockResult.rows) {
      if (row.status !== 'available') {
        reservationsDeclinedTotal.inc({ show_id: showId, reason: 'seat_taken' });
        throw new AppError(409, ERROR_CODES.SEAT_TAKEN, `Seat ${row.seat_label} is already taken`);
      }
    }

    // All seats available - proceed with reservation
    const reservationId = generateUuid();

    // Insert idempotency key with reservation_id
    await client.query(
      `INSERT INTO idempotency_keys (user_id, key, show_id, seats_hash, reservation_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, idempotencyKey, showId, seatsHash, reservationId]
    );

    // Claim seats
    const seatIds = lockResult.rows.map((r) => r.id);
    await client.query(
      `UPDATE seats SET status = 'confirmed', reservation_id = $1 WHERE id = ANY($2)`,
      [reservationId, seatIds]
    );

    // Insert reservation
    const amount = canonicalSeats.length * meta.price_paise;
    await client.query(
      `INSERT INTO reservations (id, show_id, user_id, seat_count, seat_labels, amount_paise, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')`,
      [reservationId, showId, userId, canonicalSeats.length, canonicalSeats, amount]
    );

    // Increment metrics for successful reservation
    reservationsConfirmedTotal.inc({ show_id: showId });
    seatsConfirmedTotal.inc({ show_id: showId }, canonicalSeats.length);

    return {
      reservation: {
        reservation_id: reservationId,
        show_id: showId,
        user_id: userId,
        seats: canonicalSeats,
        amount_paise: amount,
        status: 'confirmed',
      } as ReservationResponse,
      isReplay: false,
    } as ReserveResult;
  });

  return result;
}

export async function cancelReservation(reservationId: string): Promise<ReservationResponse> {
  if (!isValidUuid(reservationId)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Reservation not found');
  }

  const authCtx = getCurrentAuthContext();
  if (!authCtx) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'No auth context');
  }
  const userId = authCtx.userId;

  const result = await withTransactionRetry('write', async (client) => {
    const resResult = await client.query(
      `SELECT id, user_id, status, seat_labels FROM reservations WHERE id = $1 FOR UPDATE`,
      [reservationId]
    );
    if (resResult.rows.length === 0) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Reservation not found');
    }
    const res = resResult.rows[0];
    if (res.user_id !== userId) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Not owner of reservation');
    }
    if (res.status === 'cancelled') {
      // Idempotent repeat cancel - return current state
      const fullRes = await client.query(
        `SELECT id, show_id, user_id, seat_labels, amount_paise, status
         FROM reservations WHERE id = $1`,
        [reservationId]
      );
      const r = fullRes.rows[0];
      return {
        reservation_id: r.id,
        show_id: r.show_id,
        user_id: r.user_id,
        seats: r.seat_labels,
        amount_paise: Number(r.amount_paise),
        status: r.status,
      } as ReservationResponse;
    }

    // Cancel this reservation
    await client.query(
      `UPDATE reservations SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'confirmed'`,
      [reservationId, userId]
    );

    // Release seats owned by THIS reservation only
    await client.query(
      `UPDATE seats SET status = 'available', reservation_id = NULL
       WHERE reservation_id = $1 AND status = 'confirmed'`,
      [reservationId]
    );

    // Increment metrics for cancellation
    reservationsCancelledTotal.inc({ show_id: res.show_id });
    seatsCancelledTotal.inc({ show_id: res.show_id }, res.seat_labels.length);

    const fullRes = await client.query(
      `SELECT id, show_id, user_id, seat_labels, amount_paise, status
       FROM reservations WHERE id = $1`,
      [reservationId]
    );
    const r = fullRes.rows[0];
    return {
      reservation_id: r.id,
      show_id: r.show_id,
      user_id: r.user_id,
      seats: r.seat_labels,
      amount_paise: Number(r.amount_paise),
      status: r.status,
    } as ReservationResponse;
  });

  return result;
}