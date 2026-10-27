import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config.js';
import { closeDb, db } from '../db.js';
import { claimJob, completeJob, deferJob, failJob, jobLabel, oldestQueuedAgeMinutes, recoverStaleJobs, type Job, type Project } from '../jobs.js';
import { mask } from '../mask.js';
import { clip, colors, jobUrl, notify } from '../notify/discord.js';
import { kstDate, KST_TODAY_START } from '../time.js';
import { claudeAuth, runClaude } from './claude.js';
import { buildPrompt, UsageLimitError, type Report } from './report.js';
import { prepareRepo } from './repo.js';

let stopping = false;

async function processJob(job: Job & { project: Project }): Promise<void> {
  const label = jobLabel(job.id);
  console.log(`[worker] ${label} 시작 (${job.project.name}, ${job.type}, 시도 ${job.attempts})`);
  let repo: Awaited<ReturnType<typeof prepareRepo>> | undefined;
  try {
    repo = await prepareRepo(job.project.repo_url, job.project.repo_branch, process.env.GITHUB_TOKEN ?? '');
    const prompt = buildPrompt({
      type: job.type,
      project: job.project.name,
      severity: job.severity,
      occurredAt: job.payload.occurred_at,
      logs: job.payload.logs,
    });
    const { report, costUsd } = await runClaude(repo.dir, prompt);
    // 결과에 비밀 값이 섞여 나오는 경우를 대비해 저장 전에 마스킹한다
    const safe: Report = {
      ...report,
      summary: mask(report.summary),
      causes: report.causes.map(mask),
      evidence: mask(report.evidence),
      actions: report.actions.map(mask),
    };
    await completeJob(job.id, { severity: safe.severity, summary: safe.summary, body: safe, costUsd });
    console.log(`[worker] ${label} 완료 (${safe.severity})`);
    await notifyDone(job, safe);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UsageLimitError) {
      // 한도가 풀릴 때까지 미룬다. 정기 점검도 아직 끝나지 않았으므로 일일 요약은 보내지 않는다.
      await deferJob(job.id, `사용 한도로 ${config.usageLimitBackoffMinutes}분 뒤 재시도: ${message}`, config.usageLimitBackoffMinutes);
      console.warn(`[worker] ${label} 사용 한도로 ${config.usageLimitBackoffMinutes}분 연기: ${message}`);
      await notifyUsageLimit(message);
      return; // clone 정리는 finally에서 한다
    }
    const final = await failJob(job.id, message, config.maxAttempts);
    console.error(`[worker] ${label} 실패${final ? ' (확정)' : ' (재시도 예정)'}: ${message}`);
    if (final) await notifyFailed(job, message);
  } finally {
    await repo?.cleanup();
  }
  if (job.type === 'health') await maybeSendDailySummary();
}

async function notifyDone(job: Job & { project: Project }, report: Report): Promise<void> {
  // #alerts에는 critical만 즉시 보낸다. 나머지는 일일 요약에 포함된다.
  if (report.severity !== 'critical') return;
  await safeNotify(() =>
    notify(
      'alerts',
      'job_critical',
      {
        title: `🔴 ${job.project.name} · ${report.summary}`,
        url: jobUrl(job.id),
        color: colors.critical,
        description: report.causes.length ? clip(report.causes.map((c) => `• ${c}`).join('\n'), 1500) : undefined,
        fields: [
          { name: '작업', value: jobLabel(job.id), inline: true },
          { name: '유형', value: job.type === 'error' ? '오류 분석' : '정기 점검', inline: true },
          ...(report.actions.length
            ? [{ name: '권장 조치', value: clip(report.actions.map((a, i) => `${i + 1}. ${a}`).join('\n'), 1000) }]
            : []),
        ],
      },
      { jobId: job.id },
    ),
  );
}

async function notifyFailed(job: Job & { project: Project }, message: string): Promise<void> {
  await safeNotify(() =>
    notify(
      'alerts',
      'job_failed',
      {
        title: `⚠️ ${job.project.name} · ${jobLabel(job.id)} 점검 실패`,
        url: jobUrl(job.id),
        color: colors.warning,
        description: clip(mask(message), 1500),
      },
      { jobId: job.id },
    ),
  );
}

// 사용 한도 도달은 시간당 한 번만 알린다
async function notifyUsageLimit(message: string): Promise<void> {
  const hourKey = new Date().toISOString().slice(0, 13);
  await safeNotify(() =>
    notify(
      'alerts',
      'usage_limit',
      {
        title: `⏸️ Claude 사용 한도 도달: 작업을 ${config.usageLimitBackoffMinutes}분 뒤로 미룹니다`,
        color: colors.warning,
        description: clip(mask(message), 1000),
      },
      { dedupeKey: `usage-limit:${hourKey}` },
    ),
  );
}

