import { createDatabase, type Database } from '@/db/adapter';
import { createPostgresDriver } from '@/db/postgres';

let database: Database | undefined;
export function databaseConfigured() { return !!process.env.DATABASE_URL || (process.env.NODE_ENV !== 'production' && !process.env.VERCEL); }
function getDatabase() {
  if (!databaseConfigured()) return undefined;
  if (database) return database;
  if (process.env.DATABASE_URL) database = createDatabase(createPostgresDriver(process.env.DATABASE_URL));
  else {
    let local: Promise<import('@/db/adapter').Driver> | undefined;
    const driver = () => local ??= import('@/db/local').then(module => module.createLocalDriver());
    database = createDatabase({ execute: async query => (await driver()).execute(query), batch: async queries => (await driver()).batch(queries), transaction: async fn => (await driver()).transaction(fn) });
  }
  return database;
}
export const env = {
  get DB() { return getDatabase(); },
  get GOOGLE_CLIENT_ID() { return process.env.GOOGLE_CLIENT_ID; },
  get GOOGLE_CLIENT_SECRET() { return process.env.GOOGLE_CLIENT_SECRET; },
  get APP_ORIGIN() { return process.env.APP_ORIGIN; },
};
