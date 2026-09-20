CREATE TABLE spot.checkins (
 crew_id TEXT NOT NULL REFERENCES spot.crews(id),
 session_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 session_version INTEGER NOT NULL,
 workout_date TEXT NOT NULL,
 checked_at BIGINT NOT NULL,
 confirmed_by TEXT,
 confirmed_at BIGINT,
 PRIMARY KEY(crew_id,session_id,user_id)
);
CREATE TABLE spot.missions (
 id TEXT PRIMARY KEY,
 crew_id TEXT NOT NULL REFERENCES spot.crews(id),
 creator TEXT NOT NULL,
 title TEXT NOT NULL,
 starts TEXT NOT NULL,
 ends TEXT NOT NULL,
 target INTEGER NOT NULL,
 promise TEXT NOT NULL DEFAULT '',
 cancelled INTEGER NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL
);
CREATE TABLE spot.mission_members (
 mission_id TEXT NOT NULL REFERENCES spot.missions(id),
 user_id TEXT NOT NULL,
 joined_at BIGINT NOT NULL,
 withdrawn INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(mission_id,user_id)
);
CREATE INDEX checkins_crew_date ON spot.checkins(crew_id,workout_date);
CREATE INDEX missions_crew_created ON spot.missions(crew_id,created_at DESC);
ALTER TABLE spot.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.mission_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spot.checkins,spot.missions,spot.mission_members FROM PUBLIC;
