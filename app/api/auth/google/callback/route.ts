import { env } from '@/lib/runtime';
import { AuthError, authCookie, finishGoogleLogin, googleConfig, redirectResponse } from '@/lib/google-auth';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const config = googleConfig(env);
  if (!config || !env.DB) return redirectResponse('/login?error=not_configured');
  if (new URL(request.url).origin !== config.origin) return redirectResponse(`${config.origin}/login?error=invalid_state`);
  try { return await finishGoogleLogin(env.DB, config, request); }
  catch (error) {
    const code = error instanceof AuthError ? error.code : 'unavailable';
    const returnTo = error instanceof AuthError ? error.returnTo : '/';
    // Never log OAuth codes, provider tokens, cookie values, or credentials.
    return redirectResponse(`${config.origin}/login?error=${code}&returnTo=${encodeURIComponent(returnTo)}`, [authCookie('oauth', '', config.origin, 0)]);
  }
}
