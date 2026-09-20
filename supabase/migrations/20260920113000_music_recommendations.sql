CREATE TABLE spot.app_admins (user_id TEXT PRIMARY KEY);
CREATE TABLE spot.music_recommendations (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 artist TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 youtube_url TEXT NOT NULL,
 links TEXT NOT NULL DEFAULT '[]',
 revision INTEGER NOT NULL DEFAULT 1,
 archived INTEGER NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL
);
ALTER TABLE spot.app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.music_recommendations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spot.app_admins,spot.music_recommendations FROM PUBLIC;
