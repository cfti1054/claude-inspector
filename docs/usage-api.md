# 사용량 API

점검 서버가 Claude Code를 실행하며 쓴 사용량을 외부 집계 도구(AI Usage Hub 등)가 가져갈 수 있게 하는 읽기 전용 API입니다. 점검 서버를 "Claude Code를 쓰는 PC 한 대"처럼 등록해 쓰는 것을 전제로 합니다.

## 무엇이 기록되나

워커가 Claude Code를 **한 번 실행할 때마다, 모델별로 한 줄**씩 남깁니다.

- 성공한 실행(`done`)뿐 아니라 실패(`failed`)와 사용 한도로 미뤄진 실행(`deferred`)에서 쓴 양도 기록합니다. 구독 한도는 실패한 실행에서도 줄어들기 때문입니다.
- 한 작업이 재시도되면 시도마다 따로 기록됩니다(`attempt`).
- Claude Code가 보조 작업에 다른 모델을 함께 쓰면 모델마다 한 줄씩 생깁니다.
- 분석 내용, 로그, 저장소 코드는 들어가지 않습니다. 수치와 프로젝트 이름만 나갑니다.

> 사용량은 Claude Code CLI의 JSON 출력(`modelUsage`, 없으면 `usage`)에서 읽습니다. 이 필드 구조는 실제 구독 토큰 실행으로 아직 확인하지 못했습니다. 구조가 다르면 기록이 남지 않으므로, 배포 후 첫 분석이 끝나면 대시보드 작업 상세의 "토큰" 칸이 채워지는지 확인하세요.

## 설정

| 변수 | 서비스 | 설명 |
| --- | --- | --- |
| `USAGE_API_TOKEN` | api | Hub가 쓸 읽기 전용 토큰. 비우면 `/usage`가 꺼지고 503을 반환합니다 |
| `USAGE_SOURCE_NAME` | api | (선택) 응답의 `source` 값. 기본 `claude-inspector`. Hub에서 이 서버를 구분하는 이름 |

토큰 만들기:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

같은 값을 점검 서버 api의 `USAGE_API_TOKEN`과 Hub의 설정(예: `INSPECTOR_USAGE_TOKEN`)에 넣습니다. 이 토큰은 사용량 조회만 할 수 있고, 작업 등록이나 대시보드 접근은 할 수 없습니다.

## 공통

- 기본 주소: 점검 서버 api의 공개 주소 (예: `https://inspector-production.up.railway.app`)
- 인증: `Authorization: Bearer <USAGE_API_TOKEN>`
- 응답: JSON, `Cache-Control: no-store`
- 시각: ISO 8601 (응답은 UTC `Z`). 요청에는 시간대가 포함된 값을 넣습니다 (`2026-10-28T00:00:00+09:00` 또는 `...Z`)

| 상태 코드 | 의미 |
| --- | --- |
| 200 | 성공 |
| 400 | 쿼리 형식 오류. `issues`에 이유가 들어 있음 |
| 401 | 토큰이 없거나 틀림 |
| 503 | 점검 서버에 `USAGE_API_TOKEN`이 설정되지 않음 |

## GET /usage/records — 증분 동기화

마지막으로 받은 `id` 이후의 기록을 `id` 순서로 돌려줍니다. Hub는 `next_after_id`를 저장해 두고 다음 호출에 넘기면 빠짐없이, 중복 없이 받아 갈 수 있습니다.

| 쿼리 | 기본값 | 설명 |
| --- | --- | --- |
| `after_id` | `0` | 이 id보다 큰 기록만. 처음에는 0 |
| `since` | (없음) | 이 시각 이후 기록만. 처음 연동할 때 과거 전체를 받지 않으려면 사용 |
| `limit` | `500` | 1~1000 |

요청:

```sh
curl -H "Authorization: Bearer $INSPECTOR_USAGE_TOKEN" \
  "https://<api 도메인>/usage/records?after_id=0&limit=500"
```

응답:

```json
{
  "source": "claude-inspector",
  "records": [
    {
      "id": 41,
      "recorded_at": "2026-10-28T07:04:52.118Z",
      "project": "my-project-a",
      "job_id": 1048,
      "job": "J-1048",
      "job_type": "error",
      "attempt": 1,
      "outcome": "done",
      "auth_kind": "subscription",
      "model": "claude-sonnet-5-5",
      "input_tokens": 1200,
      "output_tokens": 340,
      "cache_read_tokens": 5000,
      "cache_creation_tokens": 800,
      "cost_usd": 0.042
    }
  ],
  "next_after_id": 41,
  "has_more": false
}
```

