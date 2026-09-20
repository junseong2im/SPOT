import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Driver, SqlQuery } from './adapter';

export function createLocalDriver(directory = '.data/postgres'): Driver {
  let client: PGlite;
  let initialization: Promise<void> | undefined;
  async function initialize() {
    await mkdir(path.dirname(directory), { recursive: true });
    client = new PGlite(directory);
    await client.waitReady;
    const exists = await client.query("SELECT to_regclass('spot.crews') AS present");
    if (!(exists.rows[0] as { present: string | null }).present) {
      await client.exec(await readFile(path.join(process.cwd(), 'supabase/migrations/202609200001_spot.sql'), 'utf8'));
    }
    await client.exec('CREATE TABLE IF NOT EXISTS spot.local_migrations(name TEXT PRIMARY KEY)');
    for (const name of (await readdir(path.join(process.cwd(), 'supabase/migrations'))).filter(n => n.endsWith('.sql') && n !== '202609200001_spot.sql').sort()) {
      await client.transaction(async tx => {
        const applied = await tx.query('SELECT name FROM spot.local_migrations WHERE name=$1', [name]);
        if (!applied.rows.length) { await tx.exec(await readFile(path.join(process.cwd(), 'supabase/migrations', name), 'utf8')); await tx.query('INSERT INTO spot.local_migrations(name) VALUES($1)', [name]); }
      });
    }
  }
  async function ready() { await (initialization ??= initialize()); }
  const run = async (connection: Pick<PGlite, 'query'>, query: SqlQuery) => {
    const result = await connection.query<Record<string, unknown>>(query.sql, query.args);
    return { rows: result.rows, changes: result.affectedRows ?? 0 };
  };
  return {
    async transaction(fn) {
      await ready();
      return client.transaction(async transaction => {
        const driver: Driver = {
          execute: query => run(transaction, query),
          batch: async queries => { const results = []; for (const query of queries) results.push(await run(transaction, query)); return results; },
          transaction: inner => inner(driver),
        };
        return fn(driver);
      });
    },
    async execute(query) { await ready(); return run(client, query); },
    async batch(queries) {
      await ready();
      return client.transaction(async transaction => {
        const results = [];
        for (const query of queries) results.push(await run(transaction, query));
        return results;
      });
    },
  };
}
