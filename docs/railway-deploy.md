# Railway 배포 가이드

중앙 점검 서버를 Railway에 처음 배포하는 절차입니다. 소요 시간은 대략 40분~1시간입니다.

> 이 문서의 Railway 화면 설명은 2026-10 기준 일반적인 메뉴 이름을 따랐고, 실제 화면과 이름이 다를 수 있습니다. 그럴 때는 비슷한 항목을 찾아 같은 값을 넣으세요.
> Railway의 Config as Code(`railway.json`)는 폐지 예정이라 **쓰지 않습니다**. 서비스별 차이(시작 명령, Cron, 헬스체크)는 모두 대시보드에서 설정합니다.

## 0. 전체 그림

```
GitHub 저장소 (이 레포) ──▶ Railway 프로젝트
                           ├─ Postgres            작업 큐와 이력
                           ├─ api        (공개)   API + 대시보드
                           ├─ worker     (비공개) Claude Code 실행
                           └─ scheduler  (Cron)   하루 1회 /health-check 호출
```

세 서비스는 **같은 저장소, 같은 Dockerfile**로 빌드하고 **시작 명령만** 다르게 둡니다.

| 서비스 | 시작 명령 | 특이사항 |
| --- | --- | --- |
| api | `sh -c "node dist/migrate.js && exec node dist/api/main.js"` | 공개 도메인, 헬스체크 `/healthz`. 시작할 때 DB 마이그레이션을 먼저 실행 |
| worker | `node dist/worker/main.js` | 도메인 없음. 항상 실행 |
| scheduler | `node dist/scheduler.js` | Cron `0 0 * * *`. 실행 후 종료하는 서비스 |

## 1. 사전 준비

### 1-1. 코드가 GitHub에 올라가 있어야 합니다
- `feat/inspector-server` 브랜치가 push되어 있는지 확인합니다.
- `package.json`과 `package-lock.json`이 모두 커밋되어 있어야 합니다. Dockerfile이 `npm ci`로 설치하므로 lockfile이 없으면 빌드가 실패합니다.
- 배포할 브랜치는 `main`으로 병합하거나, Railway 서비스 설정에서 `feat/inspector-server`를 지정합니다. (4번 "배포하기"의 브랜치 지정 참고)

### 1-2. 외부 키와 토큰 만들기

| 준비물 | 만드는 곳 | 메모 |
| --- | --- | --- |
| Claude 구독 토큰 | 로컬 터미널에서 `claude setup-token` (아래 1-3) | Pro/Max 등 Claude 유료 구독이 필요합니다 |
| GitHub 토큰 | GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** | Repository access는 **점검할 저장소만** 선택. Permissions는 **Contents: Read-only**(Metadata는 자동). 만료일을 정해 두세요 |
| Discord 웹훅 2개 | 서버의 채널 편집 → 연동 → 웹후크 → 새 웹후크 → URL 복사 | `#alerts`용, `#daily-report`용으로 각각 하나. 채널이 없으면 먼저 만드세요 |
| 무작위 비밀 값 3개 | 로컬 터미널 (아래 명령) | `SCHEDULER_TOKEN`, `DASHBOARD_PASSWORD`, `SESSION_SECRET` |

무작위 값은 Node가 설치돼 있으면 PowerShell과 Bash 모두에서 같은 명령으로 만들 수 있습니다. 세 번 실행해 서로 다른 값을 받으세요.

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- `SESSION_SECRET`은 32자 이상이어야 합니다. 위 명령의 결과(43자)면 충분합니다.
- `DASHBOARD_PASSWORD`는 직접 외우기 쉬운 긴 문장으로 정해도 됩니다. 인터넷에 공개되는 로그인이므로 12자 이상을 권합니다.
- 만든 값은 비밀번호 관리자에 보관하세요. 이 값들은 채팅, 이슈, 커밋에 붙이지 않습니다.

### 1-3. Claude 구독 토큰 발급

1. Claude Code가 설치된 로컬 PC의 터미널에서 실행합니다.
   ```sh
   claude setup-token
   ```
2. 브라우저가 열리면 **구독 중인 Claude 계정**으로 로그인하고 승인합니다.
3. 터미널에 출력되는 토큰(`sk-ant-oat...`으로 시작)을 복사해 비밀번호 관리자에 보관합니다. 이 값이 worker의 `CLAUDE_CODE_OAUTH_TOKEN`이 됩니다.

