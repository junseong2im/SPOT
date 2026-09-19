# SPOT. — 친구들과 쓰는 운동 웹

## 구현 범위
- 공유 일정: 날짜/시간(Asia/Seoul), 이름, 공통 루틴 선택, 참여/참여 취소, 작성자 및 크루장의 수정/취소.
- 공통 루틴: 종목, 순서, 세트, 횟수 편집. 크루원 모두 수정 가능.
- 개인 루틴: 공통 루틴 복사, 소유자만 수정. 공통 버전이 변경돼도 자동 덮어쓰기 없음. 비교 화면에서 명시적으로 반영하면 개인 수정본 전체 교체.
- 크루: 생성, 초대 링크 가입, 이름 수정, 여러 크루 전환. 초대 링크를 아는 로그인 사용자는 가입 가능.
- 10초 간격 및 창 포커스 시 서버 변경사항 새로고침. 권한 검증 및 낙관적 버전 충돌 감지.
- 장소와 운동 수행 기록은 포함하지 않음.

## 실행
Node 22.13 이상. `npm run install:ci`, `npm run build` 후 최초 1회 아래 로컬 스키마 적용:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_gray_scarlet_spider.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_huge_malice.sql
npm run dev
```

기본 주소는 http://localhost:5173/. 로그인 화면에는 Google 로그인만 표시한다. Google은 OAuth 키를 설정하면 활성화되며 설정 방법은 `GOOGLE_LOGIN_SETUP.md`에 있다. 기존 ChatGPT 개발 계정 처리와 데이터는 호환성을 위해 보존하지만 로그인 화면에 버튼은 노출하지 않는다. 자체 비밀번호 계정은 없다. 로그인 제공자별 계정을 이메일로 자동 병합하지 않는다.

실제 데이터는 D1에 저장하며 로컬 개발 데이터는 `.wrangler/state`에 지속된다. 브라우저 저장소를 데이터 원본으로 사용하지 않는다. 마이그레이션을 이미 적용한 DB에 다시 실행하지 않는다. 테스트는 별도의 일회성 Miniflare DB를 사용한다.

## 검증
`npm test`: 초대/접근 제어, 개인 수정 격리, 명시적 동기화, 버전 충돌, 일정/참여/취소 권한, 입력 검증, 동시 참여 갱신 및 Google OAuth 모의 인증/세션 검증을 확인한다.
`npm run typecheck` 및 `npm run build`.

## 배포 경계
외부 Site 생성/배포는 아직 수행하지 않음. 사용자 제공 AGENTS.md의 프로덕션 배포/외부 인프라 변경 확인 규칙에 따라 승인 후 Sites 등록 및 배포를 진행한다. localhost 초대 링크는 다른 기기에서 사용할 수 없으며 친구들과 원격으로 쓰려면 배포가 필요하다. 배포 시 ChatGPT 로그인과 초대 링크 가입을 실제 계정으로 추가 확인해야 한다.

UI 검증으로 만든 `SPOT 테스트 크루` 및 테스트 일정은 로컬 DB에만 남아 있으며 실제 배포 데이터로 업로드되지 않는다.
