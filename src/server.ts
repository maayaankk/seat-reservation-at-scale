import 'dotenv/config';
import Fastify from 'fastify';
import { config } from './config.js';
import { createPools, closePools, getPool } from './db/pools.js';
import { runMigrations, waitForDb } from './db/migrate.js';
import { runWithRequestContext } from './http/context.js';
import { logger, getLogger } from './observability/logger.js';

const app = Fastify({ logger: false });

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

// Response logging
app.addHook('onResponse', async (request, reply) => {
  const ctx = { requestId: reply.getHeader('x-request-id') };
  runWithRequestContext(ctx as any, () => {
    const log = getLogger();
    log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, durationMs: reply.elapsedTime },
      'request completed'
    );
  });
});

// Error logging
app.addHook('onError', async (request, reply, error) => {
  const ctx = { requestId: reply.getHeader('x-request-id') };
  runWithRequestContext(ctx as any, () => {
    const log = getLogger();
    log.error({ err: error, method: request.method, url: request.url }, 'request error');
  });
});

// Request ID with AsyncLocalStorage
app.addHook('onRequest', async (request, reply) => {
  const requestId = (request.headers['x-request-id'] as string) || crypto.randomUUID();
  reply.header('x-request-id', requestId);
  
  const ctx = {
    requestId,
    startTime: Date.now(),
  };
  runWithRequestContext(ctx, () => {});
});

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
app.get('/health/db-test', async (request, reply) => {
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

    // Graceful shutdown
    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.info({ signal }, 'Shutting down...');
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