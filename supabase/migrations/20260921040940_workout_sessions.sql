CREATE TABLE spot.training_profiles (
 user_id TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '{}', updated_at BIGINT NOT NULL
);
CREATE TABLE spot.workout_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, crew_id TEXT NOT NULL,
 routine_id TEXT NOT NULL, routine_name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','discarded')),
 state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 started_at BIGINT NOT NULL, finished_at BIGINT, updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX workout_one_active_per_user ON spot.workout_sessions(user_id) WHERE status='active';
CREATE INDEX workout_user_finished ON spot.workout_sessions(user_id,finished_at DESC) WHERE status='completed';
ALTER TABLE spot.training_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.workout_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spot.training_profiles,spot.workout_sessions FROM PUBLIC;
