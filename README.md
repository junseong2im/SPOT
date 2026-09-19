# SPOT.

친구들과 운동 일정을 공유하고, 공통 루틴을 각자에게 맞게 수정하는 웹입니다.

## 기능

- 크루 생성 및 초대 링크 가입
- 운동 일정 생성·수정·참여·취소
- 공통 루틴 관리 및 개인 루틴 복사·편집
- 공통 루틴 변경사항 비교 후 선택 반영
- Google OAuth 로그인 (별도 키 설정 필요)
- 모바일 대응 및 D1 데이터 저장

장소 관리와 운동 수행 기록은 포함하지 않습니다.

## 시작하기

Node.js 22.13 이상이 필요합니다.

```sh
npm run install:ci
npm run build
```

최초 로컬 DB 구성과 실행 방법은 [PROJECT.md](PROJECT.md), Google 로그인 설정은 [GOOGLE_LOGIN_SETUP.md](GOOGLE_LOGIN_SETUP.md)를 참고하세요.

```sh
npm run dev
```

기본 개발 주소: http://localhost:5173

## 검증

```sh
npm test
npm run typecheck
npm run build
```

OAuth 테스트는 모의 인증 응답을 사용합니다. 실제 Google 계정 로그인과 운영 배포 완료를 의미하지 않습니다.

## 환경변수

`.dev.vars.example`을 `.dev.vars`로 복사하고 Google OAuth 키를 입력하세요. 보안 비밀, 로컬 DB, 의존성, 빌드 결과는 Git에 포함하지 않습니다.

아직 운영 배포하지 않았습니다. 배포 후 `APP_ORIGIN`과 Google 승인 리디렉션 URI를 실제 HTTPS 주소에 맞춰 설정해야 합니다.
