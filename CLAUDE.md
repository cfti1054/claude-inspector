# claude-inspector — Claude Code 작업 지침

## 프로젝트 개요
- 목적: 여러 프로젝트의 오류와 정기 상태를 Claude Code로 점검하는 중앙 서버. 설계는 `중앙 Claude 점검 서버 개발서.md`, 구성과 배포는 `README.md`를 본다.
- 스택: TypeScript(ESM, Node 22+), Fastify, Postgres(pg), zod. 배포는 Railway (Dockerfile 하나, `railway/*.json`으로 api·worker·scheduler 분리).
- 대시보드는 서버 렌더링 HTML(`src/dashboard/`)이며 JavaScript를 쓰지 않는다. 보간은 `html```로만 해 이스케이프를 유지한다.
- 검증: `npm run typecheck`, `npm test`(DB 불필요), `npm run build`.
- 플랫폼: Windows 11, 기본 셸은 PowerShell. POSIX 스크립트가 필요하면 Bash 도구를 쓴다.

## 작업 원칙
- 변경 전에 관련 파일을 먼저 읽고, 기존 코드의 네이밍·주석 밀도·구조를 따른다.
- 한 번에 한 가지 목적의 변경만 한다. 무관한 리팩터링은 하지 않는다.
- 새 의존성을 추가하기 전에 이유를 설명하고 확인을 받는다.
- 파괴적인 작업(삭제, 강제 push, 덮어쓰기)은 대상과 영향을 먼저 보여주고 진행한다.
- 커밋과 push는 사용자가 요청할 때만 한다. 기본 브랜치(`main`)에서 직접 작업하지 않는다.

## 검증
- 코드를 바꾼 뒤에는 가능한 범위에서 빌드·테스트·실행으로 확인하고, 결과를 있는 그대로 보고한다.
- 실행하지 못했다면 그 사실과 이유를 명시한다.

## 응답 언어
- 사용자와는 한국어로 대화한다. 코드 식별자, 명령어, 에러 메시지는 원문을 유지한다.
