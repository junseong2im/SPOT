# SPOT 로컬 백업 복구

백업 브랜치: `codex/local-backup-20260927`. 소스 기준 커밋: `4123a01a9da640980bba461466816fe4279ef7e1`.
암호화 범위: `.data`, `.dev.vars`, `.wrangler`, `.sites-runtime`의 파일 1,231개 / 108,029,098 bytes, 디렉터리 50개(PGlite 빈 디렉터리 14개 포함). `.data/backup-tools`는 제외하고 도구 5개를 `backup-tools/`에 보존했다.
필수 외부 키: `C:\Users\user\SPOT-recovery\20260927-local-backup\recovery-key.json`. 키를 별도로 보관하고 Git에 추가하지 않는다. 기존 키를 잃으면 복호화할 수 없다.

Node.js가 PATH에 있는 PowerShell에서 실행한다. 도구는 Node.js 기본 모듈만 사용한다. 복원 목적지는 새 빈 경로여야 한다.
```powershell
$backupRepository = 'C:\Users\user\SPOT-recovery\20260927-local-backup\repository'
$recoveryKeyPath = 'C:\Users\user\SPOT-recovery\20260927-local-backup\recovery-key.json'
$restoredLocalPath = 'C:\Users\user\SPOT-recovery\20260927-local-backup\restored-local'
if (Test-Path -LiteralPath $restoredLocalPath) { throw '아직 존재하지 않는 새 복원 경로를 지정하세요.' }
node "$backupRepository\backup-tools\restore-backup.mjs" --backup "$backupRepository\backup" --key-file $recoveryKeyPath --verify-only
if ($LASTEXITCODE -ne 0) { throw '백업 검증 실패' }
node "$backupRepository\backup-tools\restore-backup.mjs" --backup "$backupRepository\backup" --key-file $recoveryKeyPath --destination $restoredLocalPath
if ($LASTEXITCODE -ne 0) { throw '파일 복원 실패' }
node "$backupRepository\backup-tools\restore-backup.mjs" --backup "$backupRepository\backup" --key-file $recoveryKeyPath --verify-only --compare-root $restoredLocalPath
if ($LASTEXITCODE -ne 0) { throw '복원본 비교 실패' }
```

소스 코드는 Git 이력에 보존되어 있다. 별도 새 checkout에서 `git checkout --detach 4123a01a9da640980bba461466816fe4279ef7e1`로 기준 소스를 복구한 뒤 위에서 복원한 네 경로를 같은 위치에 복사한다. 기존 프로젝트에 복원기를 직접 실행하면 비어 있지 않아 거부된다.
원격 업로드 완료 후 다른 컴퓨터에서는 `git clone --single-branch --branch codex/local-backup-20260927 https://github.com/junseong2im/SPOT.git`로 백업을 받은 뒤 위 경로 변수를 조정한다. 외부 키는 Git에서 내려오지 않으므로 별도로 가져와야 한다.
재생성 제외: `.git`, `node_modules`, `.next`, `.vinext`, `dist`, `public/ocr`, `supabase/.temp`, `next-env.d.ts`, `tsconfig.tsbuildinfo`. 소스 이력은 Git 복제로, 의존성은 `npm ci`로, Next 산출물과 OCR 에셋은 필요한 경우 `npm run build`로 복구한다.
이 백업 브랜치를 배포하거나 `main` 등 배포 브랜치에 병합하지 않는다. `git.deploymentEnabled=false`, `ignoreCommand="exit 0"`, `.vercelignore`의 `*`는 Vercel 배포 제외 설정이며 다른 서비스의 배포까지 차단한다고 가정하지 않는다.
생성 당시 검증: 암호화 생성, 원본 compare-root, `restore-check` 실제 복원, 복원본 compare-root 모두 통과. 데이터베이스 실행 검증은 하지 않았다.