주의할 점:
- **이용 약관을 먼저 확인하세요.** 구독을 서버에서 자동 실행하는 데 써도 되는지는 이 문서에서 확인하지 못했습니다. Anthropic의 최신 이용 약관과 사용 정책을 확인한 뒤 쓰세요.
- **사용 한도를 평소 사용과 공유합니다.** 서버 분석이 많으면 본인이 쓰는 Claude 대화와 Claude Code의 한도가 함께 줄어듭니다. 한도에 걸리면 서버는 작업을 `USAGE_LIMIT_BACKOFF_MINUTES`(기본 30분) 뒤로 미루고 #alerts에 알립니다.
- **이 토큰은 계정 전체 권한입니다.** 새면 계정이 위험하므로 worker 서비스 외에는 두지 마세요. 의심되면 Claude 계정 설정에서 해당 세션·토큰을 끊고 다시 발급하세요.
- API 키(`ANTHROPIC_API_KEY`)도 함께 설정하면 **API 키가 우선**합니다. 구독만 쓰려면 API 키를 넣지 마세요.

## 2. Railway 프로젝트 만들기

1. Railway 대시보드에서 **New Project** → **Deploy PostgreSQL**을 선택해 Postgres를 먼저 만듭니다.
2. 같은 프로젝트 캔버스에서 **New** → **GitHub Repo**를 선택하고 이 저장소를 고릅니다. (처음이라면 Railway의 GitHub 앱 설치와 저장소 접근 허용이 필요합니다.)
3. 서비스가 하나 만들어지면 이름을 **`api`**로 바꿉니다. (서비스 선택 → Settings → Service Name)
   - 이름은 아래 변수 참조(`${{api....}}`)에 쓰이므로 정확히 소문자 `api`로 하세요.
4. 같은 방법으로 같은 저장소를 두 번 더 추가해 **`worker`**, **`scheduler`** 서비스를 만듭니다.
5. 처음 만들 때 자동으로 시작되는 첫 배포는 환경변수가 없어 실패해도 괜찮습니다. 아래 설정을 마친 뒤 다시 배포합니다.

> Railway가 Dockerfile을 자동으로 찾아 빌드합니다. 저장소 루트에 `Dockerfile`이 있으므로 별도 빌드 설정은 필요 없습니다. 빌드 방식이 Nixpacks 등으로 표시되면 서비스 Settings → Build에서 **Dockerfile**을 선택하세요.

## 3. 서비스별 설정

각 서비스 선택 → **Settings**에서 설정합니다.

### 3-1. api

| 항목 (Settings 내 위치) | 값 |
| --- | --- |
| Deploy → Custom Start Command | `sh -c "node dist/migrate.js && exec node dist/api/main.js"` |
| Deploy → Healthcheck Path | `/healthz` |
| Networking → Public Networking | **Generate Domain** (생성된 `https://...up.railway.app` 주소를 메모) |

환경변수 (서비스 → **Variables**):

| 변수 | 값 |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Postgres 서비스 이름이 다르면 그 이름) |
| `SCHEDULER_TOKEN` | 1-2에서 만든 값 |
| `DASHBOARD_PASSWORD` | 1-2에서 만든 값 |
| `SESSION_SECRET` | 1-2에서 만든 값 (32자 이상) |
| `DEFAULT_DAILY_LIMIT` | `10` (처음에는 낮게 시작하는 것을 권장) |

- `PORT`는 Railway가 자동으로 주입합니다. 서버는 `0.0.0.0:$PORT`로 듣습니다.
- 시작 시 `DATABASE_URL`, `SCHEDULER_TOKEN`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`이 하나라도 없으면 서버가 바로 종료합니다. 배포 로그에 `Missing required environment variable: ...`이 보이면 이 변수를 확인하세요.

### 3-2. worker

| 항목 | 값 |
| --- | --- |
| Deploy → Custom Start Command | `node dist/worker/main.js` |
| Networking | 도메인을 만들지 않습니다 |

환경변수:

| 변수 | 값 |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `CLAUDE_CODE_OAUTH_TOKEN` | 1-3에서 발급한 구독 토큰 |
| `GITHUB_TOKEN` | GitHub Fine-grained 토큰 |
| `DISCORD_WEBHOOK_ALERTS` | #alerts 웹훅 URL |
| `DISCORD_WEBHOOK_DAILY` | #daily-report 웹훅 URL |
| `DASHBOARD_URL` | api의 공개 주소. 예: `https://inspector-production.up.railway.app` (끝에 `/` 없이) |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` (전체 이름으로 고정 권장) |
| `CLAUDE_MAX_BUDGET_USD` | `1` (작업 1건당 사용량 상한, API 요금 환산 기준) |
| `WORKER_CONCURRENCY` | `1` |

