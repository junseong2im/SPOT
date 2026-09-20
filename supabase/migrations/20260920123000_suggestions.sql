CREATE TABLE spot.suggestions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 author_name TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('feature','music','bug','other')),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 link TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','reviewing','planned','done','closed')),
 reply TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL
);
CREATE INDEX suggestions_author_created ON spot.suggestions(user_id,created_at DESC);
ALTER TABLE spot.suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spot.suggestions FROM PUBLIC;
