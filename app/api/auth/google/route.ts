import { env } from '@/lib/runtime';
import { beginGoogleLogin, googleConfig, redirectResponse, safeReturnTo } from '@/lib/google-auth';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = googleConfig(env);
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
  if (!config || !env.DB) return redirectResponse(`/login?error=not_configured&returnTo=${encodeURIComponent(returnTo)}`);
  if (url.origin !== config.origin) return redirectResponse(`${config.origin}/login?returnTo=${encodeURIComponent(returnTo)}`);
  try { return await beginGoogleLogin(env.DB, config, returnTo); }
  catch { return redirectResponse(`/login?error=unavailable&returnTo=${encodeURIComponent(returnTo)}`); }
}