- `DASHBOARD_URL`은 api 도메인을 만든 뒤에 채웁니다. Discord 알림의 "작업 보기" 링크에 쓰입니다.
- `CLAUDE_MODEL`을 비우면 Claude Code의 기본 모델이 쓰입니다. 구독 한도를 아끼려면 `claude-sonnet-5-5`처럼 명시하세요. 상위 모델일수록 한도가 빨리 줄어듭니다.
- `ANTHROPIC_API_KEY`는 넣지 않습니다. 넣으면 구독 토큰 대신 API 키(유료 과금)가 쓰입니다.
- (선택) `USAGE_LIMIT_BACKOFF_MINUTES`: 사용 한도에 걸렸을 때 다시 시도하기까지 기다리는 시간. 기본 `30`.
- 공개 저장소가 아닌 경우 `GITHUB_TOKEN`이 없으면 clone이 실패합니다.

### 3-3. scheduler

| 항목 | 값 |
| --- | --- |
| Deploy → Custom Start Command | `node dist/scheduler.js` |
| Deploy → Cron Schedule | `0 0 * * *` |
| Networking | 도메인을 만들지 않습니다 |

- Cron은 **UTC 기준**입니다. `0 0 * * *`는 UTC 00:00이므로 **한국 시간 오전 9시**입니다. 시각을 바꾸려면 9시간을 빼서 입력하세요. (예: 한국 시간 오전 6시 → `0 21 * * *`, 전날 UTC 21:00)
- 이 서비스는 실행 후 종료하는 일회성 프로세스입니다. Cron 설정이 있으면 Railway가 정해진 시각에만 실행합니다.

환경변수:

| 변수 | 값 |
| --- | --- |
| `API_URL` | api의 **공개 주소**. 예: `https://inspector-production.up.railway.app` |
| `SCHEDULER_TOKEN` | api와 **같은 값** |

> `API_URL`에 비공개(내부) 주소를 쓸 수도 있지만 권하지 않습니다. 내부 주소는 IPv6로 연결되는 환경이 있어, IPv4(`0.0.0.0`)로 듣는 현재 서버에 연결되지 않을 수 있습니다. 공개 주소는 `SCHEDULER_TOKEN`으로 보호되므로 안전합니다.

## 4. 배포하기

1. 세 서비스의 설정과 변수를 저장한 뒤, **api → worker → scheduler** 순서로 배포합니다. (서비스 → Deployments → **Redeploy** 또는 변수 저장 시 나오는 **Deploy** 버튼)
   - api를 먼저 배포하는 이유는 api가 시작할 때 DB 테이블을 만들기 때문입니다. worker는 테이블이 없으면 오류를 냅니다.
2. 배포가 끝나면 각 서비스의 **Deploy Logs**를 확인합니다.

| 서비스 | 정상 로그 |
| --- | --- |
| api | `applied 001_init.sql` (처음 한 번), 이어서 `Server listening at http://0.0.0.0:...` |
| worker | `[worker] 시작: 인증 Claude 구독 토큰, 동시 실행 1, 타임아웃 600초` (`인증 API 키`로 나오면 `ANTHROPIC_API_KEY`가 설정돼 있는 것) |
| scheduler | Cron 서비스라 다음 실행 시각 전까지는 로그가 없는 것이 정상입니다 |

3. 브라우저에서 확인합니다.
   - `https://<api 도메인>/healthz` → `{"ok":true}`
   - `https://<api 도메인>/login` → 로그인 화면. `DASHBOARD_PASSWORD`로 로그인하면 빈 작업 목록이 보입니다.
4. 브랜치 지정: 각 서비스 Settings → Source의 **Branch**에서 배포할 브랜치를 고릅니다. 아직 `main`에 병합하기 전이라면 `feat/inspector-server`를, 병합한 뒤에는 `main`을 지정합니다.
5. 코드 변경 후 재배포: 지정한 브랜치에 push하면 세 서비스가 자동으로 다시 빌드됩니다. 서비스마다 따로 빌드하므로 시간이 세 배 걸릴 수 있습니다.

