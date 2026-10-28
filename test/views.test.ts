import assert from 'node:assert/strict';
import { test } from 'node:test';
import { html } from '../src/dashboard/html.js';
import type { JobDetail, JobRow, ProjectRow } from '../src/dashboard/queries.js';
import { jobPage, jobsPage } from '../src/dashboard/views.js';

test('html``은 보간 값을 이스케이프한다', () => {
  const evil = '<script>alert(1)</script>';
  assert.equal(html`<p>${evil}</p>`.value, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(html`<a title="${'"x"'}">`.value, '<a title="&quot;x&quot;">');
  assert.equal(html`<i>${html`<b>ok</b>`}</i>`.value, '<i><b>ok</b></i>');
});

const now = new Date();
const row: JobRow = {
  id: 1044, project: 'my-project-a', type: 'error', severity: 'critical', status: 'done',
  summary: '<img src=x onerror=alert(1)> DB 연결 풀 고갈', report_severity: 'critical', last_error: null,
  created_at: now, started_at: now, finished_at: new Date(now.getTime() + 161_000),
};
const project: ProjectRow = {
  id: 1, name: 'my-project-a', repo_url: 'https://github.com/o/r', repo_branch: 'main', daily_limit: 10,
  debounce_seconds: 3600, active: true, used_today: 8, last_job_at: now,
  health_status: 'done', health_severity: 'ok', health_summary: '정기 점검 이상 없음', health_at: now, health_job_id: 1043,
};

test('작업 목록은 리포트 요약을 이스케이프하고 한도 임박을 표시한다', () => {
  const out = jobsPage({
    range: 'today', q: '', status: 'all', page: 1, rows: [row], hasMore: false,
    counts: { total: 1, queued: 0, running: 0, waiting_approval: 0, done: 1, failed: 0, errors: 1, health: 0, timeouts: 0 },
    queue: { queued: 0, oldest: null }, projects: [project],
  });
  assert.doesNotMatch(out, /<img src=x/);
  assert.match(out, /&lt;img src=x/);
  assert.match(out, /J-1044/);
  assert.match(out, /한도 임박/);
  assert.doesNotMatch(out, /http-equiv="refresh"/); // 진행 중인 작업이 없으면 새로고침하지 않는다
});

test('작업 상세는 진행 중이면 자동 새로고침하고 로그를 이스케이프한다', () => {
  const detail: JobDetail = {
    ...row, status: 'running', summary: null, report_severity: null, finished_at: null,
    error_hash: 'a3f9c1', attempts: 1, payload: { logs: '</pre><script>x</script>', occurred_at: now.toISOString() },
    body: null, cost_usd: null, report_at: null,
  };
  const out = jobPage(detail, [], [
    { model: 'claude-sonnet-5-5', inputTokens: 1200, outputTokens: 340, cacheReadTokens: 5000, cacheCreationTokens: 800, costUsd: 0.04 },
  ]);
  assert.match(out, /7,000 \/ 340/); // 입력은 캐시 읽기·생성을 포함한 합계
  assert.match(out, /claude-sonnet-5-5/);
  assert.match(out, /http-equiv="refresh" content="10"/);
  assert.doesNotMatch(out, /<script>x<\/script>/);
  assert.match(out, /분석을 마치면/);
});
