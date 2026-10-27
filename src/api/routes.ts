import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config, required } from '../config.js';
import { db } from '../db.js';
import { enqueueError, enqueueHealthChecks, findProjectByTokenHash, jobLabel, type Project } from '../jobs.js';
import { mask } from '../mask.js';
import { bearerToken, hashToken, safeEqual } from '../security.js';
import { listProjects } from '../dashboard/queries.js';
import { isLoggedIn } from '../dashboard/routes.js';

const inspectSchema = z.object({
  project: z.string().min(1).max(64),
  type: z.literal('error'),
  severity: z.enum(['critical', 'error', 'warning']),
  error_hash: z.string().min(1).max(128),
  logs: z.string(),
  occurred_at: z.iso.datetime({ offset: true }),
});

async function projectFromRequest(req: FastifyRequest, reply: FastifyReply): Promise<Project | null> {
  const token = bearerToken(req.headers.authorization);
  const project = token ? await findProjectByTokenHash(hashToken(token)) : null;
  if (!project) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return project;
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => {
    await db().query('SELECT 1');
    return { ok: true };
  });

  app.post('/inspect', async (req, reply) => {
    const project = await projectFromRequest(req, reply);
    if (!project) return;

    const parsed = inspectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const body = parsed.data;
    if (body.project !== project.name || !project.active) {
      return reply.code(403).send({ error: 'forbidden', message: '토큰의 프로젝트와 요청 대상이 다르거나 비활성 프로젝트입니다' });
    }
    if (Buffer.byteLength(body.logs, 'utf8') > config.logsMaxBytes) {
      return reply.code(413).send({ error: 'logs_too_large', max_bytes: config.logsMaxBytes });
    }

    const result = await enqueueError(project, {
      severity: body.severity,
      errorHash: body.error_hash,
      logs: mask(body.logs),
      occurredAt: body.occurred_at,
    });
    switch (result.kind) {
      case 'created':
        return reply.code(202).send({ job_id: result.jobId, job: jobLabel(result.jobId), status: 'queued' });
      case 'debounced':
        return reply.code(409).send({ error: 'debounced', job_id: result.jobId, message: '같은 error_hash가 디바운스 시간 내에 이미 등록되었습니다' });
      case 'limited':
        return reply.code(429).send({ error: 'daily_limit_exceeded', limit: result.limit });
    }
  });

  app.post('/health-check', async (req, reply) => {
    const token = bearerToken(req.headers.authorization);
    if (!token || !safeEqual(token, required('SCHEDULER_TOKEN'))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const created = await enqueueHealthChecks();
    return reply.code(202).send({ created: created.length, jobs: created.map((c) => ({ project: c.project, job_id: c.jobId })) });
  });

  app.get<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
    const project = await projectFromRequest(req, reply);
    if (!project) return;
    const id = Number(req.params.id.replace(/^J-/i, ''));
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(404).send({ error: 'not_found' });

    // 다른 프로젝트의 작업은 존재 여부도 알리지 않는다
    const r = await db().query(
      `SELECT j.id, j.type, j.status, j.severity, j.error_hash, j.attempts, j.created_at, j.started_at, j.finished_at,
              r.severity AS report_severity, r.summary, r.body
         FROM jobs j LEFT JOIN reports r ON r.job_id = j.id
        WHERE j.id = $1 AND j.project_id = $2`,
      [id, project.id],
    );
    const row = r.rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return {
      job_id: row.id,
      job: jobLabel(row.id),
      type: row.type,
      status: row.status,
      severity: row.severity,
      error_hash: row.error_hash,
      attempts: row.attempts,
      created_at: row.created_at,
      started_at: row.started_at,
      finished_at: row.finished_at,
      report: row.summary ? { severity: row.report_severity, summary: row.summary, ...row.body } : null,
    };
  });

  // 관리자 전용: 대시보드 로그인 세션이 있어야 한다
  app.get('/projects', async (req, reply) => {
    if (!isLoggedIn(req)) return reply.code(401).send({ error: 'unauthorized' });
    const projects = await listProjects();
    return projects.map((p) => ({
      name: p.name,
      repo_url: p.repo_url,
      repo_branch: p.repo_branch,
      active: p.active,
      daily_limit: p.daily_limit,
      used_today: p.used_today,
      debounce_seconds: p.debounce_seconds,
      last_job_at: p.last_job_at,
      last_health: p.health_job_id
        ? { job_id: p.health_job_id, status: p.health_status, severity: p.health_severity, summary: p.health_summary, at: p.health_at }
        : null,
    }));
  });
}
