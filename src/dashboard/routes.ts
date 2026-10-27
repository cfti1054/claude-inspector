import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { required } from '../config.js';
import { safeEqual, signSession, verifySession } from '../security.js';
import { getJob, jobCounts, listJobs, listNotifications, listProjects, queueState, type Range, type StatusFilter } from './queries.js';
import { css } from './styles.js';
import { jobPage, jobsPage, loginPage, notificationsPage, projectsPage } from './views.js';

const COOKIE = 'inspector_session';
const SESSION_TTL = 60 * 60 * 12;

const ranges: Range[] = ['today', '7d', '30d'];
const statuses: StatusFilter[] = ['all', 'queued', 'running', 'waiting_approval', 'done', 'failed'];

function cookies(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isLoggedIn(req: FastifyRequest): boolean {
  return verifySession(required('SESSION_SECRET'), cookies(req)[COOKIE]);
}

function sendHtml(reply: FastifyReply, body: string, code = 200): FastifyReply {
  return reply.code(code).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(body);
}

// 로그인 실패를 IP별로 세어 무차별 대입을 늦춘다 (15분에 10회)
const failures = new Map<string, { count: number; until: number }>();
function tooManyFailures(ip: string): boolean {
  const f = failures.get(ip);
  return !!f && f.count >= 10 && f.until > Date.now();
}
function recordFailure(ip: string): void {
  const f = failures.get(ip);
  const now = Date.now();
  if (!f || f.until < now) failures.set(ip, { count: 1, until: now + 15 * 60_000 });
  else f.count += 1;
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/static/app.css', async (_req, reply) =>
    reply.type('text/css; charset=utf-8').header('Cache-Control', 'public, max-age=300').send(css),
  );

  app.get('/', async (_req, reply) => reply.redirect('/dashboard'));

  app.get('/login', async (req, reply) => {
    if (isLoggedIn(req)) return reply.redirect('/dashboard');
    return sendHtml(reply, loginPage());
  });

  app.post<{ Body: { password?: string } }>('/login', async (req, reply) => {
    if (tooManyFailures(req.ip)) return sendHtml(reply, loginPage('시도 횟수가 많습니다. 15분 뒤에 다시 시도하세요.'), 429);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!safeEqual(password, required('DASHBOARD_PASSWORD'))) {
      recordFailure(req.ip);
      return sendHtml(reply, loginPage('비밀번호가 올바르지 않습니다.'), 401);
    }
    failures.delete(req.ip);
    const value = signSession(required('SESSION_SECRET'), SESSION_TTL);
    reply.header('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`);
    return reply.redirect('/dashboard', 303);
  });

  app.post('/logout', async (_req, reply) => {
    reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return reply.redirect('/login', 303);
  });

  // 이하 /dashboard 경로는 로그인이 필요하다
  app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      if (!isLoggedIn(req)) return reply.redirect('/login');
    });

    scope.get<{ Querystring: { range?: string; q?: string; status?: string; page?: string } }>('/dashboard', async (req, reply) => {
      const range = ranges.includes(req.query.range as Range) ? (req.query.range as Range) : 'today';
      const status = statuses.includes(req.query.status as StatusFilter) ? (req.query.status as StatusFilter) : 'all';
      const q = (req.query.q ?? '').slice(0, 100);
      const pageNo = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
      const [list, counts, queue, projects] = await Promise.all([
        listJobs(range, q, status, pageNo),
        jobCounts(range, q),
        queueState(),
        listProjects(),
      ]);
      return sendHtml(reply, jobsPage({ range, q, status, page: pageNo, rows: list.rows, hasMore: list.hasMore, counts, queue, projects }));
    });

    scope.get<{ Params: { id: string } }>('/dashboard/jobs/:id', async (req, reply) => {
      const id = Number(req.params.id);
      const job = Number.isSafeInteger(id) && id > 0 ? await getJob(id) : null;
      if (!job) return sendHtml(reply, '<!doctype html><meta charset="utf-8"><p>작업을 찾을 수 없습니다. <a href="/dashboard">목록으로</a></p>', 404);
      return sendHtml(reply, jobPage(job, await listNotifications(id)));
    });

    scope.get('/dashboard/projects', async (_req, reply) => sendHtml(reply, projectsPage(await listProjects())));

    scope.get('/dashboard/notifications', async (_req, reply) => sendHtml(reply, notificationsPage(await listNotifications())));
  });
}
