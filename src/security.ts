import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// 프로젝트 토큰은 무작위 32바이트라 느린 해시 없이 SHA-256으로 충분하다
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newProjectToken(): string {
  return 'ci_' + randomBytes(32).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1] ?? null;
}

// 대시보드 세션: "만료시각.서명" 형태의 HMAC 서명 쿠키
export function signSession(secret: string, ttlSeconds: number, now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + ttlSeconds);
  const sig = createHmac('sha256', secret).update(exp).digest('base64url');
  return `${exp}.${sig}`;
}

export function verifySession(secret: string, value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expected = createHmac('sha256', secret).update(exp).digest('base64url');
  if (!safeEqual(sig, expected)) return false;
  return Number(exp) * 1000 > now;
}
