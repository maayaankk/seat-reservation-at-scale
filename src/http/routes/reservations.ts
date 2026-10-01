import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { reserveSeats, cancelReservation, ReserveResult } from '../../services/reservation.service.js';
import { authHook } from '../auth.js';
import { AppError, ERROR_CODES } from '../errors.js';
import { writeSemaphore, readSemaphore, opsSemaphore } from '../../lib/semaphore.js';
import { reserveQueueDepth, reserveInflight, dbRetriesTotal, reservationsConfirmedTotal, reservationsDeclinedTotal, reservationsCancelledTotal, seatsConfirmedTotal, seatsCancelledTotal } from '../../observability/metrics.js';

const reserveBodySchema = z.object({
  seats: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,50}$/)).min(1).max(50),
  idempotency_key: z.string().max(255).optional(),
}).strict();

const reserveParamsSchema = z.object({
  id: z.string().uuid(),
});

const cancelParamsSchema = z.object({
  id: z.string().uuid(),
});

function mapErrorToReason(code: string): string {
  switch (code) {
    case ERROR_CODES.SEAT_TAKEN: return 'seat_taken';
    case ERROR_CODES.USER_LIMIT_EXCEEDED: return 'per_user_limit';
    case ERROR_CODES.IDEMPOTENCY_CONFLICT: return 'idempotency_conflict';
    case ERROR_CODES.SEAT_NOT_FOUND: return 'seat_not_found';
    case ERROR_CODES.INVALID_BODY: return 'invalid_body';
    case ERROR_CODES.IDEMPOTENCY_REPLAY: return 'idempotent_replay';
    default: return 'invalid_body';
  }
}

export async function reservationsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/shows/:id/reserve', { preHandler: authHook }, async (request, reply) => {
    const paramResult = reserveParamsSchema.safeParse(request.params);
    if (!paramResult.success) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Invalid show ID');
    }

    const headerKey = request.headers['idempotency-key'] as string | undefined;
    const bodyKey = (request.body as any)?.idempotency_key as string | undefined;

    if (headerKey && bodyKey && headerKey !== bodyKey) {
      throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Idempotency key mismatch between header and body');
    }

    const idempotencyKey = headerKey ?? bodyKey;
    if (!idempotencyKey) {
      throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Idempotency-Key header or body field required');
    }

    const bodyResult = reserveBodySchema.safeParse({
      ...(request.body as Record<string, unknown>),
      idempotency_key: undefined,
    });
    if (!bodyResult.success) {
      throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Invalid request body', { issues: bodyResult.error.flatten() });
    }

    reserveQueueDepth.inc(writeSemaphore.queued);
    reserveInflight.inc(writeSemaphore.inflight);
    try {
      const result: ReserveResult = await writeSemaphore.run(() => reserveSeats(paramResult.data.id, {
        seats: bodyResult.data.seats,
        idempotencyKey,
      }));

      if (result.isReplay) {
        reservationsDeclinedTotal.inc({ show_id: paramResult.data.id, reason: 'idempotent_replay' });
      } else {
        reservationsConfirmedTotal.inc({ show_id: paramResult.data.id });
        seatsConfirmedTotal.inc({ show_id: paramResult.data.id }, result.reservation.seats.length);
      }

      reply.code(201).send(result.reservation);
    } catch (err) {
      if (err instanceof AppError) {
        reservationsDeclinedTotal.inc({ show_id: paramResult.data.id, reason: mapErrorToReason(err.code) });
      }
      throw err;
    } finally {
      reserveQueueDepth.dec();
      reserveInflight.dec();
    }
  });

  app.post('/reservations/:id/cancel', { preHandler: authHook }, async (request, reply) => {
    const paramResult = cancelParamsSchema.safeParse(request.params);
    if (!paramResult.success) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Invalid reservation ID');
    }

    const reservation = await writeSemaphore.run(() => cancelReservation(paramResult.data.id));

    if (reservation.status === 'cancelled') {
      reservationsCancelledTotal.inc({ show_id: reservation.show_id });
      seatsCancelledTotal.inc({ show_id: reservation.show_id }, reservation.seats.length);
    }

    reply.send(reservation);
  });
}