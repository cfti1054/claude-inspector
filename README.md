# claude-inspector

여러 개인 프로젝트의 오류와 정기 상태를 한곳에서 점검하는 중앙 서버입니다. 각 프로젝트는 API를 호출만 하고, Claude Code 실행과 API 키 관리는 이 서버에서만 합니다. 설계는 [중앙 Claude 점검 서버 개발서.md](중앙%20Claude%20점검%20서버%20개발서.md)를 따르며, 현재 로드맵 1~3단계(API·큐·워커, 정기 점검·Discord 알림, 대시보드)가 구현되어 있습니다.

```
프로젝트 ──POST /inspect──▶ API ──jobs 테이블(큐)──▶ 워커 ──git clone──▶ claude -p (읽기 전용)
스케줄러(Cron) ──POST /health-check──▶ API                      │
                                                    reports 저장 · Discord 웹훅
대시보드(/dashboard) ◀── API 프로세스가 함께 제공 (로그인 필수, 읽기 전용)
```

## 구성

| 경로 | 역할 |
| --- | --- |
| `src/api/` | Fastify 서버. `/inspect`, `/health-check`, `/jobs/:id`, `/projects`, `/healthz` |
| `src/dashboard/` | 서버 렌더링 대시보드 (작업 목록, 작업 상세, 프로젝트, 알림 기록) |
| `src/worker/` | 큐에서 작업을 꺼내 저장소를 clone하고 Claude Code를 headless로 실행 |
| `src/scheduler.ts` | Railway Cron이 하루 1회 실행. `/health-check` 호출 후 종료 |
| `src/cli/add-project.ts` | 프로젝트 등록, 토큰 발급·재발급, 비활성화 |
| `migrations/` | Postgres 스키마 |
| `docs/railway-deploy.md` | Railway 배포 절차, 동작 확인, 운영, 문제 해결 |

## Railway 배포

단계별 절차는 **[docs/railway-deploy.md](docs/railway-deploy.md)** 를 따릅니다. 요약은 다음과 같습니다.

1. Railway 프로젝트에 **Postgres**를 추가합니다.
2. 이 저장소로 서비스 3개를 만듭니다. 모두 같은 Dockerfile로 빌드하고, **Settings → Deploy**에서 서비스별 시작 명령을 지정합니다. (Config as Code는 Railway에서 폐지 예정이라 쓰지 않습니다.)

   | 서비스 | Custom Start Command | 비고 |
   | --- | --- | --- |
   | `api` | `sh -c "node dist/migrate.js && exec node dist/api/main.js"` | 공개 도메인 생성, Healthcheck Path `/healthz` |
   | `worker` | `node dist/worker/main.js` | 공개 도메인 없음 |
   | `scheduler` | `node dist/scheduler.js` | Cron Schedule `0 0 * * *` (UTC 00:00 = KST 09:00) |

3. 아래 환경변수를 서비스별로 설정합니다.
4. 배포 후 로컬에서 프로젝트를 등록합니다 (아래 "프로젝트 등록").

### 환경변수

| 변수 | 서비스 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | api, worker | `${{Postgres.DATABASE_URL}}` |
| `SCHEDULER_TOKEN` | api, scheduler | 스케줄러 전용 토큰. `openssl rand -base64 32` |
| `DASHBOARD_PASSWORD` | api | 대시보드 로그인 비밀번호 |
| `SESSION_SECRET` | api | 세션 쿠키 서명 키, 32자 이상 |
| `ANTHROPIC_API_KEY` | worker | Claude Code 인증. 워커에만 둡니다 |
| `GITHUB_TOKEN` | worker | 대상 저장소 clone용. Fine-grained 토큰, Contents 읽기 전용 권장 |
| `DISCORD_WEBHOOK_ALERTS` | worker | #alerts 웹훅. 비우면 알림 생략 |
| `DISCORD_WEBHOOK_DAILY` | worker | #daily-report 웹훅. 비우면 알림 생략 |
| `DASHBOARD_URL` | worker | 알림 속 작업 링크용 대시보드 주소 |
| `API_URL` | scheduler | api의 공개 주소 (예: `https://<도메인>.up.railway.app`) |

