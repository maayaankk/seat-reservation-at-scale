import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError, ERROR_CODES } from './errors.js';
import { timingSafeEqual } from 'node:crypto';
import { setRequestContext, getRequestContext } from './context.js';

export interface JwtPayload {
  sub: string;
  user_id?: string;
  iat: number;
  exp: number;
}

export interface AuthContext {
  userId: string;
  requestId: string;
}

const authStorage = new Map<string, AuthContext>();

export function getAuthContext(requestId: string): AuthContext | undefined {
  return authStorage.get(requestId);
}

export function setAuthContext(requestId: string, ctx: AuthContext): void {
  authStorage.set(requestId, ctx);
}

export function clearAuthContext(requestId: string): void {
  authStorage.delete(requestId);
}

export function getCurrentAuthContext(): AuthContext | undefined {
  const ctx = getRequestContext();
  return ctx?.userId ? { userId: ctx.userId, requestId: ctx.requestId } : undefined;
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
  } catch {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid or expired token');
  }
}

export function extractUserId(payload: JwtPayload): string {
  return payload.sub ?? payload.user_id ?? '';
}

export async function authHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  const userId = extractUserId(payload);
  if (!userId) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Token missing user identity');
  }
  
  const requestId = (request.headers['x-request-id'] as string) || crypto.randomUUID();
  const ctx: AuthContext = { userId, requestId };
  setAuthContext(requestId, ctx);
  
  // Also set in AsyncLocalStorage for service layer access
  // Use setRequestContext (enterWith) to persist for entire async call chain
  setRequestContext({ ...ctx, startTime: Date.now() });
  
  (request as unknown as Record<string, unknown>).user = ctx;
}

export async function adminGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const adminToken = request.headers['x-admin-token'] as string;
  if (!adminToken) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Missing X-Admin-Token header');
  }
  const expected = Buffer.from(config.ADMIN_TOKEN);
  const provided = Buffer.from(adminToken);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid admin token');
  }
  return;
}

export function createDevToken(userId: string): string {
  if (!config.ENABLE_DEV_AUTH) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Dev auth endpoint disabled');
  }
  const expiresIn = config.JWT_EXPIRES_IN;
  // Parse duration string like "24h", "7d", "30m" to seconds
  const parseDuration = (duration: string): number => {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 86400; // default 24h
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 86400;
    }
  };
  return jwt.sign({ sub: userId }, config.JWT_SECRET, { 
    expiresIn: parseDuration(expiresIn), 
    algorithm: 'HS256' 
  });
}