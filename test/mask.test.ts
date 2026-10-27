import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mask } from '../src/mask.js';

test('Authorization 헤더와 Bearer 토큰을 가린다', () => {
  assert.equal(mask('Authorization: Bearer abc.def.ghi123'), 'Authorization: Bearer [MASKED]');
  assert.equal(mask('sent bearer AbCdEf1234567890'), 'sent Bearer [MASKED]');
});

test('key=value 형태의 비밀 값을 가린다', () => {
  assert.equal(mask('password=hunter2 user=kim'), 'password=[MASKED] user=kim');
  assert.equal(mask('{"api_key": "xyz123"}'), '{"api_key": "[MASKED]"}');
  assert.equal(mask('DB_TOKEN: abcd'), 'DB_TOKEN: [MASKED]');
  assert.equal(mask('GITHUB_TOKEN=abcd x'), 'GITHUB_TOKEN=[MASKED] x');
  assert.equal(mask('client_secret=abcd'), 'client_secret=[MASKED]');
  assert.equal(mask('session_id=42'), 'session_id=[MASKED]');
});

test('접속 문자열의 비밀번호를 가린다', () => {
  assert.equal(mask('postgres://app:s3cret@db.internal:5432/x'), 'postgres://app:[MASKED]@db.internal:5432/x');
});

test('알려진 키 형식을 가린다', () => {
  assert.equal(mask('key sk-ant-api03-abcdefghijklmnop'), 'key [MASKED]');
  assert.equal(mask('ghp_abcdefghijklmnopqrstuvwxyz0123'), '[MASKED]');
  assert.equal(mask('jwt eyJhbGciOiJI.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4'), 'jwt [MASKED]');
});

test('개인정보를 가린다', () => {
  assert.equal(mask('user kim@example.com failed'), 'user [MASKED] failed');
  assert.equal(mask('rrn 900101-1234567'), 'rrn [MASKED]');
  assert.equal(mask('tel 010-1234-5678'), 'tel [MASKED]');
  assert.equal(mask('card 4111 1111 1111 1111'), 'card [MASKED]');
});

test('일반 로그는 그대로 둔다', () => {
  const line = '2026-10-27T15:18:02+09:00 ERROR pool timeout: no free connection (max=10) GET /api/orders 500';
  assert.equal(mask(line), line);
});
