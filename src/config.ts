import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('24h'),
  ADMIN_TOKEN: z.string().min(16),
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url(),
  ENABLE_DEV_AUTH: z.coerce.boolean().default(false),
});

export const config = envSchema.parse(process.env);

export const isDev = config.NODE_ENV === 'development';
export const isTest = config.NODE_ENV === 'test';