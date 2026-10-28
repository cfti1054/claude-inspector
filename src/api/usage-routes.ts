// 외부 사용량 집계(AI Usage Hub 등)를 위한 읽기 전용 API. USAGE_API_TOKEN으로 보호한다.
// 형식은 docs/usage-api.md에 정리되어 있다.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { jobLabel } from '../jobs.js';
import { bearerToken, safeEqual } from '../security.js';
import { listUsageRecords, summarizeUsage } from '../usage.js';

const MAX_LIMIT = 1000;
const MAX_RANGE_DAYS = 400;

const recordsQuery = z.object({
  after_id: z.coerce.number().int().min(0).default(0),
  since: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(500),
});

const summaryQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  group_by: z.enum(['day', 'project', 'model']).default('day'),
});

function issues(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    if (!config.usageApiToken) return reply.code(503).send({ error: 'usage_api_disabled', message: 'USAGE_API_TOKEN이 설정되지 않았습니다' });
    const token = bearerToken(req.headers.authorization);
    if (!token || !safeEqual(token, config.usageApiToken)) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('Cache-Control', 'no-store');
  });

  app.get('/usage/records', async (req, reply) => {
    const q = recordsQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_request', issues: issues(q.error) });

    // 한 건을 더 읽어 다음 페이지가 있는지 판단한다
    const rows = await listUsageRecords({
      afterId: q.data.after_id,
      since: q.data.since ? new Date(q.data.since) : undefined,
      limit: q.data.limit + 1,
    });
    const page = rows.slice(0, q.data.limit);
    return {
      source: config.usageSourceName,
      records: page.map((r) => ({
        id: r.id,
        recorded_at: r.recorded_at.toISOString(),
        project: r.project,
        job_id: r.job_id,
        job: jobLabel(r.job_id),
        job_type: r.job_type,
        attempt: r.attempt,
        outcome: r.outcome,
        auth_kind: r.auth_kind,
        model: r.model,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cache_read_tokens: r.cache_read_tokens,
        cache_creation_tokens: r.cache_creation_tokens,
        cost_usd: r.cost_usd,
      })),
      next_after_id: page.length ? page[page.length - 1]!.id : q.data.after_id,
      has_more: rows.length > q.data.limit,
    };
  });

  app.get('/usage/summary', async (req, reply) => {
    const q = summaryQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_request', issues: issues(q.error) });
    const from = new Date(q.data.from);
    const to = new Date(q.data.to);
    if (to <= from) return reply.code(400).send({ error: 'invalid_range', message: 'to는 from보다 뒤여야 합니다' });
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      return reply.code(400).send({ error: 'range_too_large', max_days: MAX_RANGE_DAYS });
    }

    const { totals, groups } = await summarizeUsage(from, to, q.data.group_by);
    return {
      source: config.usageSourceName,
      from: from.toISOString(),
      to: to.toISOString(),
      group_by: q.data.group_by,
      timezone: q.data.group_by === 'day' ? 'Asia/Seoul' : undefined,
      totals,
      groups,
    };
  });
}
