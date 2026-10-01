import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createDevToken } from '../auth.js';
import { config } from '../../config.js';
import { AppError, ERROR_CODES } from '../errors.js';

const tokenBodySchema = z.object({
  user_id: z.string().min(1).max(255),
}).strict();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/token', async (request, reply) => {
    if (!config.ENABLE_DEV_AUTH) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Dev auth endpoint disabled');
    }
    const result = tokenBodySchema.safeParse(request.body);
    if (!result.success) {
      throw new AppError(400, ERROR_CODES.INVALID_BODY, 'Invalid request body');
    }
    const token = createDevToken(result.data.user_id);
    reply.send({ token, expires_in: 86400 });
  });
}