| 필드 | 설명 |
| --- | --- |
| `id` | 기록 고유 번호. 커질수록 최근 |
| `recorded_at` | 기록 시각 (실행이 끝난 시각) |
| `project` | 점검 서버에 등록된 프로젝트 이름 |
| `job_id`, `job` | 작업 번호와 표시용 이름 |
| `job_type` | `error`(오류 분석) 또는 `health`(정기 점검) |
| `attempt` | 몇 번째 시도인지 |
| `outcome` | `done`, `failed`, `deferred`(사용 한도로 미뤄짐) |
| `auth_kind` | `subscription`(구독 토큰) 또는 `api-key` |
| `model` | 모델 이름. CLI가 모델별 정보를 주지 않으면 `CLAUDE_MODEL` 값 또는 `unknown` |
| `input_tokens` | 입력 토큰 (캐시 제외) |
| `output_tokens` | 출력 토큰 |
| `cache_read_tokens` | 캐시에서 읽은 입력 토큰 |
| `cache_creation_tokens` | 캐시에 새로 쓴 입력 토큰 |
| `cost_usd` | API 요금 환산 금액. **구독에서는 실제 청구액이 아닙니다.** 없으면 `null` |

### 동기화 방법 (Hub 쪽 의사 코드)

```ts
let after = await store.get('inspector.after_id') ?? 0;
for (;;) {
  const res = await fetch(`${INSPECTOR_URL}/usage/records?after_id=${after}&limit=1000`, {
    headers: { Authorization: `Bearer ${INSPECTOR_USAGE_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`inspector usage ${res.status}`);
  const page = await res.json();
  await saveRecords(page.source, page.records); // id 기준으로 저장하면 재시도해도 중복되지 않음
  after = page.next_after_id;
  await store.set('inspector.after_id', after);
  if (!page.has_more) break;
}
```

- 5~15분 간격으로 호출하면 충분합니다.
- 기록은 지워지거나 수정되지 않으므로, `id`로 저장하면 같은 페이지를 다시 받아도 안전합니다.

## GET /usage/summary — 기간 합계

기간 `[from, to)`의 합계와 묶음별 합계를 돌려줍니다. Hub가 원본 기록을 저장하지 않고 화면에 바로 보여 줄 때 씁니다.

| 쿼리 | 기본값 | 설명 |
| --- | --- | --- |
| `from` | (필수) | 시작 시각 (포함) |
| `to` | (필수) | 끝 시각 (미포함). 최대 400일 |
| `group_by` | `day` | `day`(한국 시간 날짜), `project`, `model` |

요청:

```sh
curl -H "Authorization: Bearer $INSPECTOR_USAGE_TOKEN" \
  "https://<api 도메인>/usage/summary?from=2026-10-01T00:00:00%2B09:00&to=2026-11-01T00:00:00%2B09:00&group_by=day"
```

`+`는 URL에서 공백으로 바뀌므로 `%2B`로 쓰거나 UTC(`Z`)로 보내세요.

응답:

```json
{
  "source": "claude-inspector",
  "from": "2026-09-30T15:00:00.000Z",
  "to": "2026-10-31T15:00:00.000Z",
  "group_by": "day",
  "timezone": "Asia/Seoul",
  "totals": {
    "runs": 58, "jobs": 51,
    "input_tokens": 61200, "output_tokens": 18400,
    "cache_read_tokens": 402000, "cache_creation_tokens": 37100,
    "cost_usd": 2.318
  },
  "groups": [
    { "key": "2026-10-27", "runs": 12, "jobs": 11, "input_tokens": 13100, "output_tokens": 3900, "cache_read_tokens": 88000, "cache_creation_tokens": 8100, "cost_usd": 0.51 }
  ]
}
```

- `runs`는 실행 횟수(모델별 줄 수), `jobs`는 서로 다른 작업 수입니다.
- 기록이 없는 날은 `groups`에 나오지 않습니다.

## 보안

- `USAGE_API_TOKEN`은 Hub와 점검 서버 api에만 둡니다. 유출이 의심되면 값을 바꾸고 api를 재배포하세요.
- 응답에는 프로젝트 이름과 수치만 들어갑니다. 로그, 리포트, 저장소 정보는 나가지 않습니다.
- 이 API는 쓰기 기능이 없습니다.
