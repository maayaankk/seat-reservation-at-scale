import 'dotenv/config';
import Fastify from 'fastify';
import { config } from './config.js';
import { createPools, closePools } from './db/pools.js';
import { runMigrations, waitForDb } from './db/migrate.js';
import { runWithRequestContext } from './http/context.js';
import { logger, getLogger } from './observability/logger.js';
import { isValidUuid } from './lib/uuid.js';
import { AppError, ERROR_CODES, isAppError, createErrorResponse } from './http/errors.js';
import { authRoutes } from './http/routes/auth.js';
import { showsRoutes } from './http/routes/shows.js';
import { reservationsRoutes } from './http/routes/reservations.js';
import { metricsRoutes, startMetricsLogging, stopMetricsLogging } from './observability/metrics.js';
import { 
  httpRequestDuration, 
  http5xxTotal,
  reserveQueueDepth,
  reserveInflight,
  dbPoolCheckedOut,
  dbPoolIdle
} from './observability/metrics.js';
import { 
  writeSemaphore 
} from './lib/semaphore.js';
import { getPool } from './db/pools.js';
import { authHook, adminGuard } from './http/auth.js';

const app = Fastify({ 
  logger: false,
  bodyLimit: 1048576 // 1MB
});

let dbInitialized = false;

// Request ID with AsyncLocalStorage + request logging
app.addHook('onRequest', async (request, reply) => {
  const requestId = (request.headers['x-request-id'] as string) || crypto.randomUUID();
  reply.header('x-request-id', requestId);
  
  const ctx = {
    requestId,
    startTime: Date.now(),
  };
  runWithRequestContext(ctx, () => {});

  const log = getLogger();
  log.info({ method: request.method, url: request.url }, 'request started');
});

// Response logging + HTTP metrics
app.addHook('onResponse', async (request, reply) => {
  const ctx = { requestId: reply.getHeader('x-request-id') as string, startTime: Date.now() };
  runWithRequestContext(ctx, () => {
    const log = getLogger();
    log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, durationMs: reply.elapsedTime },
      'request completed'
    );
  });

  // HTTP request duration
  const route = request.routeOptions?.url || 'unmatched';
  httpRequestDuration.observe({ method: request.method, route, status: String(reply.statusCode) }, reply.elapsedTime / 1000);

  // 5xx counter
  if (reply.statusCode >= 500) {
    const route = request.routeOptions?.url || 'unmatched';
    http5xxTotal.inc({ route });
  }

  // Update queue/pool gauges
  reserveQueueDepth.set(writeSemaphore.queued);
  reserveInflight.set(writeSemaphore.inflight);
  const writePool = getPool('write');
  const readPool = getPool('read');
  const opsPool = getPool('ops');
  dbPoolCheckedOut.set({ pool: 'write' }, writePool.totalCount - writePool.idleCount);
  dbPoolIdle.set({ pool: 'write' }, writePool.idleCount);
  dbPoolCheckedOut.set({ pool: 'read' }, readPool.totalCount - readPool.idleCount);
  dbPoolIdle.set({ pool: 'read' }, readPool.idleCount);
  dbPoolCheckedOut.set({ pool: 'ops' }, opsPool.totalCount - opsPool.idleCount);
  dbPoolIdle.set({ pool: 'ops' }, opsPool.idleCount);
});

// Error logging
app.addHook('onError', async (request, reply, error) => {
  const requestId = (reply.getHeader('x-request-id') as string) || crypto.randomUUID();
  const ctx = { requestId, startTime: Date.now() };
  runWithRequestContext(ctx, () => {
    const log = getLogger();
    log.error({ err: error, method: request.method, url: request.url }, 'request error');
  });
});

// UUID path validation - catch invalid UUID params before route handlers
app.addHook('preHandler', async (request, reply) => {
  const params = request.params as Record<string, string>;
  for (const [key, value] of Object.entries(params)) {
    if (key.endsWith('Id') || key === 'id') {
      const val = value;
      if (val && !isValidUuid(val)) {
        reply.code(404).send({ error: 'NotFound', message: 'Not found', code: 'NOT_FOUND' });
        return reply;
      }
    }
  }
});

// Not found handler for unknown routes
app.setNotFoundHandler(async (request, reply) => {
  reply.code(404).send({ error: 'NotFound', message: 'Not found', code: 'NOT_FOUND' });
});

