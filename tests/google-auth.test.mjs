import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createTestDatabase } from './database.mjs';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';

const built = await build({entryPoints:['lib/google-auth.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const auth = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
let fixtureDatabase;
const config = auth.googleConfig({GOOGLE_CLIENT_ID:'fixture.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fixture-secret',APP_ORIGIN:'https://spot.example'});
let db, privateKey, keys;
before(async()=>{
  fixtureDatabase=await createTestDatabase();db=fixtureDatabase.db;
  const pair=await generateKeyPair('RS256');privateKey=pair.privateKey;
  keys=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:'fixture',alg:'RS256'}]});
});
after(()=>fixtureDatabase.close());
async function signed(nonce,overrides={},signingKey=privateKey){
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({sub:'google-user-1',name:'테스트 친구',email:'friend@example.test',email_verified:true,nonce,iss:'https://accounts.google.com',aud:config.clientId,iat:now,exp:now+3600,...overrides}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(signingKey);
}
async function begin(returnTo='/'){
  const response=await auth.beginGoogleLogin(db,config,returnTo);
  const location=new URL(response.headers.get('location'));
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const state=location.searchParams.get('state');
  return {response,location,cookie,state,request:(search='code=fixture-code')=>new Request(`${config.redirectUri}?state=${state}&${search}`,{headers:{cookie}})};
}
async function rowCount(table){return (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;}

test('Google config only accepts HTTPS origins or loopback HTTP and requires both credentials',()=>{
  assert.equal(auth.googleConfig({}),null);
  assert.equal(auth.googleConfig({GOOGLE_CLIENT_ID:'x',APP_ORIGIN:'https://spot.example'}),null);
  for(const APP_ORIGIN of ['http://spot.example','https://spot.example/path','https://user:pass@spot.example','javascript:alert(1)']) assert.equal(auth.googleConfig({GOOGLE_CLIENT_ID:'x',GOOGLE_CLIENT_SECRET:'s',APP_ORIGIN}),null);
  assert.equal(auth.googleConfig({GOOGLE_CLIENT_ID:'x',GOOGLE_CLIENT_SECRET:'s',APP_ORIGIN:'http://localhost:5173'}).redirectUri,'http://localhost:5173/api/auth/google/callback');
});
test('return paths cannot redirect outside the app and preserve invite only',()=>{
  for(const path of ['https://evil.example','//evil.example','/\\evil.example','/api/auth/google','/login','/signin-with-chatgpt','/%2f%2fevil.example'])assert.equal(auth.safeReturnTo(path),'/');
  assert.equal(auth.safeReturnTo('/health?next=https://evil.example'),'/health');
  assert.equal(auth.safeReturnTo('/health/unknown'),'/');
  assert.equal(auth.safeReturnTo('/?invite=1234567890abcdef&unsafe=1'),'/?invite=1234567890abcdef');
});
test('authorization request includes state, nonce and PKCE without exposing secret',async()=>{
  const flow=await begin('/?invite=1234567890abcdef');
  assert.equal(flow.location.origin,'https://accounts.google.com');
  assert.equal(flow.location.searchParams.get('scope'),'openid email profile');
  assert.equal(flow.location.searchParams.get('code_challenge_method'),'S256');
  assert.equal(flow.location.searchParams.get('redirect_uri'),config.redirectUri);
  assert.ok(!flow.location.href.includes(config.clientSecret));
  assert.match(flow.response.headers.get('set-cookie'),/__Host-spot_oauth=.*HttpOnly; SameSite=Lax.*Secure/);
  const row=await db.prepare('SELECT * FROM oauth_transactions WHERE state_hash=?').bind(await auth.hashToken(flow.state)).first();
  assert.equal(await auth.hashToken(row.verifier),flow.location.searchParams.get('code_challenge'));
  assert.notEqual(row.state_hash,flow.state);
});
test('callback binds the browser, expires and rejects replay',async()=>{
  const flow=await begin();
  await assert.rejects(auth.consumeTransaction(db,flow.state,'wrong-browser'),e=>e.code==='invalid_state');
  const browser=flow.cookie.split('=')[1];
  await auth.consumeTransaction(db,flow.state,browser);
  await assert.rejects(auth.consumeTransaction(db,flow.state,browser),e=>e.code==='invalid_state');
  const expired=await begin();await db.prepare('UPDATE oauth_transactions SET expires_at=0 WHERE state_hash=?').bind(await auth.hashToken(expired.state)).run();
  await assert.rejects(auth.consumeTransaction(db,expired.state,expired.cookie.split('=')[1]),e=>e.code==='invalid_state');
});
test('JWT validation rejects wrong audience, issuer, nonce, email verification, expiration and signature',async()=>{
  const nonce='fixture-nonce';const good=await signed(nonce);
  const user=await auth.verifyGoogleIdentity(good,config.clientId,nonce,keys);
  assert.equal(user.userId,'google:google-user-1');assert.equal(user.provider,'google');
  for(const change of [{aud:'other-client'},{iss:'https://evil.example'},{nonce:'other'},{email_verified:false},{exp:1},{azp:'other'},{sub:''},{aud:[config.clientId,'other']}]){
    await assert.rejects(auth.verifyGoogleIdentity(await signed(nonce,change),config.clientId,nonce,keys),e=>e.code==='invalid_identity');
  }
  const wrong=await generateKeyPair('RS256');
  await assert.rejects(auth.verifyGoogleIdentity(await signed(nonce,{},wrong.privateKey),config.clientId,nonce,keys),e=>e.code==='invalid_identity');
});
test('complete mocked Google exchange creates a hashed session and returns to invited crew',async()=>{
  const flow=await begin('/?invite=1234567890abcdef');
  let exchanges=0;
  const fetcher=async(url,options)=>{
    exchanges++;assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.equal(options.method,'POST');assert.equal(options.body.get('client_secret'),config.clientSecret);
    assert.equal(options.body.get('redirect_uri'),config.redirectUri);
    assert.equal(await auth.hashToken(options.body.get('code_verifier')),flow.location.searchParams.get('code_challenge'));
    return Response.json({id_token:await signed(flow.location.searchParams.get('nonce')),access_token:'not-stored'});
  };
  const result=await auth.finishGoogleLogin(db,config,flow.request(),{fetcher,keys});
  assert.equal(exchanges,1);assert.equal(result.status,303);
  assert.equal(result.headers.get('location'),'https://spot.example/?invite=1234567890abcdef');
  const cookie=result.headers.getSetCookie().find(c=>c.startsWith('__Host-spot_session='));
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);
  const token=cookie.split(';')[0].split('=')[1];
  const stored=await db.prepare('SELECT * FROM auth_sessions WHERE token_hash=?').bind(await auth.hashToken(token)).first();
  assert.notEqual(stored.token_hash,token);assert.equal(stored.user_id,'google:google-user-1');
  assert.equal((await auth.googleSessionUser(db,token)).displayName,'테스트 친구');
  await assert.rejects(auth.finishGoogleLogin(db,config,flow.request(),{fetcher,keys}),e=>e.code==='invalid_state');
  assert.equal(exchanges,1);
});
test('cancelled or failed Google exchanges do not create sessions',async()=>{
  const count=await rowCount('auth_sessions');
  const cancelled=await begin('/?invite=1234567890abcdef');
  await assert.rejects(auth.finishGoogleLogin(db,config,cancelled.request('error=access_denied'),{fetcher:()=>{throw new Error('Must not call Google');},keys}),e=>e.code==='cancelled'&&e.returnTo==='/?invite=1234567890abcdef');
  const failed=await begin();
  await assert.rejects(auth.finishGoogleLogin(db,config,failed.request(),{fetcher:async()=>new Response('invalid_grant',{status:400}),keys}),e=>e.code==='google_unavailable');
  assert.equal(await rowCount('auth_sessions'),count);
});
test('session expiry, revocation and malformed cookies fail closed',async()=>{
  const user={userId:'google:other-user',displayName:'Friend',email:'same-email@example.test',provider:'google'};
  const token=await auth.createGoogleSession(db,user);
  assert.equal((await auth.googleSessionUser(db,token)).userId,user.userId);
  await auth.revokeGoogleSession(db,token);assert.equal(await auth.googleSessionUser(db,token),null);
  const expired=await auth.createGoogleSession(db,user);await db.prepare('UPDATE auth_sessions SET expires_at=0 WHERE token_hash=?').bind(await auth.hashToken(expired)).run();
  assert.equal(await auth.googleSessionUser(db,expired),null);
  assert.equal(auth.readCookie(new Request('https://spot.example',{headers:{cookie:'__Host-spot_session=forged'}}),'__Host-spot_session'),null);
  const duplicate=new Request('https://spot.example',{headers:{cookie:`__Host-spot_session=${token}; __Host-spot_session=${token}`}});
  assert.equal(auth.readCookie(duplicate,'__Host-spot_session'),null);
});

test('identity uses Google subject, so matching emails never merge accounts',async()=>{
  const first=await auth.verifyGoogleIdentity(await signed('nonce'),config.clientId,'nonce',keys);
  const changedEmail=await auth.verifyGoogleIdentity(await signed('nonce',{email:'new@example.test'}),config.clientId,'nonce',keys);
  const other=await auth.verifyGoogleIdentity(await signed('nonce',{sub:'other-google-user'}),config.clientId,'nonce',keys);
  assert.equal(first.userId,changedEmail.userId);
  assert.notEqual(first.userId,other.userId);
});

test('login persists for 30 days and renewal never revives expired or revoked sessions',async()=>{
 const now=Date.now(),user={userId:'google:renew',displayName:'Renew',email:'renew@example.test',provider:'google'};
 assert.equal(auth.SESSION_SECONDS,30*86400);
 const token=await auth.createGoogleSession(db,user),hash=await auth.hashToken(token);
 assert.equal(await auth.renewGoogleSession(db,token,now),false);
 await db.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').bind(now+86400000,hash).run();
 assert.equal(await auth.renewGoogleSession(db,token,now),true);
 assert.equal(Number((await db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').bind(hash).first()).expires_at),now+30*86400000);
 await auth.revokeGoogleSession(db,token);assert.equal(await auth.renewGoogleSession(db,token,now),false);
 const expired=await auth.createGoogleSession(db,user);await db.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').bind(now-1,await auth.hashToken(expired)).run();
 assert.equal(await auth.renewGoogleSession(db,expired,now),false);
 assert.match(auth.authCookie('session',token,'https://spot.example',auth.SESSION_SECONDS),/Max-Age=2592000/);
});

test('a new Google login rotates an existing app session',async()=>{
  const old=await auth.createGoogleSession(db,{userId:'google:old',displayName:'Old',email:'old@example.test',provider:'google'});
  const flow=await begin();
  const request=new Request(flow.request(),{headers:{cookie:`${flow.cookie}; __Host-spot_session=${old}`}});
  const result=await auth.finishGoogleLogin(db,config,request,{keys,fetcher:async()=>Response.json({id_token:await signed(flow.location.searchParams.get('nonce'))})});
  assert.equal(result.status,303);assert.equal(await auth.googleSessionUser(db,old),null);
});
