import { config } from '../config.js';
import { db } from '../db.js';

export type Channel = 'alerts' | 'daily-report';

export interface Embed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export const colors = {
  critical: 0x8f1d21,
  error: 0xc2410c,
  warning: 0xb7791f,
  ok: 0x1f5e52,
  info: 0x3f4854,
} as const;

function webhookFor(channel: Channel): string {
  return channel === 'alerts' ? config.discordWebhookAlerts : config.discordWebhookDaily;
}

// Discord 필드 길이 제한에 맞춰 자른다
export function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

async function post(channel: Channel, embed: Embed): Promise<boolean> {
  const url = webhookFor(channel);
  if (!url) {
    console.warn(`[discord] ${channel} 웹훅이 설정되지 않아 알림을 건너뜀: ${embed.title}`);
    return false;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 로그나 리포트 내용이 멘션을 일으키지 않도록 막는다
    body: JSON.stringify({
      embeds: [{ ...embed, title: clip(embed.title, 256), description: embed.description && clip(embed.description, 4000) }],
      allowed_mentions: { parse: [] },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord webhook ${channel} failed: ${res.status} ${await res.text()}`);
  return true;
}

// 알림을 보내고 notifications에 기록한다. dedupeKey가 있으면 같은 키로는 한 번만 보낸다.
export async function notify(
  channel: Channel,
  kind: string,
  embed: Embed,
  opts: { jobId?: number; dedupeKey?: string } = {},
): Promise<void> {
  if (!webhookFor(channel)) {
    await post(channel, embed);
    return;
  }
  const claim = await db().query<{ id: number }>(
    `INSERT INTO notifications (job_id, channel, kind, dedupe_key) VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [opts.jobId ?? null, channel, kind, opts.dedupeKey ?? null],
  );
  const id = claim.rows[0]?.id;
  if (id === undefined) return; // 이미 보낸 알림
  try {
    await post(channel, embed);
  } catch (err) {
    // 발송 실패 시 기록을 지워 다음 기회에 다시 보낼 수 있게 한다
    await db().query('DELETE FROM notifications WHERE id = $1', [id]);
    throw err;
  }
}

export function jobUrl(jobId: number): string | undefined {
  return config.dashboardUrl ? `${config.dashboardUrl}/dashboard/jobs/${jobId}` : undefined;
}
