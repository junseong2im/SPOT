ALTER TABLE spot.suggestions DROP CONSTRAINT suggestions_category_check;
ALTER TABLE spot.suggestions ADD CONSTRAINT suggestions_category_check CHECK(category IN ('feature','music','bug','other','guide'));
CREATE INDEX suggestions_guide_title ON spot.suggestions(title,user_id) WHERE category='guide' AND status NOT IN ('done','closed');
