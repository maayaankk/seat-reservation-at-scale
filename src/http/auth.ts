import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError, ERROR_CODES } from './errors.js';
import { timingSafeEqual } from 'node:crypto';

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

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
  (request as any).user = ctx;
}

export function adminGuard(request: FastifyRequest, reply: FastifyReply): void {
  const adminToken = request.headers['x-admin-token'] as string;
  if (!adminToken) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Missing X-Admin-Token header');
  }
  const expected = Buffer.from(config.ADMIN_TOKEN);
  const provided = Buffer.from(adminToken);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid admin token');
  }
}

export function createDevToken(userId: string): string {
  if (!config.ENABLE_DEV_AUTH) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Dev auth endpoint disabled');
  }
  const expiresIn = config.JWT_EXPIRES_IN;
  return jwt.sign({ sub: userId }, config.JWT_SECRET, { 
    expiresIn: parseInt(expiresIn) || 86400, 
    algorithm: 'HS256' 
  });
}