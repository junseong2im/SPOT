ALTER TABLE spot.crews ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spot.members ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
CREATE TABLE spot.notification_preferences (
 user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, push_enabled INTEGER NOT NULL DEFAULT 0,
 reminder_minutes INTEGER NOT NULL DEFAULT 60 CHECK(reminder_minutes IN (10,30,60,1440))
);
CREATE TABLE spot.notifications (
 id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, crew_id TEXT NOT NULL REFERENCES spot.crews(id),
 user_id TEXT NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 due_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, read_at BIGINT,
 push_state TEXT NOT NULL DEFAULT 'queued', lease_until BIGINT, result TEXT,
 created_at BIGINT NOT NULL
);
CREATE INDEX idx_notifications_user_due ON spot.notifications(user_id,due_at DESC);
CREATE INDEX idx_notifications_queue ON spot.notifications(due_at) WHERE push_state='queued';
CREATE INDEX idx_notifications_session ON spot.notifications(crew_id,session_id);
CREATE TABLE spot.push_subscriptions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL, auth TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL
);
CREATE INDEX idx_push_subscriptions_user ON spot.push_subscriptions(user_id) WHERE active=1;
ALTER TABLE spot.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spot.notification_preferences,spot.notifications,spot.push_subscriptions FROM PUBLIC;
