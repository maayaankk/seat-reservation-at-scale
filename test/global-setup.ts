import 'dotenv/config';
import { runMigrations, waitForDb } from '../src/db/migrate.js';

export default async function globalSetup() {
  await waitForDb();
  await runMigrations();
  console.log('Global setup: Migrations completed');
}