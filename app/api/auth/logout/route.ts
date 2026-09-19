import { env } from '@/lib/runtime';
import { authCookie, cookieName, readCookie, redirectResponse, revokeGoogleSession } from '@/lib/google-auth';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) return new Response('Forbidden', { status: 403 });
  const token = readCookie(request, cookieName('session', origin));
  try {
    if (token) {
      if (!env.DB) throw new Error('Database unavailable');
      await revokeGoogleSession(env.DB, token);
    }
    return redirectResponse('/login', [authCookie('session', '', origin, 0), authCookie('oauth', '', origin, 0)]);
  } catch { return redirectResponse('/login?error=logout_failed'); }
}
