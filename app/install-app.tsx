'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './install-app.css';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(media.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    update();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const complete = () => { setInstalled(true); setOpen(false); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', complete);
    media.addEventListener('change', update);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', complete);
      media.removeEventListener('change', update);
    };
  }, []);

  async function install() {
    if (busy) return;
    if (!prompt) { setError(''); setOpen(true); return; }
    setBusy(true); setError('');
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      if (choice.outcome === 'accepted') setOpen(false);
    } catch { setPrompt(null); setError('브라우저 메뉴에서 설치를 진행해주세요.'); setOpen(true); }
    finally { setBusy(false); }
  }

  if (installed) return null;
  return <aside className="spot-install">
    <button className="spot-install-button" disabled={busy} onClick={() => void install()}><Download size={16} aria-hidden="true"/> {busy ? '설치 확인 중…' : 'SPOT 앱 설치'}</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="app-dialog">
        <DialogTitle>SPOT을 홈 화면에 추가하세요</DialogTitle>
        <DialogDescription>아이콘 한 번으로 운동 약속과 루틴을 열어보세요.</DialogDescription>
        {prompt ? <button className="primary" disabled={busy} onClick={() => void install()}>{busy ? '설치 확인 중…' : '이 기기에 설치'}</button> : ios ?
          <ol className="spot-install-steps"><li>Safari에서 SPOT을 열어주세요.</li><li>공유 메뉴에서 <strong>홈 화면에 추가</strong>를 선택하세요.</li><li>‘웹 앱으로 열기’가 보이면 켜고 <strong>추가</strong>를 누르세요.</li></ol> :
          <p>브라우저 메뉴에서 <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요. 메뉴가 없다면 Chrome이나 Edge에서 열어주세요.</p>}
        <p className="muted">설치 후 홈 화면의 SPOT을 열고, 상단 알림 메뉴에서 ‘이 기기에 푸시 알림 켜기’를 눌러주세요. 설치만으로 알림이 허용되지는 않아요.</p>
        <p className="muted">일정과 루틴을 확인하고 저장하려면 인터넷 연결이 필요해요.</p>
        {error && <p role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  </aside>;
}
