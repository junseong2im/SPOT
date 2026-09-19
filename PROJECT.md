# SPOT. — 친구들과 쓰는 운동 웹

공유 일정(서울 시간), 일정 참여/취소, 공통 루틴, 개인 수정본, 크루 초대 링크를 지원한다. 장소 관리와 운동 수행 기록은 포함하지 않는다.

현재 운영 대상은 **Next.js + Vercel + Supabase PostgreSQL**이다. 연결 및 실행 절차는 [VERCEL_SUPABASE_SETUP.md](VERCEL_SUPABASE_SETUP.md)를 따른다.

Google 로그인만 화면에 표시하며, 사용자 식별자는 검증된 Google `sub`를 사용한다. 외부 요청의 ChatGPT 인증 헤더를 신뢰하지 않는다. 기존 D1 파일과 테스트 데이터는 `.wrangler/state`에 보존되어 있다.

공통 루틴은 크루원이 수정할 수 있고 개인 루틴은 소유자만 수정한다. 공통 버전이 바뀌어도 개인 수정본을 자동 덮어쓰지 않는다. 비교 후 명시적으로 반영할 때 전체 교체한다. 일정 수정/취소는 작성자 또는 크루장만 가능하다. 데이터 갱신에는 버전 충돌 검사를 적용한다.

`npm test`, `npm run typecheck`, `npm run build`로 검증한다. 소스에 남은 Cloudflare 스타터 파일과 `drizzle/` SQLite 마이그레이션은 과거 개발 자료이며 Vercel 빌드 및 운영 DB 구성에 사용하지 않는다.