## 5. 첫 프로젝트 등록

점검할 프로젝트를 DB에 등록하고 토큰을 발급받습니다. Railway 안의 `DATABASE_URL`은 내부 주소라 내 컴퓨터에서 접속되지 않으므로, Postgres의 **공개 연결 주소**를 잠깐 씁니다.

1. Postgres 서비스 → **Variables**에서 `DATABASE_PUBLIC_URL` 값을 복사합니다. (보이지 않으면 Settings → Networking에서 TCP 프록시를 켜세요.)
2. 로컬에서 의존성을 설치하고 명령을 실행합니다.

PowerShell:

```powershell
npm install
$env:DATABASE_URL = "<DATABASE_PUBLIC_URL 값>"
npm run dev:project:add -- --name my-project-a --repo https://github.com/<owner>/<repo> --branch main --limit 10 --debounce 3600
Remove-Item Env:DATABASE_URL
```

Bash:

```sh
npm install
DATABASE_URL="<DATABASE_PUBLIC_URL 값>" npm run dev:project:add -- --name my-project-a --repo https://github.com/<owner>/<repo> --branch main --limit 10 --debounce 3600
```

3. 출력된 토큰(`ci_...`)을 복사합니다. **다시 볼 수 없습니다.** 잃어버리면 `--rotate`로 재발급합니다.
4. 대상 프로젝트(Railway 등)의 환경변수에 다음을 저장합니다.
   - `INSPECTOR_URL` = api 공개 주소
   - `INSPECTOR_TOKEN` = 방금 받은 토큰

옵션: `--name`은 소문자, 숫자, 하이픈만 가능합니다. `--limit`은 하루 호출 상한, `--debounce`는 같은 오류를 다시 분석하지 않는 시간(초)입니다.

> 등록 명령이 연결 오류(SSL 관련 등)로 실패하면 오류 메시지 전문을 확인해 알려 주세요. 이 경로는 제가 직접 실행해 보지 못했습니다.

## 6. 동작 확인 (처음 한 번)

아래 순서대로 하나씩 확인합니다. 어디서 막히는지가 곧 문제 위치입니다.

### 6-1. 오류 분석 흐름

Bash (`<...>` 부분 교체):

```sh
curl -i -X POST https://<api 도메인>/inspect \
  -H "Authorization: Bearer <프로젝트 토큰>" \
  -H "Content-Type: application/json" \
  -d '{"project":"my-project-a","type":"error","severity":"warning","error_hash":"deploy-test-1","logs":"ERROR sample failure for deploy test","occurred_at":"2026-10-27T16:00:00+09:00"}'
```

PowerShell:

```powershell
$body = @{ project="my-project-a"; type="error"; severity="warning"; error_hash="deploy-test-1"; logs="ERROR sample failure for deploy test"; occurred_at="2026-10-27T16:00:00+09:00" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://<api 도메인>/inspect" -Headers @{ Authorization = "Bearer <프로젝트 토큰>" } -ContentType "application/json" -Body $body
```

기대 결과와 확인:
1. `202`와 `job_id`가 반환됩니다.
2. 같은 요청을 한 번 더 보내면 `409`(디바운스)가 반환됩니다.
3. worker 로그에 `J-<번호> 시작` → `완료`가 순서대로 나옵니다. 첫 실행은 clone과 분석 때문에 1~3분 걸릴 수 있습니다.
4. 대시보드 작업 목록에 작업이 나타나고, 상태가 `대기` → `실행 중` → `완료`로 바뀝니다. 작업을 눌러 리포트가 보이는지 확인합니다.

> 테스트가 끝난 뒤 같은 `error_hash`로 다시 시험하려면 디바운스 시간이 지나야 하므로, 다른 `error_hash`(`deploy-test-2` 등)를 쓰세요.

### 6-2. 정기 점검과 Discord 알림

```sh
curl -i -X POST https://<api 도메인>/health-check \
  -H "Authorization: Bearer <SCHEDULER_TOKEN>" -H "Content-Type: application/json" -d '{}'
```

