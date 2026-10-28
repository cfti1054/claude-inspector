import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { dashboardRoutes } from '../dashboard/routes.js';
import { apiRoutes } from './routes.js';
import { usageRoutes } from './usage-routes.js';

const CSP = [
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  'font-src https://cdn.jsdelivr.net https://fonts.gstatic.com',
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Railway 프록시 뒤에서 실제 클라이언트 IP를 쓴다
    trustProxy: true,
    // logs 상한보다 조금 크게 잡아 본문 전체가 너무 크면 413으로 끊는다
    bodyLimit: config.logsMaxBytes + 16 * 1024,
  });

  // 로그인 폼(application/x-www-form-urlencoded)을 의존성 없이 처리한다
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      reply.header('Content-Security-Policy', CSP);
    }
  });

  app.register(apiRoutes);
  // 별도 플러그인으로 등록해 인증 훅이 /usage 경로에만 적용되게 한다
  app.register(usageRoutes);
  app.register(dashboardRoutes);
  return app;
}
