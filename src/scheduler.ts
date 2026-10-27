// Railway Cron으로 하루 한 번 실행되는 일회성 프로세스. 중앙 API의 /health-check를 호출하고 종료한다.
import { required } from './config.js';

async function main(): Promise<void> {
  const apiUrl = required('API_URL').replace(/\/$/, '');
  const res = await fetch(`${apiUrl}/health-check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${required('SCHEDULER_TOKEN')}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`/health-check ${res.status}: ${text}`);
  console.log(`[scheduler] ${res.status} ${text}`);
}

main().catch((err) => {
  console.error('[scheduler]', err instanceof Error ? err.message : err);
  process.exit(1);
});
