# Google 로그인 연결

Google OAuth 서버 흐름과 서명 검증, 로그인 세션, 로그인 선택 화면을 구현했다. 실제 Google 계정 로그인은 사용자 소유 OAuth 클라이언트 설정 후 확인해야 한다.

## 1. Google OAuth 클라이언트 설정

Google Cloud Console의 Google Auth Platform에서 브랜드/동의 화면과 **웹 애플리케이션** 유형의 OAuth 클라이언트를 준비한다. 로그인에 필요한 `openid`, `email`, `profile`만 요청한다. 테스트 모드라면 사용할 Google 계정을 테스트 사용자로 등록한다.

승인된 리디렉션 URI에 다음 값을 **정확히** 등록한다:

```text
http://localhost:5173/api/auth/google/callback
```

배포 후에는 실제 서비스의 HTTPS 주소에 `/api/auth/google/callback`을 붙인 URI도 등록한다. 이 작업은 Google 계정 소유자가 수행하거나 외부 설정 변경을 승인한 뒤 진행한다.

## 2. 로컬 환경변수

`.dev.vars.example`을 `.dev.vars`로 복사해 아래 값을 입력한다. `.dev.vars`는 Git 제외 파일이다. Client Secret은 채팅/소스 코드에 붙여넣지 않는다.

```dotenv
APP_ORIGIN=http://localhost:5173
GOOGLE_CLIENT_ID=발급받은_Client_ID
GOOGLE_CLIENT_SECRET=발급받은_Client_Secret
```

설정 후 개발 서버를 재시작한다. `/login`의 Google 버튼이 활성화된다. `.dev.vars`와 `.env`를 동시에 사용하지 않는다. 운영에서는 동일한 이름으로 런타임 환경변수와 비밀 값을 등록하며, 로컬 비밀 파일을 업로드하지 않는다. `APP_ORIGIN`은 경로 없이 정확한 외부 HTTPS 원점이어야 한다.

## 3. 데이터베이스와 Vercel

현재는 Supabase PostgreSQL을 사용한다. [VERCEL_SUPABASE_SETUP.md](VERCEL_SUPABASE_SETUP.md)에 따라 `DATABASE_URL`과 운영 환경변수를 연결한다. 과거 D1 명령은 운영 배포에 사용하지 않는다.

## 인증 동작

- 브라우저와 결합된 10분 유효 일회용 state, PKCE S256, nonce 검증.
- `jose`로 Google 공개키 기반 RS256 서명, issuer, audience, azp, 만료 및 발급 시간 검증.
- 사용자 키는 `google:<sub>`. 이메일 기반으로 다른 계정과 자동 연결하지 않는다. 기존 ChatGPT 개발 데이터는 과거 D1 로컬 파일에 보존되며 자동 계정 연결은 하지 않는다.
- 로그인 성공 후 기존 Google 세션을 교체하고 7일 세션 발급. DB에는 세션 토큰의 SHA-256만 저장한다. HttpOnly / SameSite=Lax, HTTPS에서는 Secure 및 `__Host-` 쿠키 사용.
- 구글 access/refresh token을 보관하거나 다른 Google API에 접근하지 않는다.
- 로그아웃 시 서버 세션을 폐기한다. Google 계정 자체에서 로그아웃하는 것은 아니다.
- 실제 인증은 일반 웹 브라우저에서 확인한다. 초대 링크로 진입해 로그인하면 해당 초대 화면으로 돌아온다.

## 검증

`npm test`, `npm run typecheck`, `npm run build`.
구글 인증 테스트는 로컬 RSA 키로 서명한 ID 토큰과 모의 Google 응답을 사용한다. 실제 Google 로그인 성공을 대신하는 증거는 아니다.

공식 참고: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Cloudflare 로컬 환경변수](https://developers.cloudflare.com/workers/local-development/environment-variables/).
