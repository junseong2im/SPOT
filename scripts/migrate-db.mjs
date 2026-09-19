import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to your Supabase PostgreSQL connection string.');
const url = new URL(process.env.DATABASE_URL);
let ssl;
if (url.hostname.endsWith('.supabase.com') || url.hostname.endsWith('.supabase.co')) {
  const response = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt');
  if (!response.ok) throw new Error('Could not load the official Supabase CA');
  ssl = { ca: await response.text(), rejectUnauthorized: true };
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
}
const client = new Client({ connectionString: url.href, ssl });
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
