// 환경변수를 한곳에서 읽는다. 필수 값은 해당 프로세스가 실제로 쓸 때 required()로 확인한다.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const config = {
  port: num('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',

  // /inspect 요청 제한
  logsMaxBytes: num('LOGS_MAX_BYTES', 64 * 1024),
  defaultDailyLimit: num('DEFAULT_DAILY_LIMIT', 20),
  defaultDebounceSeconds: num('DEFAULT_DEBOUNCE_SECONDS', 3600),

  // 워커
  workerConcurrency: Math.min(Math.max(num('WORKER_CONCURRENCY', 1), 1), 2),
  jobTimeoutMs: num('JOB_TIMEOUT_SECONDS', 600) * 1000,
  maxAttempts: num('JOB_MAX_ATTEMPTS', 2),
  pollIntervalMs: num('WORKER_POLL_SECONDS', 5) * 1000,
  claudeBin: process.env.CLAUDE_BIN ?? 'claude',
  claudeModel: process.env.CLAUDE_MODEL ?? '',
  claudeMaxBudgetUsd: num('CLAUDE_MAX_BUDGET_USD', 1),
  queueAlertMinutes: num('QUEUE_ALERT_MINUTES', 10),

  // Discord 웹훅 (비어 있으면 알림을 건너뛴다)
  discordWebhookAlerts: process.env.DISCORD_WEBHOOK_ALERTS ?? '',
  discordWebhookDaily: process.env.DISCORD_WEBHOOK_DAILY ?? '',
  dashboardUrl: (process.env.DASHBOARD_URL ?? '').replace(/\/$/, ''),
} as const;
