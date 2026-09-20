import { Pool } from 'pg';
import type { Driver, SqlQuery } from './adapter';
import { supabaseCa } from './supabase-ca';

export function createPostgresDriver(connectionString: string): Driver {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL connection string');
  const supabase = url.hostname.endsWith('.supabase.com') || url.hostname.endsWith('.supabase.co');
  if (supabase) {
    // pg URL SSL parameters override explicit TLS settings; use the trusted CA instead.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  }
  const pool = new Pool({ connectionString: url.href, ...(supabase ? { ssl: { ca: supabaseCa, rejectUnauthorized: true } } : {}), max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, allowExitOnIdle: true });
  // Do not log connection strings or raw provider errors containing connection metadata.
  pool.on('error', () => console.error('Database connection interrupted'));
  const run = async (client: Pick<Pool, 'query'>, query: SqlQuery) => {
    const result = await client.query(query.sql, query.args);
    return { rows: result.rows, changes: result.rowCount ?? 0 };
  };
  return {
    execute: query => run(pool, query),
    async transaction(fn) {
      const client = await pool.connect();
      const driver: Driver = {
        execute: query => run(client, query),
        batch: async queries => { const results = []; for (const query of queries) results.push(await run(client, query)); return results; },
        transaction: inner => inner(driver),
      };
      try { await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='15s'"); const result = await fn(driver); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async batch(queries) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const query of queries) results.push(await run(client, query));
        await client.query('COMMIT');
        return results;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
