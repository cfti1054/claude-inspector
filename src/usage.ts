// Claude 사용량 기록과 조회. 기록은 워커가, 조회는 /usage API(외부 사용량 집계용)가 쓴다.
import { db } from './db.js';
import type { JobType } from './jobs.js';
import { TZ } from './time.js';
import type { UsageEntry } from './worker/report.js';

export type UsageOutcome = 'done' | 'failed' | 'deferred';
export type AuthKind = 'api-key' | 'subscription';

export async function recordUsage(input: {
  jobId: number;
  projectId: number;
  jobType: JobType;
  attempt: number;
  outcome: UsageOutcome;
  authKind: AuthKind;
  entries: UsageEntry[];
}): Promise<void> {
  if (input.entries.length === 0) return;
  const values: unknown[] = [];
  const rows = input.entries.map((e) => {
    values.push(
      input.jobId, input.projectId, input.jobType, input.attempt, input.outcome, input.authKind,
      e.model, e.inputTokens, e.outputTokens, e.cacheReadTokens, e.cacheCreationTokens, e.costUsd,
    );
    const base = values.length - 12;
    return `(${Array.from({ length: 12 }, (_, i) => `$${base + i + 1}`).join(', ')})`;
  });
  await db().query(
    `INSERT INTO usage_records (job_id, project_id, job_type, attempt, outcome, auth_kind,
       model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd)
     VALUES ${rows.join(', ')}`,
    values,
  );
}

export interface UsageRecordRow {
  id: number;
  recorded_at: Date;
  job_id: number;
  project: string;
  job_type: JobType;
  attempt: number;
  outcome: UsageOutcome;
  auth_kind: AuthKind;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number | null;
}

// after_id보다 큰 기록을 id 순으로 돌려준다. 받는 쪽은 마지막 id를 저장해 두고 다음에 이어서 가져간다.
export async function listUsageRecords(opts: { afterId: number; since?: Date; limit: number }): Promise<UsageRecordRow[]> {
  const params: unknown[] = [opts.afterId];
  let where = 'u.id > $1';
  if (opts.since) {
    params.push(opts.since);
    where += ` AND u.recorded_at >= $${params.length}`;
  }
  params.push(opts.limit);
  const r = await db().query<UsageRecordRow>(
    `SELECT u.id, u.recorded_at, u.job_id, p.name AS project, u.job_type, u.attempt, u.outcome, u.auth_kind,
            u.model, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_creation_tokens,
            u.cost_usd::float8 AS cost_usd
       FROM usage_records u JOIN projects p ON p.id = u.project_id
      WHERE ${where}
      ORDER BY u.id
      LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

export type GroupBy = 'day' | 'project' | 'model';

export interface UsageTotals {
  runs: number;
  jobs: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
}

const totalsSql = `count(*)::int AS runs,
  count(DISTINCT u.job_id)::int AS jobs,
  coalesce(sum(u.input_tokens), 0)::bigint AS input_tokens,
  coalesce(sum(u.output_tokens), 0)::bigint AS output_tokens,
  coalesce(sum(u.cache_read_tokens), 0)::bigint AS cache_read_tokens,
  coalesce(sum(u.cache_creation_tokens), 0)::bigint AS cache_creation_tokens,
  coalesce(sum(u.cost_usd), 0)::float8 AS cost_usd`;

// 기간 [from, to)의 합계와 묶음별 합계. day는 KST 날짜(YYYY-MM-DD)로 묶는다.
export async function summarizeUsage(from: Date, to: Date, groupBy: GroupBy): Promise<{ totals: UsageTotals; groups: Array<UsageTotals & { key: string }> }> {
  const key =
    groupBy === 'day'
      ? `to_char(u.recorded_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`
      : groupBy === 'project'
        ? 'p.name'
        : 'u.model';
  const from_ = `FROM usage_records u JOIN projects p ON p.id = u.project_id WHERE u.recorded_at >= $1 AND u.recorded_at < $2`;
  const [totals, groups] = await Promise.all([
    db().query<UsageTotals>(`SELECT ${totalsSql} ${from_}`, [from, to]),
    db().query<UsageTotals & { key: string }>(`SELECT ${key} AS key, ${totalsSql} ${from_} GROUP BY 1 ORDER BY 1`, [from, to]),
  ]);
  return { totals: totals.rows[0]!, groups: groups.rows };
}

export async function usageForJob(jobId: number): Promise<UsageEntry[]> {
  const r = await db().query<{ model: string; i: number; o: number; cr: number; cc: number; cost: number | null }>(
    `SELECT model, sum(input_tokens)::bigint AS i, sum(output_tokens)::bigint AS o,
            sum(cache_read_tokens)::bigint AS cr, sum(cache_creation_tokens)::bigint AS cc, sum(cost_usd)::float8 AS cost
       FROM usage_records WHERE job_id = $1 GROUP BY model ORDER BY model`,
    [jobId],
  );
  return r.rows.map((x) => ({ model: x.model, inputTokens: x.i, outputTokens: x.o, cacheReadTokens: x.cr, cacheCreationTokens: x.cc, costUsd: x.cost }));
}
