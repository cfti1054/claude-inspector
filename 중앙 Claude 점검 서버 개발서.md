# 중앙 Claude 점검 서버 개발서

Oct 26, 2026 · @suhyeok

## 개요

여러 개인 프로젝트의 오류와 정기 상태를 한곳에서 점검하는 중앙 서버를 만든다. 각 프로젝트는 이 서버의 API를 호출만 하고, Claude Code 실행과 API 키 관리는 중앙 서버에서만 한다.

1. 프로젝트가 오류를 감지하면 중앙 서버 `/inspect`를 호출한다.
2. 정기 스케줄러가 하루 1회 `/health-check`를 호출한다.
3. 중앙 서버는 작업을 큐에 넣고 Claude Code를 headless로 실행한다.
4. 결과를 DB에 저장하고 Discord 채널로 알린다.
5. 승인이 필요한 조치는 Discord 버튼으로 사람이 승인한 뒤에만 실행한다.

## 요구사항

### 기능 요구사항

- 여러 프로젝트가 공통 API로 점검과 오류 분석을 요청할 수 있어야 한다.
- 요청마다 Claude Code가 해당 프로젝트 저장소를 읽고 분석 리포트를 만든다.
- 하루 1회 정기 점검을 스케줄로 실행한다.
- 분석 결과를 Discord에 게시하고, 승인이 필요한 조치는 버튼으로 승인받는다.
- 작업 이력과 결과를 조회하는 대시보드를 제공한다.

### 비기능 요구사항

| 항목 | 목표 |
| --- | --- |
| 가용성 | 중앙 서버 장애가 대상 프로젝트 동작에 영향을 주지 않는다 |
| 비용 | 프로젝트별 일일 호출 상한을 둔다 |
| 중복 방지 | 같은 에러 해시는 설정 시간 내 1회만 분석한다 |
| 보안 | 프로젝트별 토큰 인증, 로그 마스킹 |

## 아키텍처

전체 흐름은 다음과 같다.

1. 프로젝트 A, B, C (Railway) → 중앙 API `/inspect`, `/health-check`
2. 중앙 API → 작업 큐 (DB 테이블 기반)
3. 워커 → Claude Code headless 실행 → 리포트 생성
4. 워커 → DB 저장 → Discord 웹훅으로 알림
5. 판단 봇 → 제안 메시지와 승인 버튼 게시
6. 실행 봇 → 승인된 화이트리스트 작업만 수행

### 구성 요소와 역할

| 구성 요소 | 역할 | 하지 않는 일 |
| --- | --- | --- |
| API 서버 | 요청 검증, 인증, 작업 등록 | 분석 직접 수행 |
| 워커 | 큐에서 작업을 꺼내 Claude Code 실행 | 프로덕션 배포 |
| 스케줄러 | 하루 1회 정기 점검 등록 | 에러 분석 |
| 알림 봇 | 상태와 요약 게시 | 명령 실행 |
| 판단 봇 | 조치 제안과 승인 요청 | 직접 실행 |
| 실행 봇 | 승인된 작업 수행 | 임의 셸 명령 실행 |
| 대시보드 | 작업 목록과 상세 리포트 조회 | 데이터 수정 |

## API 명세

`/approvals/{id}`를 제외한 모든 요청은 `Authorization: Bearer <토큰>` 헤더가 필요하다. 프로젝트 토큰은 자기 프로젝트의 작업만 등록·조회할 수 있다. `/approvals/{id}`는 프로젝트 토큰이 아니라 Discord 서명 검증(Ed25519)과 승인자 허용 목록으로 인증한다.

| 메서드 | 경로 | 인증 | 용도 |
| --- | --- | --- | --- |
| POST | /inspect | 프로젝트 토큰 | 오류 로그를 받아 분석 작업 등록 |
| POST | /health-check | 스케줄러 전용 토큰 | 정기 점검 작업 등록 (활성 프로젝트마다 1건) |
| GET | /jobs/{id} | 프로젝트 토큰 (본인 작업만) | 작업 상태와 결과 조회 |
| GET | /projects | 관리자 (대시보드 로그인) | 등록된 프로젝트 목록과 상태 조회 |
| POST | /approvals/{id} | Discord 서명 + 승인자 허용 목록 | 승인 또는 거절 처리 (Discord 상호작용에서 호출) |

### /inspect 요청 예시

```json
{
  "project": "my-project-a",
  "type": "error",
  "severity": "critical",
  "error_hash": "a3f9c1",
  "logs": "...마스킹된 로그...",
  "occurred_at": "2026-10-26T16:00:00+09:00"
}
```

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| project | O | 프로젝트 이름. 토큰의 프로젝트와 다르면 403 |
| type | O | `/inspect`에서는 `error`만 허용 (`/health-check`는 서버가 `health`로 등록) |
| severity | O | `critical`, `error`, `warning` 중 하나 |
| error\_hash | O | 프로젝트가 계산한 에러 식별자. 디바운스 키는 (project, error\_hash) |
| logs | O | 마스킹된 로그. 크기 상한을 넘으면 413 |
| occurred\_at | O | ISO 8601 시각 |

