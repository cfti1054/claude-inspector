import { db } from '../db.js';
import type { JobStatus, JobType, Severity } from '../jobs.js';
import { KST_TODAY_START } from '../time.js';

export type Range = 'today' | '7d' | '30d';
export type StatusFilter = JobStatus | 'all';

export const PAGE_SIZE = 50;

function rangeStart(range: Range): string {
  if (range === '7d') return "now() - interval '7 days'";
  if (range === '30d') return "now() - interval '30 days'";
  return KST_TODAY_START;
}

export interface JobRow {
  id: number;
  project: string;
  type: JobType;
  severity: Severity | null;
  status: JobStatus;
  summary: string | null;
  report_severity: string | null;
  last_error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

// 검색어와 기간 조건. "J-1044" 형태면 작업 ID로도 찾는다.
function filters(range: Range, q: string): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts = [`j.created_at >= ${rangeStart(range)}`];
  const term = q.trim();
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    const idMatch = /^j-?(\d+)$/i.exec(term);
    let cond = `(p.name ILIKE $${params.length} OR r.summary ILIKE $${params.length} OR j.error_hash ILIKE $${params.length}`;
    if (idMatch) {
      params.push(Number(idMatch[1]));
      cond += ` OR j.id = $${params.length}`;
    }
    parts.push(cond + ')');
  }
  return { where: parts.join(' AND '), params };
}

export async function listJobs(range: Range, q: string, status: StatusFilter, page: number) {
  const f = filters(range, q);
  const params = [...f.params];
  let where = f.where;
  if (status !== 'all') {
    params.push(status);
    where += ` AND j.status = $${params.length}`;
  }
  params.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const rows = await db().query<JobRow>(
    `SELECT j.id, p.name AS project, j.type, j.severity, j.status, r.summary, r.severity AS report_severity,
            j.last_error, j.created_at, j.started_at, j.finished_at
       FROM jobs j JOIN projects p ON p.id = j.project_id LEFT JOIN reports r ON r.job_id = j.id
      WHERE ${where}
      ORDER BY j.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows.rows.slice(0, PAGE_SIZE), hasMore: rows.rows.length > PAGE_SIZE };
}

export async function jobCounts(range: Range, q: string) {
  const f = filters(range, q);
  const r = await db().query<{
    total: number; queued: number; running: number; waiting_approval: number; done: number; failed: number;
    errors: number; health: number; timeouts: number;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE j.status = 'queued')::int AS queued,
            count(*) FILTER (WHERE j.status = 'running')::int AS running,
            count(*) FILTER (WHERE j.status = 'waiting_approval')::int AS waiting_approval,
            count(*) FILTER (WHERE j.status = 'done')::int AS done,
            count(*) FILTER (WHERE j.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE j.type = 'error')::int AS errors,
            count(*) FILTER (WHERE j.type = 'health')::int AS health,
            count(*) FILTER (WHERE j.status = 'failed' AND j.last_error LIKE '%타임아웃%')::int AS timeouts
       FROM jobs j JOIN projects p ON p.id = j.project_id LEFT JOIN reports r ON r.job_id = j.id
      WHERE ${f.where}`,
    f.params,
  );
  return r.rows[0]!;
}

export async function queueState() {
  const r = await db().query<{ queued: number; oldest: Date | null }>(
    `SELECT count(*)::int AS queued, min(created_at) AS oldest FROM jobs WHERE status = 'queued'`,
  );
  return r.rows[0]!;
}

export interface ProjectRow {
  id: number;
  name: string;
  repo_url: string;
  repo_branch: string;
  daily_limit: number;
  debounce_seconds: number;
  active: boolean;
  used_today: number;
  last_job_at: Date | null;
  health_status: JobStatus | null;
  health_severity: string | null;
  health_summary: string | null;
  health_at: Date | null;
  health_job_id: number | null;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const r = await db().query<ProjectRow>(
    `SELECT p.id, p.name, p.repo_url, p.repo_branch, p.daily_limit, p.debounce_seconds, p.active,
            (SELECT count(*)::int FROM jobs j
              WHERE j.project_id = p.id AND j.type = 'error' AND j.created_at >= ${KST_TODAY_START}) AS used_today,
            (SELECT max(created_at) FROM jobs j WHERE j.project_id = p.id) AS last_job_at,
            h.status AS health_status, h.severity AS health_severity, h.summary AS health_summary,
            h.created_at AS health_at, h.id AS health_job_id
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT j.id, j.status, j.created_at, r.severity, r.summary
           FROM jobs j LEFT JOIN reports r ON r.job_id = j.id
          WHERE j.project_id = p.id AND j.type = 'health'
          ORDER BY j.created_at DESC LIMIT 1) h ON true
      ORDER BY p.active DESC, p.name`,
  );
  return r.rows;
}

export interface JobDetail extends JobRow {
  error_hash: string | null;
  attempts: number;
  payload: { logs?: string; occurred_at?: string };
  body: { causes?: string[]; evidence?: string; actions?: string[] } | null;
  cost_usd: string | null;
  report_at: Date | null;
}

export async function getJob(id: number): Promise<JobDetail | null> {
  const r = await db().query<JobDetail>(
    `SELECT j.id, p.name AS project, j.type, j.severity, j.status, j.error_hash, j.attempts, j.payload,
            j.last_error, j.created_at, j.started_at, j.finished_at,
            r.summary, r.severity AS report_severity, r.body, r.cost_usd, r.created_at AS report_at
       FROM jobs j JOIN projects p ON p.id = j.project_id LEFT JOIN reports r ON r.job_id = j.id
      WHERE j.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export interface NotificationRow {
  id: number;
  job_id: number | null;
  project: string | null;
  channel: string;
  kind: string;
  sent_at: Date;
}

export async function listNotifications(jobId?: number): Promise<NotificationRow[]> {
  const r = await db().query<NotificationRow>(
    `SELECT n.id, n.job_id, p.name AS project, n.channel, n.kind, n.sent_at
       FROM notifications n LEFT JOIN jobs j ON j.id = n.job_id LEFT JOIN projects p ON p.id = j.project_id
      ${jobId === undefined ? '' : 'WHERE n.job_id = $1'}
      ORDER BY n.sent_at DESC LIMIT 100`,
    jobId === undefined ? [] : [jobId],
  );
  return r.rows;
}
