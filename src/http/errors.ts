export const ERROR_CODES = {
  SEAT_TAKEN: 'SEAT_TAKEN',
  SEAT_NOT_FOUND: 'SEAT_NOT_FOUND',
  USER_LIMIT_EXCEEDED: 'USER_LIMIT_EXCEEDED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_REPLAY: 'IDEMPOTENCY_REPLAY',
  INVALID_BODY: 'INVALID_BODY',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  SHOW_EXISTS: 'SHOW_EXISTS',
  TRY_AGAIN: 'TRY_AGAIN',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function createErrorResponse(error: AppError) {
  const body: Record<string, unknown> = {
    error: error.name.replace('Error', ''),
    message: error.message,
    code: error.code,
  };
  if (error.details) body.details = error.details;
  return body;
}

export const errorMap: Record<ErrorCode, { status: number; defaultMessage: string }> = {
  [ERROR_CODES.SEAT_TAKEN]: { status: 409, defaultMessage: 'Seat is already taken' },
  [ERROR_CODES.SEAT_NOT_FOUND]: { status: 404, defaultMessage: 'Seat not found' },
  [ERROR_CODES.USER_LIMIT_EXCEEDED]: { status: 409, defaultMessage: 'Per-user seat limit exceeded' },
  [ERROR_CODES.IDEMPOTENCY_CONFLICT]: { status: 409, defaultMessage: 'Idempotency key already used for a different request' },
  [ERROR_CODES.IDEMPOTENCY_REPLAY]: { status: 201, defaultMessage: 'Request replayed' },
  [ERROR_CODES.INVALID_BODY]: { status: 400, defaultMessage: 'Invalid request body' },
  [ERROR_CODES.UNAUTHORIZED]: { status: 401, defaultMessage: 'Unauthorized' },
  [ERROR_CODES.FORBIDDEN]: { status: 403, defaultMessage: 'Forbidden' },
  [ERROR_CODES.NOT_FOUND]: { status: 404, defaultMessage: 'Not found' },
  [ERROR_CODES.SHOW_EXISTS]: { status: 409, defaultMessage: 'Show already exists' },
  [ERROR_CODES.TRY_AGAIN]: { status: 503, defaultMessage: 'Service temporarily unavailable, please retry' },
  [ERROR_CODES.INTERNAL]: { status: 500, defaultMessage: 'Internal server error' },
};

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof Error) {
    return new AppError(500, ERROR_CODES.INTERNAL, err.message);
  }
  return new AppError(500, ERROR_CODES.INTERNAL, 'Unknown error');
}