import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { reserveSeats, cancelReservation, ReserveResult } from '../../services/reservation.service.js';
import { authHook } from '../auth.js';
import { AppError, ERROR_CODES } from '../errors.js';
import { writeSemaphore } from '../../lib/semaphore.js';
import { reserveQueueDepth, reserveInflight } from '../../observability/metrics.js';

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

export async function reservationsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/shows/:id/reserve', { preHandler: authHook }, async (request, reply) => {
    const paramResult = reserveParamsSchema.safeParse(request.params);
    if (!paramResult.success) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Invalid show ID');
    }

    const headerKey = request.headers['idempotency-key'] as string | undefined;
    const bodyKey = (request.body as Record<string, unknown>)?.idempotency_key as string | undefined;

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
        // Replay already counted in service
      }

      reply.code(201).send(result.reservation);
    } catch (err) {
      if (err instanceof AppError) {
        // Errors already counted in service
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

    reply.send(reservation);
  });
}