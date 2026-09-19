import { env } from 'cloudflare:workers';
import { chatGPTSignInPath } from '@/app/chatgpt-auth';
import { authCookie, cookieName, readCookie, redirectResponse, revokeGoogleSession, safeReturnTo } from '@/lib/google-auth';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) return new Response('Forbidden', { status: 403 });
  try {
    const form = await request.formData();
    const value = form.get('returnTo');
    const returnTo = safeReturnTo(typeof value === 'string' ? value : '/');
    const token = readCookie(request, cookieName('session', origin));
    if (token) {
      if (!env.DB) throw new Error('Database unavailable');
      await revokeGoogleSession(env.DB, token);
    }
    return redirectResponse(chatGPTSignInPath(returnTo), [authCookie('session', '', origin, 0), authCookie('oauth', '', origin, 0)]);
  } catch { return redirectResponse('/login?error=unavailable'); }
}