- `202`와 함께 활성 프로젝트마다 작업이 하나씩 등록됩니다. 같은 날 다시 호출하면 `created: 0`이 반환됩니다. (하루 1회 제한)
- 점검이 끝나면 `#daily-report`에 요약이 도착합니다.
- Discord에 알림이 오지 않으면 worker 변수 `DISCORD_WEBHOOK_DAILY`를 확인하세요. 변수가 비어 있으면 알림을 조용히 건너뛰고 로그에 경고만 남깁니다.

### 6-3. 스케줄러(Cron)
- 설정한 시각 이후 scheduler 서비스의 Deployments에 실행 기록이 생기고, 로그에 `[scheduler] 202 ...`가 찍힙니다.
- 첫 실행이 다음 날 아침까지 기다려야 하므로, 6-2의 수동 호출로 흐름을 먼저 검증하고 Cron은 다음 날 확인해도 됩니다.

### 6-4. critical 알림
- `severity`를 `critical`로 보내 분석이 끝났을 때 결과가 critical로 판단되면 `#alerts`로 알림이 갑니다. 결과 심각도는 Claude가 다시 판단하므로 입력과 다를 수 있습니다.

## 7. 비용과 안전 장치

| 장치 | 위치 | 기본값 |
| --- | --- | --- |
| 프로젝트별 일일 호출 상한 | 프로젝트 등록 `--limit` | 20 (환경변수 `DEFAULT_DAILY_LIMIT`) |
| 같은 오류 재분석 금지 시간 | 프로젝트 등록 `--debounce` | 3600초 |
| 작업 1건당 사용량 상한 | worker `CLAUDE_MAX_BUDGET_USD` | 1달러 (API 요금 환산) |
| 사용 한도 도달 시 대기 | worker `USAGE_LIMIT_BACKOFF_MINUTES` | 30분 |
| 작업 타임아웃 | worker `JOB_TIMEOUT_SECONDS` | 600초 |
| 최대 시도 횟수 | worker `JOB_MAX_ATTEMPTS` | 2 |
| 워커 동시 실행 | worker `WORKER_CONCURRENCY` | 1 (최대 2) |

- 구독 토큰을 쓰면 추가 요금은 없지만, 서버 분석이 **구독 사용 한도를 평소 사용과 함께 소진**합니다. 하루 최대 작업 수는 `프로젝트 수 × 일일 상한 + 정기 점검`이므로, 처음에는 일일 상한을 낮게(예: 5~10) 시작하세요.
- `CLAUDE_MAX_BUDGET_USD`는 구독에서도 API 요금 환산 사용량으로 계산돼, 한 건이 한도를 과하게 쓰는 것을 막는 용도로 동작합니다. 대시보드 작업 상세의 "API 환산 비용"으로 건당 사용량을 가늠할 수 있습니다.
- API 키로 바꿔 쓸 경우에는 Anthropic Console에서 키의 월 지출 한도를 반드시 걸어 두세요.
- Railway에서도 프로젝트 Usage 한도(Usage limit)를 설정할 수 있는지 확인하세요.

## 8. 운영

| 하고 싶은 일 | 방법 |
| --- | --- |
| 로그 보기 | Railway 서비스 → Deployments → 배포 선택 → Deploy Logs |
| 프로젝트 추가 | 5번 절차를 이름만 바꿔 반복 |
| 토큰 재발급 | `npm run dev:project:add -- --name <이름> --rotate` (5번과 같이 `DATABASE_URL` 지정). 대상 프로젝트의 `INSPECTOR_TOKEN`도 교체 |
| 프로젝트 비활성화 | `npm run dev:project:add -- --name <이름> --deactivate` |
| 일일 상한·디바운스 변경 | 같은 `--name`으로 `--repo`와 함께 `--limit`/`--debounce`를 다시 지정 (기존 값을 덮어씀, 토큰도 재발급됨에 주의) |
| 모델 변경 | worker의 `CLAUDE_MODEL` 변경 후 재배포 |
| 대시보드 비밀번호 변경 | api의 `DASHBOARD_PASSWORD` 변경 후 재배포. 기존 세션은 최대 12시간 유지됨 |
| 모든 로그인 세션 무효화 | api의 `SESSION_SECRET` 변경 후 재배포 |

> 같은 `--name`으로 다시 등록하면 토큰이 **새로 발급**되고 기존 토큰은 무효가 됩니다. 설정만 바꾸고 싶어도 대상 프로젝트의 토큰을 함께 갱신해야 합니다.

## 9. 문제 해결

