ALTER TABLE spot.missions ADD COLUMN coffee_price INTEGER NOT NULL DEFAULT 0 CHECK(coffee_price>=0 AND coffee_price<=20000);
ALTER TABLE spot.missions ADD COLUMN settlement TEXT;
