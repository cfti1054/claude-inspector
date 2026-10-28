-- Claude 실행 1회당 모델별 사용량. 외부 사용량 집계(AI Usage Hub 등)가 /usage API로 읽어 간다.
CREATE TABLE usage_records (
  id                    bigserial PRIMARY KEY,
  job_id                bigint NOT NULL REFERENCES jobs(id),
  project_id            bigint NOT NULL REFERENCES projects(id),
  job_type              text NOT NULL,
  attempt               integer NOT NULL,
  outcome               text NOT NULL CHECK (outcome IN ('done', 'failed', 'deferred')),
  auth_kind             text NOT NULL CHECK (auth_kind IN ('api-key', 'subscription')),
  model                 text NOT NULL,
  input_tokens          bigint NOT NULL DEFAULT 0,
  output_tokens         bigint NOT NULL DEFAULT 0,
  cache_read_tokens     bigint NOT NULL DEFAULT 0,
  cache_creation_tokens bigint NOT NULL DEFAULT 0,
  cost_usd              numeric(12, 6),
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_records_recorded_idx ON usage_records (recorded_at);
CREATE INDEX usage_records_job_idx ON usage_records (job_id);