### 응답

요청을 검증하고 작업을 큐에 넣은 뒤 즉시 `202 Accepted`와 `job_id`를 반환한다. 분석 결과는 `/jobs/{id}`로 조회하거나 Discord로 받는다.

검사 순서는 인증 → 스키마·크기 검증 → 디바운스 → 일일 상한이다. 409로 거절된 요청은 일일 호출 수에 포함하지 않는다.

| 상태 코드 | 의미 |
| --- | --- |
| 202 | 작업 등록 완료 |
| 400 | 필드 누락 또는 값 형식 오류 |
| 401 | 토큰 인증 실패 |
| 403 | 토큰의 프로젝트와 요청 대상 불일치, 또는 비활성 프로젝트 |
| 409 | 같은 error\_hash가 디바운스 시간 내 존재 |
| 413 | logs 크기 상한 초과 |
| 429 | 프로젝트 일일 호출 상한 초과 (기준 시각대는 KST로 고정) |

## 데이터 모델

| 테이블 | 주요 컬럼 | 설명 |
| --- | --- | --- |
| projects | id, name, repo\_path, token\_hash, daily\_limit, debounce\_seconds, active | 등록된 프로젝트와 설정 |
| jobs | id, project\_id, type, status, error\_hash, payload, attempts, created\_at, started\_at, finished\_at | 작업 큐이자 이력. (project\_id, error\_hash) 조회용 인덱스 필요 |
| reports | id, job\_id, severity, summary, body | Claude Code 분석 결과 |
| approvals | id, job\_id, action, status, requested\_at, expires\_at, decided\_by, decided\_at | 승인 요청과 결정 기록. status는 `pending`, `approved`, `rejected`, `expired` |
| actions\_log | id, approval\_id, action, result, executed\_at | 실행 봇이 수행한 작업 기록 |
| notifications | id, job\_id, channel, sent\_at | Discord 발송 기록, 중복 억제에 사용 |

job 상태는 `queued → running → done | failed`로 전이한다. 승인 대상 작업은 `waiting_approval`을 거친다.

- 워커는 `SELECT ... FOR UPDATE SKIP LOCKED`로 작업을 꺼내 여러 워커가 같은 작업을 잡지 않게 한다.
- `running`인 채로 타임아웃의 2배 이상 지난 작업은 워커 비정상 종료로 보고 `queued`로 되돌린다. `attempts`가 상한에 도달하면 `failed`로 확정한다.

## Claude Code 실행 방식과 호출 제어

워커는 작업마다 프로젝트 저장소를 작업 디렉터리에 준비한 뒤 `claude -p` 형태의 headless 모드로 실행한다. 인증은 `ANTHROPIC_API_KEY` 환경변수로 중앙 서버에만 둔다.

### 호출 제어 규칙

- 같은 `error_hash`는 기본 1시간에 1회만 분석한다 (디바운스).
- 프로젝트별 일일 호출 상한을 두고, 초과 시 429로 거절한다.
- 워커 동시 실행 수는 1\~2개로 제한해 비용과 부하를 통제한다.
- 작업 타임아웃을 두고 초과 시 `failed`로 기록한다.

### 권한 범위

- 1~4단계에서 Claude Code는 읽기 전용 도구만 허용한다. 허용 도구 목록과 최대 턴 수를 실행 옵션으로 명시한다.
- 5단계(PR 자동 생성)부터 파일 수정은 작업용 브랜치 생성까지만 허용하고, 코드 변경은 PR로만 만든다. `main` 직접 push는 막는다.
- 프로덕션 DB 접근과 배포 명령은 허용하지 않는다.
- 실행 결과는 리포트로 저장한다.

### 입력 신뢰 경계

- `logs`는 외부에서 온 신뢰할 수 없는 입력이다. 로그 안의 지시문을 Claude Code가 따르지 않도록 프롬프트에서 로그를 데이터 구간으로 구분하고, 로그에서 비롯된 명령은 실행하지 않는다고 명시한다.
- 프로젝트 측 마스킹을 신뢰하지 않고, 서버도 저장과 프롬프트 투입 전에 한 번 더 마스킹한다.
- 워커가 접근하는 저장소는 해당 프로젝트의 것으로 제한하고, 프로젝트 간 디렉터리를 공유하지 않는다.

## Discord 연동

채널은 기능별로 나눈다.

