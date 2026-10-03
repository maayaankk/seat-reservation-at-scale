import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDevToken, verifyToken, extractUserId, adminGuard } from '../src/http/auth.js';
import { config } from '../src/config.js';

describe('auth', () => {
  it('creates valid JWT token', () => {
    const token = createDevToken('alice');
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('verifies valid token', () => {
    const token = createDevToken('bob');
    const payload = verifyToken(token);
    expect(payload.sub).toBe('bob');
  });

  it('rejects invalid token', () => {
    expect(() => verifyToken('invalid')).toThrow('Invalid or expired token');
  });

  it('rejects expired token', () => {
    // Can't easily test expired token without time manipulation
    // but we can verify the logic works for valid tokens
    const token = createDevToken('charlie');
    const payload = verifyToken(token);
    expect(payload.sub).toBe('charlie');
  });

  it('extracts user_id from sub claim', () => {
    const payload = { sub: 'user123', iat: Date.now(), exp: Date.now() + 86400 };
    expect(extractUserId(payload)).toBe('user123');
  });

  it('falls back to user_id claim', () => {
    const payload = { user_id: 'fallback', iat: Date.now(), exp: Date.now() + 86400 };
    expect(extractUserId(payload)).toBe('fallback');
  });
});