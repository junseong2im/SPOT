import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './database.mjs';

test('PostgreSQL batch rolls back the complete operation on a constraint failure',async()=>{
 const fixture=await createTestDatabase();const db=fixture.db;
 try{
  await assert.rejects(db.batch([
   db.prepare('INSERT INTO crews(id,name,invite,owner,state) VALUES(?,?,?,?,?)').bind('rollback','Test','invite','owner','{}'),
   db.prepare('INSERT INTO members(crew_id,user_id,name) VALUES(?,?,?)').bind('missing','member','Member'),
  ]));
  assert.equal(await db.prepare('SELECT * FROM crews WHERE id=?').bind('rollback').first(),null);
 }finally{await fixture.close();}
});
test('SQL values remain parameters and question marks inside text remain literal',async()=>{
 const fixture=await createTestDatabase();
 try{
  const value="'); DROP TABLE spot.crews; --";
  const row=await fixture.db.prepare("SELECT '?' AS marker, ?::text AS value").bind(value).first();
  assert.equal(row.marker,'?');assert.equal(row.value,value);
  assert.equal((await fixture.db.prepare('SELECT count(*)::int AS n FROM crews').first()).n,0);
 }finally{await fixture.close();}
});
test('Supabase tables have RLS enabled and PUBLIC has no schema access',async()=>{
 const fixture=await createTestDatabase();
 try{
  const {rows}=await fixture.client.query("SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='spot' AND c.relkind='r'");
  assert.equal(rows.length,20);assert.ok(rows.every(row=>row.relrowsecurity));
  await fixture.client.exec('CREATE ROLE fixture_anon');
  const result=await fixture.client.query("SELECT has_schema_privilege('fixture_anon','spot','USAGE') AS allowed");
  assert.equal(result.rows[0].allowed,false);
 }finally{await fixture.close();}
});
