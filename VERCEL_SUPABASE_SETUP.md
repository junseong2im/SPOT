# Vercel + Supabase 운영 구성

## 구성
- Vercel: Next.js 화면과 Node.js API. `npm run build`는 `next build`를 실행한다.
- Supabase: PostgreSQL 데이터베이스. 공개 Data API 대신 서버에서만 DB에 연결한다.
- Google OAuth: 기존 Google 클라이언트를 유지한다. Supabase Auth로 중복 가입하지 않는다.

## 환경변수 (Vercel Production)
- `DATABASE_URL`: Supabase Connect의 Transaction pooler 연결 문자열. DB 비밀번호 포함. 서버 전용 비밀 값.
- `GOOGLE_CLIENT_ID`: 기존 Google OAuth 웹 클라이언트 ID.
- `GOOGLE_CLIENT_SECRET`: 기존 Google OAuth 클라이언트 비밀.
- `APP_ORIGIN`: 실제 Vercel 운영 도메인의 HTTPS 원점. 예: `https://spot-tan-chi.vercel.app`

DB 연결은 Supabase의 IPv4 호환 Transaction pooler를 사용한다. Google 콘솔 승인 리디렉션 URI는 `APP_ORIGIN` 뒤에 `/api/auth/google/callback`을 붙인 값으로 등록한다.

## 데이터베이스
`supabase/migrations/202609200001_spot.sql`은 `spot` 전용 스키마에 크루/회원/개인 루틴/OAuth/세션 테이블을 만든다. 기존 public 스키마 테이블을 변경하지 않는다. RLS를 활성화하고 PUBLIC 접근을 차단한다. 이 애플리케이션은 서버에서 권한을 검사하며 비밀번호나 DB 연결 문자열을 브라우저에 보내지 않는다.

새 DB에 초기 SQL을 한 번 적용한다. 같은 SQL을 무작정 반복 적용하지 않는다. Supabase SQL Editor 또는 `DATABASE_URL` 설정 후 `npm run db:migrate`로 실행할 수 있다. 운영 DB 변경은 승인된 대상에만 실행한다.

## Vercel 빌드
- Framework: Next.js
- Build Command: `npm run build`
- Output Directory: `.next` (Next.js 기본값)
- Node.js: 22.x
- Git: junseong2im/SPOT, main

`vercel.json`에 빌드 설정이 있다. DB 마이그레이션은 빌드 단계에서 실행하지 않는다. 환경변수를 바꾼 뒤 재배포한다.

## 로컬 실행
`npm run dev`는 `.dev.vars`를 읽고 http://localhost:5173 에서 실행한다.
`DATABASE_URL`이 비어 있으면 개발 모드에서만 `.data/postgres`의 독립된 PGlite PostgreSQL을 사용한다. Vercel/production에서는 로컬 DB로 대체하지 않고 DB 미설정으로 처리한다.
기존 Cloudflare D1 로컬 파일 `.wrangler/state`는 보존되며 새 DB로 자동 복사하지 않는다.

## 검증
`npm test`는 PostgreSQL 엔진(PGlite)으로 일정/루틴 격리, 동시 수정, OAuth, 트랜잭션 롤백, 접근 제한을 검증한다. `npm run build`로 `.next/routes-manifest.json` 생성을 확인한다. 로컬 테스트는 실제 운영 DB 연결과 Google 실계정 로그인 완료를 뜻하지 않는다.
