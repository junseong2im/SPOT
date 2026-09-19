CREATE SCHEMA IF NOT EXISTS spot;
REVOKE ALL ON SCHEMA spot FROM PUBLIC;

CREATE TABLE spot.crews (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, invite TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE spot.members (
  crew_id TEXT NOT NULL REFERENCES spot.crews(id), user_id TEXT NOT NULL,
  name TEXT NOT NULL, PRIMARY KEY (crew_id, user_id)
);
CREATE INDEX idx_members_user ON spot.members(user_id);
CREATE TABLE spot.personal (
  crew_id TEXT NOT NULL REFERENCES spot.crews(id), user_id TEXT NOT NULL,
  routine_id TEXT NOT NULL, content TEXT NOT NULL, base_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(crew_id,user_id,routine_id)
);
CREATE TABLE spot.oauth_transactions (
  state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, verifier TEXT NOT NULL,
  nonce TEXT NOT NULL, return_to TEXT NOT NULL, expires_at BIGINT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_oauth_expiry ON spot.oauth_transactions(expires_at);
CREATE TABLE spot.auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, display_name TEXT NOT NULL,
  email TEXT NOT NULL, expires_at BIGINT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_auth_sessions_expiry ON spot.auth_sessions(expires_at);

ALTER TABLE spot.crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.oauth_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA spot FROM PUBLIC;
