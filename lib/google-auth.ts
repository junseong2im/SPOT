import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type GoogleConfig = { clientId: string; clientSecret: string; origin: string; redirectUri: string };
export type AuthUser = { userId: string; displayName: string; email: string; provider: 'google' | 'chatgpt' };
export type AuthEnvironment = { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; APP_ORIGIN?: string };
export class AuthError extends Error {
  constructor(public code: 'not_configured' | 'invalid_state' | 'cancelled' | 'google_unavailable' | 'invalid_identity', public returnTo = '/') { super(code); }
}
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const FLOW_SECONDS = 10 * 60;
const GOOGLE_AUTHORIZATION = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 10000 });

export function googleConfig(environment: AuthEnvironment): GoogleConfig | null {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !environment.APP_ORIGIN) return null;
  try {
    const origin = new URL(environment.APP_ORIGIN);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return null;
    if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local)) return null;
    return { clientId, clientSecret, origin: origin.origin, redirectUri: `${origin.origin}/api/auth/google/callback` };
  } catch { return null; }
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://spot.invalid');
    if (url.origin !== 'https://spot.invalid') return '/';
    // Only the actual product route is a valid post-login destination.
    if (url.pathname !== '/') return '/';
    const invite = url.searchParams.get('invite');
    return invite && /^[a-zA-Z0-9_-]{16,100}$/.test(invite) ? `/?invite=${encodeURIComponent(invite)}` : '/';
  } catch { return '/'; }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function hashToken(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function cookieName(kind: 'session' | 'oauth', origin: string) {
  return `${new URL(origin).protocol === 'https:' ? '__Host-' : ''}spot_${kind}`;
}
export function authCookie(kind: 'session' | 'oauth', value: string, origin: string, maxAge: number) {
  const secure = new URL(origin).protocol === 'https:';
  return `${cookieName(kind, origin)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export function readCookie(request: Request, name: string): string | null {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(c => c.trim()).filter(c => c.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function redirectResponse(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

export async function beginGoogleLogin(db: D1Database, config: GoogleConfig, returnTo: string) {
  const state = randomToken(), browser = randomToken(), verifier = randomToken(), nonce = randomToken();
  await db.prepare('INSERT INTO oauth_transactions(state_hash,browser_hash,verifier,nonce,return_to,expires_at,consumed) VALUES(?,?,?,?,?,?,0)')
    .bind(await hashToken(state), await hashToken(browser), verifier, nonce, safeReturnTo(returnTo), Date.now() + FLOW_SECONDS * 1000).run();
  const url = new URL(GOOGLE_AUTHORIZATION);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: await hashToken(verifier), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  return redirectResponse(url.href, [authCookie('oauth', browser, config.origin, FLOW_SECONDS)]);
}

type Transaction = { verifier: string; nonce: string; return_to: string };
export async function consumeTransaction(db: D1Database, state: string | null, browser: string | null): Promise<Transaction> {
  if (!state || !browser || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AuthError('invalid_state');
  const transaction = await db.prepare('UPDATE oauth_transactions SET consumed=1 WHERE state_hash=? AND browser_hash=? AND expires_at>? AND consumed=0 RETURNING verifier,nonce,return_to')
    .bind(await hashToken(state), await hashToken(browser), Date.now()).first<Transaction>();
  if (!transaction) throw new AuthError('invalid_state');
  return transaction;
}

export async function verifyGoogleIdentity(idToken: string, clientId: string, nonce: string, keys: JWTVerifyGetKey = googleKeys): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(idToken, keys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'nonce'], clockTolerance: 5, maxTokenAge: '10m' });
    if (payload.nonce !== nonce || (payload.azp !== undefined && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new Error('Invalid token binding');
    if (!payload.sub || payload.sub.length > 255 || payload.email_verified !== true || typeof payload.email !== 'string' || !payload.email || payload.email.length > 320) throw new Error('Invalid profile');
    return { userId: `google:${payload.sub}`, displayName: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 100) : payload.email, email: payload.email, provider: 'google' };
  } catch { throw new AuthError('invalid_identity'); }
}

export async function createGoogleSession(db: D1Database, user: AuthUser): Promise<string> {
  const token = randomToken();
  await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,display_name,email,expires_at,revoked) VALUES(?,?,?,?,?,0)')
    .bind(await hashToken(token), user.userId, user.displayName, user.email, Date.now() + SESSION_SECONDS * 1000).run();
  return token;
}
export async function googleSessionUser(db: D1Database, token: string): Promise<AuthUser | null> {
  const user = await db.prepare('SELECT user_id AS userId,display_name AS displayName,email FROM auth_sessions WHERE token_hash=? AND expires_at>? AND revoked=0')
    .bind(await hashToken(token), Date.now()).first<Omit<AuthUser, 'provider'>>();
  return user ? { ...user, provider: 'google' } : null;
}
export async function revokeGoogleSession(db: D1Database, token: string) {
  await db.prepare('UPDATE auth_sessions SET revoked=1 WHERE token_hash=?').bind(await hashToken(token)).run();
}

export async function finishGoogleLogin(db: D1Database, config: GoogleConfig, request: Request, options: { fetcher?: typeof fetch; keys?: JWTVerifyGetKey } = {}): Promise<Response> {
  const url = new URL(request.url);
  const flow = await consumeTransaction(db, url.searchParams.get('state'), readCookie(request, cookieName('oauth', config.origin)));
  try {
  if (url.searchParams.has('error')) throw new AuthError(url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'google_unavailable');
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) throw new AuthError('invalid_state');
  const fetcher = options.fetcher ?? fetch;
  let tokens: { id_token?: unknown };
  try {
    const response = await fetcher(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Google rejected exchange');
    tokens = await response.json() as { id_token?: unknown };
  } catch { throw new AuthError('google_unavailable'); }
  if (typeof tokens.id_token !== 'string') throw new AuthError('invalid_identity');
  const user = await verifyGoogleIdentity(tokens.id_token, config.clientId, flow.nonce, options.keys);
  const token = await createGoogleSession(db, user);
  const previous = readCookie(request, cookieName('session', config.origin));
  if (previous) await revokeGoogleSession(db, previous);
  return redirectResponse(new URL(safeReturnTo(flow.return_to), config.origin).href, [authCookie('session', token, config.origin, SESSION_SECONDS), authCookie('oauth', '', config.origin, 0)]);
  } catch (error) {
    if (error instanceof AuthError) { error.returnTo = safeReturnTo(flow.return_to); throw error; }
    throw new AuthError('google_unavailable', safeReturnTo(flow.return_to));
  }
}
