import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const crews = sqliteTable('crews', {
  id: text('id').primaryKey(), name: text('name').notNull(),
  invite: text('invite').notNull().unique(), owner: text('owner').notNull(),
  state: text('state').notNull(), revision: integer('revision').notNull().default(1),
});
export const members = sqliteTable('members', {
  crewId: text('crew_id').notNull().references(() => crews.id),
  userId: text('user_id').notNull(), name: text('name').notNull(),
}, t => [primaryKey({columns:[t.crewId,t.userId]}), index('idx_members_user').on(t.userId)]);
export const personal = sqliteTable('personal', {
  crewId: text('crew_id').notNull().references(() => crews.id),
  userId: text('user_id').notNull(), routineId: text('routine_id').notNull(),
  content: text('content').notNull(), baseVersion: integer('base_version').notNull(),
  revision: integer('revision').notNull().default(1),
}, t => [primaryKey({columns:[t.crewId,t.userId,t.routineId]})]);

export const oauthTransactions = sqliteTable('oauth_transactions', {
  stateHash: text('state_hash').primaryKey(),
  browserHash: text('browser_hash').notNull(),
  verifier: text('verifier').notNull(),
  nonce: text('nonce').notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: integer('expires_at').notNull(),
  consumed: integer('consumed').notNull().default(0),
}, t => [index('idx_oauth_expiry').on(t.expiresAt)]);

export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revoked: integer('revoked').notNull().default(0),
}, t => [index('idx_auth_sessions_expiry').on(t.expiresAt)]);
