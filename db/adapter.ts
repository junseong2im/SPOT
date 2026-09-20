export interface QueryResult<T = Record<string, unknown>> { results: T[]; meta: { changes: number }; success: boolean }
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult>;
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<QueryResult[]>; transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> }
export type SqlQuery = { sql: string; args: unknown[] };
export interface Driver { execute(query: SqlQuery): Promise<{ rows: Record<string, unknown>[]; changes: number }>; batch(queries: SqlQuery[]): Promise<{ rows: Record<string, unknown>[]; changes: number }[]>; transaction<T>(fn: (driver: Driver) => Promise<T>): Promise<T> }

// The application owns these fixed SQL statements; values always remain bound parameters.
export function postgresSql(sql: string) {
  let parameter = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?|\b(?:crews|members|personal|oauth_transactions|auth_sessions|notifications|notification_preferences|push_subscriptions|app_admins|music_recommendations|suggestions|checkins|missions|mission_members)\b/g, token => {
    if (token === '?') return `$${++parameter}`;
    if (token.startsWith("'") || token.startsWith('"')) return token;
    return `spot.${token}`;
  });
}
export function createDatabase(driver: Driver): Database {
  class Prepared implements Statement {
    constructor(readonly sql: string, readonly args: unknown[] = []) {}
    bind(...values: unknown[]) { return new Prepared(this.sql, values); }
    async all<T = Record<string, unknown>>(): Promise<QueryResult<T>> { const value = await driver.execute({ sql: postgresSql(this.sql), args: this.args }); return { results: value.rows as T[], meta: { changes: value.changes }, success: true }; }
    async first<T = Record<string, unknown>>() { return (await this.all<T>()).results[0] ?? null; }
    async run() { return this.all(); }
  }
  return {
    transaction: fn => driver.transaction(transaction => fn(createDatabase(transaction))),
    prepare: sql => new Prepared(sql),
    async batch(statements) {
      const queries = statements.map(statement => {
        if (!(statement instanceof Prepared)) throw new Error('Statements must belong to this database');
        return { sql: postgresSql(statement.sql), args: statement.args };
      });
      return (await driver.batch(queries)).map(value => ({ results: value.rows, meta: { changes: value.changes }, success: true }));
    },
  };
}
