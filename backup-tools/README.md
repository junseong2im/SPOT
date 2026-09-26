# 로컬 파일 암호화 백업 도구

Node.js 22 이상, 내장 모듈만 사용합니다. 실제 원본 삭제, Git 조작, 배포 기능은 없습니다.

`create-backup.mjs` 입력 `--paths-json`은 소스 루트 기준 상대 **파일** 경로 문자열 배열입니다. 예: `[".data/example.json", "local/sub/example.bin"]`. 선택 옵션 `--directories-json`은 빈 디렉터리를 포함해 보존할 상대 디렉터리 경로 문자열 배열이며, 생략 시 빈 배열입니다. 파일 총합은 최대 300 MiB입니다. Windows 경로 규칙, 대소문자 중복, 파일/디렉터리 충돌, 심볼릭 링크/정션 및 원본 변경을 검사합니다.

```powershell
node .data/backup-tools/create-backup.mjs --root C:\project --paths-json C:\backup-work\paths.json --directories-json C:\backup-work\directories.json --out C:\backup-work\archive --key-file C:\recovery\recovery-key.json --source-commit FULL_GIT_COMMIT_HASH
node .data/backup-tools/restore-backup.mjs --backup C:\backup-work\archive --key-file C:\recovery\recovery-key.json --verify-only --compare-root C:\project
node .data/backup-tools/restore-backup.mjs --backup C:\backup-work\archive --key-file C:\recovery\recovery-key.json --destination C:\restored-project
```

출력 폴더와 키 파일은 소스 루트 밖에 있어야 하고, 키 파일은 출력 폴더 밖에 있어야 합니다. 키의 부모 폴더는 미리 존재해야 하며 키 파일은 `wx`로 새로 생성합니다. 기존 키를 덮어쓰지 않습니다. 새 복구 키는 백업과 별도로 보관해야 복원할 수 있습니다. Windows의 기존 폴더 ACL은 변경하지 않습니다.

파일·디렉터리 목록과 본문·개별 해시는 gzip JSON 안에만 저장하고 AES-256-GCM으로 암호화합니다. 공개 `manifest.json`에는 형식, 원본 Git 커밋, 파일 수·디렉터리 수·총 크기, nonce·인증 태그, 암호문·청크 해시만 있습니다. 암호문 청크는 최대 20 MiB입니다. 원본을 마지막에 다시 해시하고 디렉터리 상태도 확인한 뒤 manifest를 최종 기록합니다. 실패 시 생성된 키나 부분 암호문이 남을 수 있으며, manifest 없는 출력은 완성된 백업이 아닙니다.

복구는 청크·전체 암호문 해시, GCM 인증, 모든 파일 경로·내용 해시와 공개/암호화 메타데이터의 일치를 검사합니다. 복구 대상은 없거나 비어 있는 폴더만 허용하며 개별 파일도 `wx`로 생성합니다. `--verify-only`는 복호화·검증만 수행하고 복구 폴더를 만들지 않습니다. `--compare-root`는 아카이브에 담긴 모든 파일을 지정한 원본 폴더와 비교합니다. 원본 폴더의 추가 파일은 비교 범위가 아닙니다.

성공 stdout은 `count`, `bytes`, `sourceCommit`만 포함하는 JSON 한 줄입니다. 오류에도 키나 원본 경로·내용을 출력하지 않습니다. 생성·복원 중에는 해당 폴더에 다른 프로세스가 쓰지 않도록 해야 합니다.

합성 테스트는 시스템 임시 폴더 아래 테스트 전용 디렉터리에서만 실행합니다.

```powershell
node --test .data/backup-tools/backup-tools.test.mjs
```
