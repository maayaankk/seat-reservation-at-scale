import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  userId?: string;
  showId?: string;
  startTime: number;
}

const contextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return contextStorage.getStore();
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return contextStorage.run(ctx, fn);
}

export function setRequestContext(ctx: RequestContext) {
  return contextStorage.enterWith(ctx);
}