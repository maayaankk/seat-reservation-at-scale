import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createShow, getShow } from '../../services/show.service.js';
import { adminGuard } from '../auth.js';
import { AppError, ERROR_CODES } from '../errors.js';

const createShowSchema = z.object({
  name: z.string().min(1).max(255),
  seats: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,50}$/)).min(1).max(50000),
  price_paise: z.number().int().min(0).max(1_000_000_000_000),
  per_user_limit: z.number().int().positive().default(4).optional(),
}).strict();

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const showQuerySchema = z.object({
  include_seats: z.enum(['true', 'false', '1', '0']).optional(),
});

export async function showsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/shows', { preHandler: adminGuard }, async (request, reply) => {
    const parsed = createShowSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Invalid request body', { issues: parsed.error.flatten() });
    }
    const show = await createShow(parsed.data);
    reply.code(201).send(show);
  });

  // Test route without admin guard (for testing)
  app.post('/shows-test', async (request, reply) => {
    reply.send({ status: 'ok', message: 'Test handler called' });
  });

  app.get('/shows/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Invalid show ID');
    }
    const queryResult = showQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Invalid query parameters');
    }
    const includeSeats = queryResult.data.include_seats !== 'false' && queryResult.data.include_seats !== '0';
    const show = await getShow(paramResult.data.id, includeSeats);
    if (!show) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Show not found');
    }
    reply.send(show);
  });
}