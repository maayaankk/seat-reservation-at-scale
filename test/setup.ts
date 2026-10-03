import { createPools } from '../src/db/pools.js';
import { setRequestContext } from '../src/http/context.js';

createPools();

// Helper to set up auth context for tests
export function setupAuthContext(userId: string = 'test-user'): void {
  const requestId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setRequestContext({ requestId, userId, startTime: Date.now() });
}