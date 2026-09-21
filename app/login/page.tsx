import { env } from '@/lib/runtime';
import { Dumbbell, ArrowLeft, ArrowUpRight } from 'lucide-react';
import { googleConfig, safeReturnTo } from '@/lib/google-auth';
export const dynamic = 'force-dynamic';

const messages: Record<string, string> = {
  not_configured: 'Google 로그인 연결을 준비하고 있어요. 설정이 완료되면 이용할 수 있어요.',
  invalid_state: '로그인 요청이 만료되었거나 다른 브라우저에서 시작됐어요. 다시 시도해주세요.',
  cancelled: 'Google 로그인을 취소했어요. 원할 때 다시 시작할 수 있어요.',
  google_unavailable: 'Google에 연결하지 못했어요. 잠시 후 다시 시도해주세요.',
  invalid_identity: 'Google 계정을 확인하지 못했어요. 다시 로그인해주세요.',
  unavailable: '로그인 서비스에 잠시 연결할 수 없어요. 다시 시도해주세요.',
  logout_failed: '로그아웃을 완료하지 못했어요. 홈으로 돌아가 다시 시도해주세요.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(typeof params.returnTo === 'string' ? params.returnTo : '/');
  const inviteToken=new URL(returnTo,'https://spot.invalid').searchParams.get('invite');
  let inviteName='';if(inviteToken&&env.DB){try{inviteName=(await env.DB.prepare('SELECT name FROM crews WHERE invite=? AND archived=0').bind(inviteToken).first<{name:string}>())?.name??'';}catch{}}
  const configured = !!googleConfig(env) && !!env.DB;
  const error = typeof params.error === 'string' ? messages[params.error] : undefined;
  return <main className="login-page"><a href={returnTo} className="login-back"><ArrowLeft size={17}/> 홈으로</a><section className="login-card">
    <a href="/" className="brand"><span className="brand-icon"><Dumbbell size={22}/></span>SPOT<span className="brand-dot">.</span></a>
    <p className="eyebrow">SHOW UP. TOGETHER.</p><h1>같이 운동할 준비됐나요?</h1><p className="login-description">로그인하고 친구들과 일정을 맞춰보세요.<br/>나만의 루틴도 안전하게 보관해요.</p>
    {returnTo.includes('invite=') && <p className="login-invite">{inviteName?`${inviteName} 크루에서 초대했어요.`:'크루 초대 링크로 접속했어요.'}<br/>로그인 후 바로 합류할 수 있어요.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="login-options">{configured ? <a className="google-login" href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`} target="_top"><span className="google-letter" aria-hidden="true">G</span>Google로 계속하기<ArrowUpRight size={18}/></a> : <><button className="google-login" disabled aria-describedby="google-unavailable"><span className="google-letter" aria-hidden="true">G</span>Google로 계속하기</button><p id="google-unavailable" className="login-config-note">Google 로그인 준비 중</p></>}
    </div>
  </section><p className="login-caption">같은 시작, 각자의 페이스.</p></main>;
}
