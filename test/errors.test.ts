import { describe, it, expect } from 'vitest';
import { AppError, ERROR_CODES, createErrorResponse, isAppError, toAppError, errorMap } from '../src/http/errors.js';

describe('errors', () => {
  it('creates AppError with correct properties', () => {
    const err = new AppError(409, ERROR_CODES.SEAT_TAKEN, 'Seat A12 is taken');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe(ERROR_CODES.SEAT_TAKEN);
    expect(err.message).toBe('Seat A12 is taken');
    expect(err.name).toBe('AppError');
  });

  it('creates error response in unified format', () => {
    const err = new AppError(409, ERROR_CODES.SEAT_TAKEN, 'Seat taken');
    const response = createErrorResponse(err);
    expect(response).toEqual({
      error: 'App',
      message: 'Seat taken',
      code: 'SEAT_TAKEN',
    });
  });

  it('includes details in error response when provided', () => {
    const err = new AppError(400, ERROR_CODES.INVALID_BODY, 'Invalid body', { field: 'seats' });
    const response = createErrorResponse(err);
    expect(response.details).toEqual({ field: 'seats' });
  });

  it('maps error codes to status and default message', () => {
    expect(errorMap[ERROR_CODES.SEAT_TAKEN]).toEqual({ status: 409, defaultMessage: 'Seat is already taken' });
    expect(errorMap[ERROR_CODES.UNAUTHORIZED]).toEqual({ status: 401, defaultMessage: 'Unauthorized' });
    expect(errorMap[ERROR_CODES.INTERNAL]).toEqual({ status: 500, defaultMessage: 'Internal server error' });
  });

  it('identifies AppError correctly', () => {
    const appErr = new AppError(409, ERROR_CODES.SEAT_TAKEN, 'Taken');
    const regularErr = new Error('regular');
    expect(isAppError(appErr)).toBe(true);
    expect(isAppError(regularErr)).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it('converts unknown errors to AppError', () => {
    const regularErr = new Error('something failed');
    const converted = toAppError(regularErr);
    expect(converted.statusCode).toBe(500);
    expect(converted.code).toBe(ERROR_CODES.INTERNAL);
    expect(converted.message).toBe('something failed');

    const unknown = 'string error';
    const converted2 = toAppError(unknown);
    expect(converted2.statusCode).toBe(500);
    expect(converted2.code).toBe(ERROR_CODES.INTERNAL);
  });
});