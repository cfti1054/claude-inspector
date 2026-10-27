import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { claudeArgs, claudeAuth, claudeEnv } from '../src/worker/claude.js';
import { isUsageLimitMessage, parseCliOutput, UsageLimitError } from '../src/worker/report.js';
import { stripClaudeConfig } from '../src/worker/repo.js';

test('API 키가 있으면 API 키를, 없으면 구독 토큰을 쓴다', () => {
  assert.deepEqual(claudeAuth({ ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't' }), { kind: 'api-key', value: 'k' });
  assert.deepEqual(claudeAuth({ CLAUDE_CODE_OAUTH_TOKEN: 't' }), { kind: 'subscription', value: 't' });
  assert.throws(() => claudeAuth({}), /ANTHROPIC_API_KEY 또는 CLAUDE_CODE_OAUTH_TOKEN/);
});

test('API 키 모드는 --bare, 구독 모드는 사용자 설정만 읽는다', () => {
  const api = claudeArgs({ kind: 'api-key', value: 'k' });
  assert.ok(api.includes('--bare'));
  assert.ok(!api.includes('--setting-sources'));

  const sub = claudeArgs({ kind: 'subscription', value: 't' });
  assert.ok(!sub.includes('--bare'));
  assert.equal(sub[sub.indexOf('--setting-sources') + 1], 'user');
  for (const flag of ['--strict-mcp-config', '--permission-mode', '--json-schema', '--max-budget-usd']) assert.ok(sub.includes(flag), flag);
});

test('자식 프로세스에는 인증 정보 하나만 넘기고 다른 비밀은 넘기지 않는다', () => {
  const base = { PATH: '/bin', HOME: '/home/node', DATABASE_URL: 'postgres://x', GITHUB_TOKEN: 'g', ANTHROPIC_API_KEY: 'k' };
  const sub = claudeEnv({ kind: 'subscription', value: 't' }, base);
  assert.equal(sub.CLAUDE_CODE_OAUTH_TOKEN, 't');
  assert.equal(sub.ANTHROPIC_API_KEY, undefined);
  assert.equal(sub.DATABASE_URL, undefined);
  assert.equal(sub.GITHUB_TOKEN, undefined);
  assert.equal(sub.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');

  const api = claudeEnv({ kind: 'api-key', value: 'k' }, base);
  assert.equal(api.ANTHROPIC_API_KEY, 'k');
  assert.equal(api.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test('사용 한도 계열 오류를 구분한다', () => {
  assert.equal(isUsageLimitMessage('Claude usage limit reached. Your limit will reset at 5pm'), true);
  assert.equal(isUsageLimitMessage('API Error: 429 rate_limit_error'), true);
  assert.equal(isUsageLimitMessage('API Error: 529 Overloaded'), true);
  assert.equal(isUsageLimitMessage('Invalid API key'), false);
  assert.throws(() => parseCliOutput(JSON.stringify({ is_error: true, result: 'Claude usage limit reached' })), UsageLimitError);
  assert.throws(
    () => parseCliOutput(JSON.stringify({ is_error: true, result: 'Invalid API key' })),
    (err: unknown) => err instanceof Error && !(err instanceof UsageLimitError),
  );
});

test('clone한 저장소에서 Claude 설정 파일만 지운다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'strip-'));
  try {
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    await writeFile(path.join(dir, '.claude', 'settings.json'), '{"hooks":{}}');
    await writeFile(path.join(dir, 'CLAUDE.md'), '지시');
    await writeFile(path.join(dir, '.mcp.json'), '{}');
    await mkdir(path.join(dir, 'src', 'sub'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'sub', 'CLAUDE.local.md'), '지시');
    await writeFile(path.join(dir, 'src', 'app.ts'), 'code');
    await mkdir(path.join(dir, '.git'), { recursive: true });
    await writeFile(path.join(dir, '.git', 'CLAUDE.md'), 'git 내부는 건드리지 않음');

    const removed = await stripClaudeConfig(dir);
    assert.ok(removed.includes('.claude'));
    assert.ok(removed.includes('CLAUDE.md'));
    assert.ok(removed.includes('.mcp.json'));
    assert.ok(removed.includes(path.join('src', 'sub', 'CLAUDE.local.md')));

    assert.deepEqual((await readdir(dir)).sort(), ['.git', 'src']);
    assert.deepEqual(await readdir(path.join(dir, 'src', 'sub')), []);
    assert.deepEqual(await readdir(path.join(dir, '.git')), ['CLAUDE.md']);
    assert.deepEqual((await readdir(path.join(dir, 'src'))).sort(), ['app.ts', 'sub']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
