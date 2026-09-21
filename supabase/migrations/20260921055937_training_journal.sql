CREATE TABLE spot.training_journal (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('body','meal','cardio','recovery')),
 date TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), updated_at BIGINT NOT NULL
);
CREATE INDEX journal_user_date ON spot.training_journal(user_id,date DESC,id DESC);
ALTER TABLE spot.training_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spot.training_journal FROM PUBLIC;
CREATE TABLE spot.training_questions (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL,author_name TEXT NOT NULL,parent_id TEXT REFERENCES spot.training_questions(id),
 body TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),revision INTEGER NOT NULL DEFAULT 1,created_at BIGINT NOT NULL
);
CREATE INDEX questions_parent_created ON spot.training_questions(parent_id,created_at DESC,id);
CREATE INDEX questions_user_created ON spot.training_questions(user_id,created_at DESC);
CREATE TABLE spot.training_question_reports (
 question_id TEXT NOT NULL REFERENCES spot.training_questions(id), user_id TEXT NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(question_id,user_id)
);
ALTER TABLE spot.training_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot.training_question_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spot.training_questions,spot.training_question_reports FROM PUBLIC;
