export function generateUuid(): string {
  return crypto.randomUUID();
}

export function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export function validateUuidParam(id: string, paramName = 'id'): void {
  if (!isValidUuid(id)) {
    const error = new Error(`Invalid ${paramName}`);
    const err = error as Error & { statusCode?: number; code?: string };
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw error;
  }
}