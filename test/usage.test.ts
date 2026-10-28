import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { extractUsage } from '../src/worker/report.js';

test('modelUsage가 있으면 모델별로 나눠 읽는다', () => {
  const out = extractUsage(JSON.stringify({
    total_cost_usd: 0.05,
    usage: { input_tokens: 999 },
    modelUsage: {
      'claude-sonnet-5-5': { inputTokens: 1200, outputTokens: 340, cacheReadInputTokens: 5000, cacheCreationInputTokens: 800, costUSD: 0.042 },
      'claude-haiku-5-5': { inputTokens: 90, outputTokens: 12, costUSD: 0.001 },
    },
  }));
  assert.deepEqual(out, [
    { model: 'claude-sonnet-5-5', inputTokens: 1200, outputTokens: 340, cacheReadTokens: 5000, cacheCreationTokens: 800, costUsd: 0.042 },
    { model: 'claude-haiku-5-5', inputTokens: 90, outputTokens: 12, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.001 },
  ]);
});

test('modelUsage가 없으면 usage 합계를 대체 모델 이름으로 읽는다', () => {
  const out = extractUsage(
    JSON.stringify({ total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } }),
    'claude-sonnet-5-5',
  );
  assert.deepEqual(out, [{ model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheCreationTokens: 0, costUsd: 0.01 }]);
});

test('사용량이 없거나 형식이 다르면 빈 배열', () => {
  assert.deepEqual(extractUsage(''), []);
  assert.deepEqual(extractUsage('not json'), []);
  assert.deepEqual(extractUsage(JSON.stringify({ result: 'x' })), []);
  assert.deepEqual(extractUsage(JSON.stringify({ usage: { input_tokens: 0, output_tokens: 0 } })), []);
  assert.deepEqual(extractUsage(JSON.stringify({ modelUsage: { m: { inputTokens: 'x', outputTokens: -3 } } }))[0]?.inputTokens, 0);
});

// /usage API: DB 없이 확인할 수 있는 인증과 입력 검증만 다룬다
process.env.SCHEDULER_TOKEN = 'scheduler-test-token';
process.env.DASHBOARD_PASSWORD = 'pw-test';
process.env.SESSION_SECRET = 's'.repeat(32);
process.env.USAGE_API_TOKEN = 'usage-test-token';
process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance;
before(async () => {
  const { buildApp } = await import('../src/api/app.js');
  app = buildApp();
  await app.ready();
});
after(() => app.close());

const auth = { authorization: 'Bearer usage-test-token' };

test('/usage는 토큰이 없거나 틀리면 401', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/usage/records' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/usage/records', headers: { authorization: 'Bearer nope' } })).statusCode, 401);
  // 다른 토큰(스케줄러)으로도 열리지 않는다
  assert.equal((await app.inject({ method: 'GET', url: '/usage/summary', headers: { authorization: 'Bearer scheduler-test-token' } })).statusCode, 401);
});

test('/usage 입력이 잘못되면 DB를 조회하기 전에 400', async () => {
  const bad = [
    '/usage/records?limit=0',
    '/usage/records?limit=5000',
    '/usage/records?after_id=-1',
    '/usage/records?since=yesterday',
    '/usage/summary',
    '/usage/summary?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z&group_by=hour',
    '/usage/summary?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z',
    '/usage/summary?from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z',
  ];
  for (const url of bad) {
    const res = await app.inject({ method: 'GET', url, headers: auth });
    assert.equal(res.statusCode, 400, url);
  }
});

test('/usage 인증 훅은 다른 경로에 영향을 주지 않는다', async () => {
  const res = await app.inject({ method: 'GET', url: '/login' });
  assert.equal(res.statusCode, 200);
});
