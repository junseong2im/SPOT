import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { cookieName, googleSessionUser, readCookie, type AuthUser } from './google-auth';

export async function getAppUser(request: Request): Promise<AuthUser | null> {
  const name = cookieName('session', request.url);
  const cookieHeader = request.headers.get('cookie') ?? '';
  if (cookieHeader.split(';').some(c => c.trim().startsWith(`${name}=`))) {
    const token = readCookie(request, name);
    if (!token || !env.DB) return null;
    // Never silently switch back to another account if a Google session expired.
    return googleSessionUser(env.DB, token);
  }
  const user = await getChatGPTUser();
  return user ? { userId: user.userId, displayName: user.displayName, email: user.email, provider: 'chatgpt' } : null;
}
