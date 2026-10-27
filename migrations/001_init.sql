-- 1~3단계 스키마. approvals, actions_log는 4단계에서 추가한다.

CREATE TABLE projects (
  id               bigserial PRIMARY KEY,
  name             text NOT NULL UNIQUE,
  repo_url         text NOT NULL,
  repo_branch      text NOT NULL DEFAULT 'main',
  token_hash       text NOT NULL UNIQUE,
  daily_limit      integer NOT NULL,
  debounce_seconds integer NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id),
  type        text NOT NULL CHECK (type IN ('error', 'health')),
  severity    text CHECK (severity IN ('critical', 'error', 'warning')),
  status      text NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'running', 'waiting_approval', 'done', 'failed')),
  error_hash  text,
  payload     jsonb NOT NULL DEFAULT '{}',
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);

CREATE INDEX jobs_queue_idx ON jobs (created_at) WHERE status = 'queued';
CREATE INDEX jobs_debounce_idx ON jobs (project_id, error_hash, created_at DESC);
CREATE INDEX jobs_created_idx ON jobs (created_at DESC);

CREATE TABLE reports (
  id         bigserial PRIMARY KEY,
  job_id     bigint NOT NULL UNIQUE REFERENCES jobs(id),
  severity   text NOT NULL CHECK (severity IN ('ok', 'warning', 'error', 'critical')),
  summary    text NOT NULL,
  body       jsonb NOT NULL,
  cost_usd   numeric(10, 4),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- dedupe_key가 있는 알림은 한 번만 보낸다 (일일 요약, 큐 정체 알림 등)
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  job_id     bigint REFERENCES jobs(id),
  channel    text NOT NULL,
  kind       text NOT NULL,
  dedupe_key text UNIQUE,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_sent_idx ON notifications (sent_at DESC);