// Global error handler - unified error format
app.setErrorHandler(async (error: unknown, request, reply) => {
  const requestId = (reply.getHeader('x-request-id') as string) || crypto.randomUUID();
  reply.header('x-request-id', requestId);

  // Fastify validation errors
  if (error && typeof error === 'object' && 'validation' in error) {
    const fastifyError = error as { validation: Array<{ message: string; params: unknown[] }> };
    reply.code(400).send(createErrorResponse(
      new AppError(400, ERROR_CODES.INVALID_BODY, 'Validation failed', { issues: fastifyError.validation })
    ));
    return;
  }

  // Zod validation errors
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') {
    const zodError = error as unknown as { errors: Array<{ message: string; path: (string | number)[] }> };
    reply.code(400).send(createErrorResponse(
      new AppError(400, ERROR_CODES.INVALID_BODY, 'Invalid request body', { issues: zodError.errors })
    ));
    return;
  }

  // SyntaxError (invalid JSON)
  if (error instanceof SyntaxError && 'statusCode' in error && error.statusCode === 400) {
    reply.code(400).send(createErrorResponse(
      new AppError(400, ERROR_CODES.INVALID_BODY, 'Invalid JSON')
    ));
    return;
  }

  // AppError (our custom errors)
  if (isAppError(error)) {
    reply.code(error.statusCode).send(createErrorResponse(error));
    return;
  }

  // JWT errors
  if (error && typeof error === 'object' && 'name' in error && (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError')) {
    reply.code(401).send(createErrorResponse(
      new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid or expired token')
    ));
    return;
  }

  // Unknown errors
  logger.error({ err: error, requestId, url: request.url }, 'Unhandled error');
  reply.code(500).send(createErrorResponse(
    new AppError(500, ERROR_CODES.INTERNAL, 'Internal server error')
  ));
});

// Auth routes
await app.register(authRoutes);

// Shows routes
await app.register(showsRoutes);

// Reservations routes
await app.register(reservationsRoutes);

// Metrics routes (ops lane)
await app.register(metricsRoutes);

// Health endpoints
app.get('/health/live', async () => {
  return { status: 'ok' };
});

app.get('/health/ready', async (request, reply) => {
  if (!dbInitialized) {
    reply.code(503).send({ status: 'not ready', reason: 'db not initialized' });
    return;
  }
  try {
    const pool = getPool('ops');
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      reply.send({ status: 'ready' });
    } finally {
      client.release();
    }
  } catch {
    reply.code(503).send({ status: 'not ready', reason: 'db unavailable' });
  }
});

// DB test endpoint (for manual verification)
app.get('/health/db-test', { preHandler: authHook }, async (request, reply) => {
  if (!dbInitialized) {
    reply.code(503).send({ status: 'not ready', reason: 'db not initialized' });
    return;
  }
  try {
    const pool = getPool('read');
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW() as time, version() as version');
      const tables = await client.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);
      reply.send({
        status: 'ok',
        db_time: result.rows[0].time,
        pg_version: result.rows[0].version,
        tables: tables.rows.map(r => r.table_name)
      });
    } finally {
      client.release();
    }
  } catch (err) {
    reply.code(500).send({ status: 'error', error: err instanceof Error ? err.message : 'Unknown' });
  }
});

// Admin guard test endpoint (for testing)
app.get('/admin/test', { preHandler: adminGuard }, async () => {
  return { status: 'ok', message: 'Admin access granted' };
});

// Original hello world
app.get('/health', async () => {
  return { status: 'ok', message: 'Hello World' };
});

app.get('/', async () => {
  return { message: 'Hello World API' };
});

async function main() {
  try {
    // Initialize DB pools
    createPools();

    // Wait for DB and run migrations
    await waitForDb();
    await runMigrations();
    dbInitialized = true;
    logger.info('Database initialized successfully');

    // Start periodic metrics logging to file
    startMetricsLogging();
    logger.info('Metrics logging started');

    // Graceful shutdown
    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.info({ signal }, 'Shutting down...');
      
      // Stop metrics logging
      stopMetricsLogging();
      
      await closePools();
      await app.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    await app.listen({ port: config.PORT, host: config.HOST, backlog: 8192 });
    logger.info({ port: config.PORT, host: config.HOST }, 'Server started');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();