// 오늘의 정기 점검이 모두 끝났으면 #daily-report에 요약을 한 번 보낸다
async function maybeSendDailySummary(): Promise<void> {
  const pending = await db().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM jobs
      WHERE type = 'health' AND status IN ('queued', 'running') AND created_at >= ${KST_TODAY_START}`,
  );
  if ((pending.rows[0]?.n ?? 0) > 0) return;

  const rows = await db().query<{ project: string; status: string; severity: string | null; summary: string | null }>(
    `SELECT p.name AS project, j.status, r.severity, r.summary
       FROM jobs j JOIN projects p ON p.id = j.project_id LEFT JOIN reports r ON r.job_id = j.id
      WHERE j.type = 'health' AND j.created_at >= ${KST_TODAY_START}
      ORDER BY p.name`,
  );
  if (!rows.rowCount) return;

  const errors = await db().query<{ total: number; failed: number; critical: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            count(*) FILTER (WHERE severity = 'critical')::int AS critical
       FROM jobs WHERE type = 'error' AND created_at >= now() - interval '24 hours'`,
  );
  const e = errors.rows[0]!;

  const icon = (s: string, sev: string | null) =>
    s === 'failed' ? '⚠️' : sev === 'ok' ? '🟢' : sev === 'critical' ? '🔴' : '🟡';
  const lines = rows.rows.map(
    (r) => `${icon(r.status, r.severity)} **${r.project}** — ${r.status === 'failed' ? '점검 실패' : clip(r.summary ?? '', 180)}`,
  );
  const allOk = rows.rows.every((r) => r.status === 'done' && r.severity === 'ok');

  const today = kstDate(new Date());
  await safeNotify(() =>
    notify(
      'daily-report',
      'daily_summary',
      {
        title: `📋 ${today} 정기 점검 요약`,
        url: config.dashboardUrl ? `${config.dashboardUrl}/dashboard` : undefined,
        color: allOk ? colors.ok : colors.warning,
        description: clip(lines.join('\n'), 3500),
        fields: [
          { name: '최근 24시간 오류 분석', value: `${e.total}건`, inline: true },
          { name: 'critical', value: `${e.critical}건`, inline: true },
          { name: '실패', value: `${e.failed}건`, inline: true },
        ],
      },
      { dedupeKey: `daily:${today}` },
    ),
  );
}

// 큐가 기준 시간 이상 밀리면 1시간에 한 번 #alerts로 알린다
async function checkQueueBacklog(): Promise<void> {
  const minutes = await oldestQueuedAgeMinutes();
  if (minutes < config.queueAlertMinutes) return;
  const hourKey = new Date().toISOString().slice(0, 13);
  await safeNotify(() =>
    notify(
      'alerts',
      'queue_backlog',
      {
        title: `⏳ 작업 큐 정체: 가장 오래된 작업이 ${minutes}분째 대기 중`,
        color: colors.warning,
        description: '워커 상태와 Claude 실행 시간을 확인하세요.',
      },
      { dedupeKey: `queue-backlog:${hourKey}` },
    ),
  );
}

async function safeNotify(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // 알림 실패가 작업 처리 결과를 바꾸지 않도록 기록만 한다
    console.error('[worker] 알림 실패:', err instanceof Error ? err.message : err);
  }
}

async function loop(slot: number): Promise<void> {
  while (!stopping) {
    try {
      const job = await claimJob();
      if (job) {
        await processJob(job);
        continue;
      }
    } catch (err) {
      console.error(`[worker:${slot}] 루프 오류:`, err);
    }
    await sleep(config.pollIntervalMs);
  }
}

async function housekeeping(): Promise<void> {
  while (!stopping) {
    try {
      const recovered = await recoverStaleJobs(config.jobTimeoutMs, config.maxAttempts);
      for (const j of recovered) console.warn(`[worker] ${jobLabel(j.id)} 회수 → ${j.status}`);
      await checkQueueBacklog();
    } catch (err) {
      console.error('[worker] 점검 루프 오류:', err);
    }
    await sleep(60_000);
  }
}

async function main(): Promise<void> {
  // 인증 정보가 없으면 작업을 꺼내기 전에 바로 실패한다
  const auth = claudeAuth();
  console.log(
    `[worker] 시작: 인증 ${auth.kind === 'api-key' ? 'API 키' : 'Claude 구독 토큰'}, 동시 실행 ${config.workerConcurrency}, 타임아웃 ${config.jobTimeoutMs / 1000}초`,
  );
  const shutdown = () => {
    console.log('[worker] 종료 신호 수신, 진행 중인 작업을 마친 뒤 종료합니다');
    stopping = true;
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const loops = Array.from({ length: config.workerConcurrency }, (_, i) => loop(i));
  // 종료 시에는 작업 루프만 기다린다 (점검 루프는 최대 60초 대기 중일 수 있음)
  void housekeeping();
  await Promise.all(loops);
  await closeDb();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