| 증상 | 원인과 확인 |
| --- | --- |
| api가 시작 직후 종료 | 로그의 `Missing required environment variable` 확인. `SESSION_SECRET`은 32자 이상 |
| api 헬스체크 실패로 배포 실패 | `DATABASE_URL`이 `${{Postgres.DATABASE_URL}}`로 연결됐는지, Postgres 서비스 이름이 일치하는지 확인 |
| 빌드 중 `npm ci` 실패 | `package-lock.json`이 커밋돼 있는지 확인 |
| 대시보드 로그인이 계속 풀림 | 쿠키는 HTTPS 전용입니다. `http://`가 아닌 `https://` 주소로 접속 |
| 로그인 시도가 막힘 (429) | 15분에 10회 실패하면 잠깁니다. 15분 뒤 재시도하거나 api를 재시작 |
| `/inspect`가 401 | 토큰 오타, 또는 `Bearer ` 접두사 누락. 토큰은 등록 때 출력된 값 그대로 |
| `/inspect`가 403 | 요청 본문의 `project`가 토큰의 프로젝트 이름과 다름, 또는 비활성 프로젝트 |
| `/inspect`가 400 | 본문 형식 오류. 응답의 `issues`를 확인 (`occurred_at`은 시간대가 포함된 ISO 8601) |
| `/inspect`가 409 | 정상입니다. 같은 `error_hash`가 디바운스 시간 안에 이미 등록됨 |
| `/inspect`가 429 | 오늘 호출 상한을 넘음. 한국 시간 자정에 초기화 |
| 작업이 `대기`에서 멈춤 | worker가 실행 중인지, worker 로그에 오류가 없는지 확인. 10분 넘게 대기하면 #alerts로 알림이 옴 |
| 작업이 `실패`, 사유가 clone 오류 | `GITHUB_TOKEN`의 저장소 접근 범위와 만료일, 프로젝트 등록 시 `--repo` 주소 확인 |
| worker가 시작 직후 종료 (`ANTHROPIC_API_KEY 또는 CLAUDE_CODE_OAUTH_TOKEN`) | worker에 `CLAUDE_CODE_OAUTH_TOKEN`이 없음 |
| 작업이 `실패`, `OAuth access token is invalid` | 구독 토큰이 틀리거나 만료·취소됨. `claude setup-token`으로 재발급 후 교체 |
| 작업이 `실패`, `Invalid API key` | `ANTHROPIC_API_KEY`가 설정돼 있어 API 키 모드로 동작 중. 구독만 쓰려면 이 변수를 삭제 |
| 작업이 `대기`, 사유 `사용 한도로 30분 뒤 재시도` | 구독 사용 한도 도달. 한도가 풀리면 자동으로 다시 실행됨. 자주 생기면 일일 상한을 낮추거나 더 가벼운 모델 사용 |
| 작업이 `실패`, 타임아웃 | 저장소가 크거나 분석이 오래 걸림. `JOB_TIMEOUT_SECONDS` 상향 또는 `CLAUDE_MAX_BUDGET_USD` 조정 |
| 작업이 `실패`, 비용 상한 | 분석이 상한에 걸려 중단됨. `CLAUDE_MAX_BUDGET_USD` 상향 |
| Discord 알림이 안 옴 | 웹훅 변수가 비었는지, URL이 삭제된 웹훅은 아닌지 확인. worker 로그의 `[discord]` 줄 참고 |
| 알림 링크가 안 열림 | worker의 `DASHBOARD_URL` 확인 (api 공개 주소, 끝에 `/` 없이) |

## 10. 보안 점검표

- [ ] `CLAUDE_CODE_OAUTH_TOKEN`은 **worker에만** 설정했다 (api와 scheduler에는 넣지 않음)
- [ ] 구독을 서버 자동 실행에 쓰는 것이 이용 약관에 맞는지 확인했다
- [ ] `GITHUB_TOKEN`은 Contents 읽기 전용이고, 필요한 저장소만 선택했으며, 만료일이 있다
- [ ] worker와 scheduler에는 공개 도메인이 없다
- [ ] `DASHBOARD_PASSWORD`는 길고 다른 곳에서 쓰지 않는 값이다
- [ ] 비밀 값을 저장소, 이슈, 채팅에 붙이지 않았다 (`.env` 파일은 `.gitignore`에 포함됨)
- [ ] 프로젝트 토큰은 대상 프로젝트의 환경변수에만 있다 (DB에는 해시만 저장됨)
