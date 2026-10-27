// DB 없이 확인할 수 있는 인증·검증 경로만 다룬다. DB가 필요한 경로는 README의 수동 점검 절차로 확인한다.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.SCHEDULER_TOKEN = 'scheduler-test-token';
process.env.DASHBOARD_PASSWORD = 'pw-test';
process.env.SESSION_SECRET = 's'.repeat(32);
process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance;

before(async () => {
  const { buildApp } = await import('../src/api/app.js');
  app = buildApp();
  await app.ready();
});
after(() => app.close());

test('/inspect는 토큰이 없으면 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/inspect', payload: {} });
  assert.equal(res.statusCode, 401);
});

test('/health-check는 스케줄러 토큰이 틀리면 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/health-check', headers: { authorization: 'Bearer wrong' }, payload: {} });
  assert.equal(res.statusCode, 401);
});

test('/projects는 로그인 세션이 없으면 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/projects' });
  assert.equal(res.statusCode, 401);
});

test('대시보드는 로그인하지 않으면 /login으로 보낸다', async () => {
  const res = await app.inject({ method: 'GET', url: '/dashboard' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/login');
});

test('로그인 화면은 CSP와 함께 렌더링된다', async () => {
  const res = await app.inject({ method: 'GET', url: '/login' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /관리자 비밀번호/);
  assert.match(String(res.headers['content-security-policy']), /default-src 'none'/);
});

test('비밀번호가 맞으면 세션 쿠키를 발급하고, 틀리면 401', async () => {
  const bad = await app.inject({ method: 'POST', url: '/login', payload: 'password=nope', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(bad.statusCode, 401);

  const ok = await app.inject({ method: 'POST', url: '/login', payload: 'password=pw-test', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(ok.statusCode, 303);
  const cookie = String(ok.headers['set-cookie']);
  assert.match(cookie, /inspector_session=\d+\.[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax/);

  const loginAgain = await app.inject({ method: 'GET', url: '/login', headers: { cookie: cookie.split(';')[0]! } });
  assert.equal(loginAgain.statusCode, 302);
  assert.equal(loginAgain.headers.location, '/dashboard');
});

test('스타일시트를 제공한다', async () => {
  const res = await app.inject({ method: 'GET', url: '/static/app.css' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/css/);
});
