import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to your Supabase PostgreSQL connection string.');
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(await readFile('supabase/migrations/202609200001_spot.sql', 'utf8'));
  await client.query('COMMIT');
  console.log('SPOT schema created.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed. No partial schema changes were committed.');
  process.exitCode = 1;
} finally { await client.end(); }
