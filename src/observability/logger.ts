import pino from 'pino';
import { getRequestContext } from '../http/context.js';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
      }
    : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['*.password', '*.secret', '*.token', '*.authorization'],
    censor: '**REDACTED**',
  },
});

export function createRequestLogger(requestId: string) {
  return logger.child({ request_id: requestId });
}

export function getLogger() {
  const ctx = getRequestContext();
  if (ctx) {
    return logger.child({ request_id: ctx.requestId, user_id: ctx.userId, show_id: ctx.showId });
  }
  return logger;
}

export { logger, logger as default };