선택 변수와 기본값:

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `LOGS_MAX_BYTES` | 65536 | `/inspect` logs 최대 크기. 넘으면 413 |
| `DEFAULT_DAILY_LIMIT` | 20 | 프로젝트 등록 시 일일 호출 상한 기본값 |
| `DEFAULT_DEBOUNCE_SECONDS` | 3600 | 같은 error_hash 재분석 금지 시간 기본값 |
| `WORKER_CONCURRENCY` | 1 | 워커 동시 실행 수 (최대 2) |
| `JOB_TIMEOUT_SECONDS` | 600 | 작업 타임아웃 |
| `JOB_MAX_ATTEMPTS` | 2 | 최대 시도 횟수. 이후 `failed` 확정 |
| `QUEUE_ALERT_MINUTES` | 10 | 큐 대기가 이 시간을 넘으면 #alerts (시간당 1회) |
| `CLAUDE_MAX_BUDGET_USD` | 1 | 작업 1건당 Claude 비용 상한 |
| `CLAUDE_MODEL` | (CLI 기본값) | 사용할 모델 |
| `CLAUDE_BIN` | `claude` | CLI 경로. Docker 이미지에서는 자동 설정 |

## 프로젝트 등록

```sh
npm run dev:project:add -- --name my-project-a --repo https://github.com/owner/my-project-a --branch main --limit 20 --debounce 3600
```

출력되는 토큰은 다시 볼 수 없습니다. 대상 프로젝트의 Railway 환경변수(예: `INSPECTOR_TOKEN`)에 저장하세요. 토큰 재발급은 `--rotate`, 비활성화는 `--deactivate`입니다.

## 대상 프로젝트에서 호출하기

중앙 서버 장애가 서비스에 영향을 주지 않도록 **기다리지 않고, 짧은 타임아웃을 두고, 실패는 로그만** 남깁니다. 로그는 보내기 전에 마스킹하세요 (서버에서도 한 번 더 마스킹합니다).

```ts
import { createHash } from 'node:crypto';

export function reportError(err: Error, logs: string, severity: 'critical' | 'error' | 'warning' = 'error') {
  // 같은 오류는 같은 해시가 되도록 메시지와 스택 첫 줄로 만든다
  const errorHash = createHash('sha256').update(`${err.name}:${err.message}:${err.stack?.split('\n')[1] ?? ''}`).digest('hex').slice(0, 16);
  void fetch(`${process.env.INSPECTOR_URL}/inspect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.INSPECTOR_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: 'my-project-a',
      type: 'error',
      severity,
      error_hash: errorHash,
      logs: logs.slice(-50_000),
      occurred_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(3000),
  }).catch((e) => console.warn('[inspector] 보고 실패', e.message));
}
```

응답: `202` 등록, `400` 형식 오류, `401` 인증 실패, `403` 프로젝트 불일치·비활성, `409` 디바운스, `413` 로그 크기 초과, `429` 일일 상한 초과.

## 워커의 Claude Code 실행 방식

- `claude -p --bare`로 실행해 대상 저장소의 CLAUDE.md·훅·플러그인을 읽지 않습니다.
- 허용 도구는 `Read`, `Grep`, `Glob`뿐입니다. `--permission-mode dontAsk`로 그 밖의 도구 요청은 자동 거부됩니다.
- 로그는 무작위 nonce 경계로 감싸 데이터로만 다루도록 프롬프트에 명시합니다.
- Claude 프로세스에는 `ANTHROPIC_API_KEY` 외의 비밀(DB 주소, GitHub 토큰)을 넘기지 않습니다.
- 결과는 `--json-schema`로 구조화해 받고, 저장 전에 한 번 더 마스킹합니다.
- 작업마다 임시 디렉터리에 얕은 clone을 받고 끝나면 지웁니다.

## 알림 규칙

| 채널 | 언제 |
| --- | --- |
| #alerts | 분석 결과가 critical일 때, 작업이 최종 실패했을 때, 큐 대기가 기준을 넘었을 때 (시간당 1회) |
| #daily-report | 그날의 정기 점검이 모두 끝났을 때 하루 1회 요약 |

## 로컬 개발

```sh
npm install
npm run typecheck
npm test            # DB 없이 도는 단위·HTTP 테스트
npm run build
```

DB가 필요한 흐름은 Postgres를 띄우고 `DATABASE_URL`을 설정한 뒤 `npm run build && npm run migrate`, `npm run dev:api`, `npm run dev:worker`로 확인합니다. Windows에서는 `CLAUDE_BIN`을 `node_modules/@anthropic-ai/claude-code/bin/claude.exe`로 지정하세요.

## 다음 단계 (미구현)

- 4단계: Discord 판단 봇·승인 버튼(`/approvals/{id}`), 화이트리스트 실행 봇, `approvals`·`actions_log` 테이블
- 5단계: 수정 제안 브랜치와 PR 자동 생성