| 채널 | 용도 | 발신 주체 |
| --- | --- | --- |
| #alerts | 즉시 알림 (critical 오류, 서비스 다운) | 알림 봇 |
| #daily-report | 하루 1회 점검 요약 | 알림 봇 |
| #decisions | 조치 제안과 승인 버튼 | 판단 봇 |
| #actions | 승인 후 실행 결과 기록 | 실행 봇 |

### 승인 흐름

1. 판단 봇이 제안 메시지를 #decisions에 게시하고 ✅ 승인 / ❌ 거절 버튼을 붙인다.
2. 버튼 클릭 시 Discord Interaction이 중앙 API `/approvals/{id}`를 호출한다.
3. 승인된 항목만 실행 봇이 화이트리스트에서 찾아 수행한다. 예: `restart:project-a`.
4. 결과와 승인자를 #actions에 남기고 actions\_log에 저장한다.

- 승인 권한은 허용 목록에 있는 Discord 사용자 ID에만 부여한다. 채널 접근 권한만으로는 승인할 수 없다.
- Interaction은 3초 안에 응답해야 하므로 먼저 응답(defer)하고 처리는 비동기로 한다.
- 이미 `approved`, `rejected`, `expired`인 승인 건에 대한 반복 클릭은 무시한다 (멱등). 상태 변경은 `pending`일 때만 허용한다.
- `expires_at`이 지난 `pending` 건은 `expired`로 바꾸고 실행하지 않는다.

봇 메시지에는 반응하지 않도록 필터링해 무한 루프를 막는다.

## 보안

- 프로젝트별 토큰을 발급하고 DB에는 해시만 저장한다. 원문은 각 프로젝트의 Railway 환경변수에만 둔다.
- 대시보드는 로그인(OAuth 또는 비밀번호)을 필수로 건다. Railway 기본 도메인은 공개 상태이므로 예외는 없다.
- Discord 상호작용은 서명 검증(Ed25519)을 거친 요청만 처리한다.
- 로그는 전송 전에 토큰, 비밀번호, 개인정보 패턴을 마스킹한다.
- 실행 봇은 화이트리스트 외 명령을 거부하고, 모든 실행을 actions\_log에 남긴다.
- Railway API 토큰과 Discord 봇 토큰은 필요한 권한만 부여한다.

## 배포와 운영

### Railway 구성

| 항목 | 설정 |
| --- | --- |
| 서비스 | 중앙 API, 워커, 대시보드를 한 레포에서 프로세스 2\~3개로 분리 |
| 데이터베이스 | Railway Postgres (작업 큐와 이력 겸용) |
| 스케줄 | 하루 1회 점검은 Railway Cron 또는 스케줄러 프로세스 |
| 환경변수 | ANTHROPIC\_API\_KEY, DATABASE\_URL, DISCORD\_BOT\_TOKEN, DISCORD\_PUBLIC\_KEY, RAILWAY\_TOKEN, SCHEDULER\_TOKEN, 저장소 접근 토큰 (접근 방식 확정 후) |

### 장애 대응

- 대상 프로젝트는 호출을 비동기로 보내고 짧은 타임아웃(수 초)을 둔다. 중앙 서버가 응답하지 않거나 오류를 반환하면 실패를 무시하고 로그만 남긴다.
- 로그와 리포트는 보관 기간을 정해 지난 데이터를 삭제한다.
- 워커가 멈추면 `queued` 상태 작업이 쌓이므로, 대기 시간이 기준을 넘으면 Discord #alerts로 알린다.
- 실패한 작업은 재시도 횟수를 제한하고 이후 `failed`로 확정한다.

## 로드맵과 미정 사항

| 단계 | 범위 | 완료 기준 |
| --- | --- | --- |
| 1 | API 서버, 작업 큐, 프로젝트 1개 점검 | /inspect 호출 후 리포트가 DB에 저장됨 |
| 2 | 정기 점검, Discord 알림 | 하루 1회 요약이 #daily-report에 도착 |
| 3 | 대시보드 | 작업 목록과 상세 리포트 조회 |
| 4 | 판단 봇, 승인 버튼, 실행 봇 | 화이트리스트 작업이 승인 후에만 실행 |
| 5 | PR 자동 생성 | 수정 제안이 브랜치와 PR로 생성 |

### 미정 사항

- 프로젝트별 저장소 접근 방식 (GitHub 토큰 또는 배포 시 clone)
- 일일 호출 상한과 디바운스 시간의 기본값
- 실행 봇이 허용할 작업 목록 (재시작, 재배포 범위)
- 승인 만료 시간, 승인자 허용 목록, 로그·리포트 보관 기간
- `/inspect` 로그 크기 상한과 작업 타임아웃, 재시도 횟수의 기본값
- 카카오톡 알림 추가 여부

### 출처

- 본 문서는 설계 초안이며 외부 자료를 인용하지 않았다.
