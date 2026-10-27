import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearerToken, hashToken, newProjectToken, safeEqual, signSession, verifySession } from '../src/security.js';

const secret = 'x'.repeat(32);

test('세션 쿠키는 서명이 맞고 만료 전일 때만 유효하다', () => {
  const now = Date.UTC(2026, 9, 27);
  const v = signSession(secret, 60, now);
  assert.equal(verifySession(secret, v, now), true);
  assert.equal(verifySession(secret, v, now + 61_000), false);
  assert.equal(verifySession('y'.repeat(32), v, now), false);
  const [exp, sig] = v.split('.');
  assert.equal(verifySession(secret, `${Number(exp) + 1000}.${sig}`, now), false);
  assert.equal(verifySession(secret, undefined, now), false);
  assert.equal(verifySession(secret, 'garbage', now), false);
});

test('Bearer 헤더에서 토큰을 꺼낸다', () => {
  assert.equal(bearerToken('Bearer abc'), 'abc');
  assert.equal(bearerToken('bearer abc'), 'abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(undefined), null);
});

test('프로젝트 토큰은 매번 다르고 해시는 결정적이다', () => {
  const a = newProjectToken();
  assert.match(a, /^ci_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, newProjectToken());
  assert.equal(hashToken(a), hashToken(a));
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
