import type pg from 'pg';
import { db, tx } from './db.js';
import { KST_TODAY_START } from './time.js';

export type JobType = 'error' | 'health';
export type JobStatus = 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed';
export type Severity = 'critical' | 'error' | 'warning';

export interface Project {
  id: number;
  name: string;
  repo_url: string;
  repo_branch: string;
  daily_limit: number;
  debounce_seconds: number;
  active: boolean;
}

export interface Job {
  id: number;
  project_id: number;
  type: JobType;
  severity: Severity | null;
  status: JobStatus;
  error_hash: string | null;
  payload: { logs?: string; occurred_at?: string };
  attempts: number;
  last_error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export function jobLabel(id: number): string {
  return `J-${id}`;
}

export async function findProjectByTokenHash(tokenHash: string): Promise<Project | null> {
  const r = await db().query<Project>(
    `SELECT id, name, repo_url, repo_branch, daily_limit, debounce_seconds, active
       FROM projects WHERE token_hash = $1`,
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

export type EnqueueResult =
  | { kind: 'created'; jobId: number }
  | { kind: 'debounced'; jobId: number }
  | { kind: 'limited'; limit: number };

// 디바운스 → 일일 상한 순서로 검사한 뒤 등록한다. 디바운스로 거절된 요청은 상한에 포함되지 않는다.
// 같은 프로젝트의 동시 요청이 검사를 함께 통과하지 않도록 프로젝트 단위로 잠근다.
export async function enqueueError(
  project: Project,
  input: { severity: Severity; errorHash: string; logs: string; occurredAt: string },
): Promise<EnqueueResult> {
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(1, $1::int)', [project.id]);

    const dup = await c.query<{ id: number }>(
      `SELECT id FROM jobs
        WHERE project_id = $1 AND error_hash = $2
          AND created_at > now() - make_interval(secs => $3)
        ORDER BY created_at DESC LIMIT 1`,
      [project.id, input.errorHash, project.debounce_seconds],
    );
    if (dup.rows[0]) return { kind: 'debounced', jobId: dup.rows[0].id };

    // 일일 상한은 /inspect(error)에만 적용한다. 정기 점검은 상한과 무관하게 실행한다.
    const used = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs
        WHERE project_id = $1 AND type = 'error' AND created_at >= ${KST_TODAY_START}`,
      [project.id],
    );
    if ((used.rows[0]?.n ?? 0) >= project.daily_limit) return { kind: 'limited', limit: project.daily_limit };

    const ins = await c.query<{ id: number }>(
      `INSERT INTO jobs (project_id, type, severity, error_hash, payload)
       VALUES ($1, 'error', $2, $3, $4) RETURNING id`,
      [project.id, input.severity, input.errorHash, { logs: input.logs, occurred_at: input.occurredAt }],
    );
    return { kind: 'created', jobId: ins.rows[0]!.id };
  });
}

// 활성 프로젝트마다 정기 점검을 등록한다. 오늘(KST) 이미 등록된 프로젝트는 건너뛰므로 다시 호출해도 안전하다.
export async function enqueueHealthChecks(): Promise<Array<{ project: string; jobId: number }>> {
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(2, 0)');
    const r = await c.query<{ project: string; job_id: number }>(
      `INSERT INTO jobs (project_id, type)
       SELECT p.id, 'health' FROM projects p
        WHERE p.active AND NOT EXISTS (
          SELECT 1 FROM jobs j
           WHERE j.project_id = p.id AND j.type = 'health' AND j.created_at >= ${KST_TODAY_START})
       RETURNING id AS job_id, (SELECT name FROM projects WHERE id = project_id) AS project`,
    );
    return r.rows.map((row) => ({ project: row.project, jobId: row.job_id }));
  });
}

// 여러 워커가 같은 작업을 잡지 않도록 SKIP LOCKED로 하나를 꺼낸다
export async function claimJob(): Promise<(Job & { project: Project }) | null> {
  const r = await db().query<Job>(
    `UPDATE jobs SET status = 'running', started_at = now(), attempts = attempts + 1, last_error = NULL, run_after = NULL
      WHERE id = (
        SELECT id FROM jobs WHERE status = 'queued' AND (run_after IS NULL OR run_after <= now())
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
  );
  const job = r.rows[0];
  if (!job) return null;
  const p = await db().query<Project>(
    `SELECT id, name, repo_url, repo_branch, daily_limit, debounce_seconds, active FROM projects WHERE id = $1`,
    [job.project_id],
  );
  return { ...job, project: p.rows[0]! };
}

export interface ReportInput {
  severity: 'ok' | 'warning' | 'error' | 'critical';
  summary: string;
  body: unknown;
  costUsd: number | null;
}

export async function completeJob(jobId: number, report: ReportInput): Promise<void> {
  await tx(async (c) => {
    await c.query(
      `INSERT INTO reports (job_id, severity, summary, body, cost_usd) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id) DO UPDATE
         SET severity = EXCLUDED.severity, summary = EXCLUDED.summary,
             body = EXCLUDED.body, cost_usd = EXCLUDED.cost_usd, created_at = now()`,
      [jobId, report.severity, report.summary, report.body, report.costUsd],
    );
    await c.query(`UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1`, [jobId]);
  });
}

// 재시도 횟수가 남았으면 큐로 되돌리고, 아니면 failed로 확정한다. 확정 여부를 반환한다.
export async function failJob(jobId: number, message: string, maxAttempts: number): Promise<boolean> {
  const r = await db().query<{ status: JobStatus }>(
    `UPDATE jobs
        SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'queued' END,
            finished_at = CASE WHEN attempts >= $3 THEN now() ELSE NULL END,
            started_at = CASE WHEN attempts >= $3 THEN started_at ELSE NULL END,
            last_error = $2
      WHERE id = $1 RETURNING status`,
    [jobId, message.slice(0, 2000), maxAttempts],
  );
  return r.rows[0]?.status === 'failed';
}

// 사용 한도처럼 작업 자체의 문제가 아닌 실패는 시도 횟수를 되돌리고 일정 시간 뒤로 미룬다
export async function deferJob(jobId: number, message: string, minutes: number): Promise<void> {
  await db().query(
    `UPDATE jobs
        SET status = 'queued', started_at = NULL, attempts = greatest(attempts - 1, 0),
            run_after = now() + make_interval(mins => $3), last_error = $2
      WHERE id = $1`,
    [jobId, message.slice(0, 2000), minutes],
  );
}

// 워커가 비정상 종료해 running으로 남은 작업을 되돌린다 (타임아웃의 2배 기준)
export async function recoverStaleJobs(timeoutMs: number, maxAttempts: number): Promise<Job[]> {
  const r = await db().query<Job>(
    `UPDATE jobs
        SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END,
            finished_at = CASE WHEN attempts >= $2 THEN now() ELSE NULL END,
            last_error = '워커 응답 없음 (작업 회수)'
      WHERE status = 'running' AND started_at < now() - make_interval(secs => $1)
      RETURNING *`,
    [(timeoutMs * 2) / 1000, maxAttempts],
  );
  return r.rows;
}

export async function oldestQueuedAgeMinutes(c: pg.Pool | pg.PoolClient = db()): Promise<number> {
  const r = await c.query<{ m: number | null }>(
    // 사용 한도로 미뤄 둔 작업은 정체로 보지 않는다
    `SELECT floor(extract(epoch FROM now() - min(created_at)) / 60)::int AS m FROM jobs
      WHERE status = 'queued' AND (run_after IS NULL OR run_after <= now())`,
  );
  return r.rows[0]?.m ?? 0;
}
