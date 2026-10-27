import { jobLabel, type JobStatus } from '../jobs.js';
import { ago, duration, kstDate, kstDateTime, kstShort, kstTimeSec } from '../time.js';
import { html, qs, type SafeHtml } from './html.js';
import type { JobDetail, JobRow, NotificationRow, ProjectRow, Range, StatusFilter } from './queries.js';

const FONT_LINKS = html`
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap">`;

const statusLabels: Record<JobStatus, string> = {
  queued: '대기',
  running: '실행 중',
  waiting_approval: '승인 대기',
  done: '완료',
  failed: '실패',
};

const sevLabels: Record<string, string> = { ok: '정상', warning: 'warning', error: 'error', critical: 'critical' };

const icons = {
  logo: html`<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#1F5E52"/><path d="M8 14.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  jobs: html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>`,
  projects: html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  bell: html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0"/></svg>`,
  back: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>`,
};

type Nav = 'jobs' | 'projects' | 'notifications';

function page(opts: { title: string; nav?: Nav; refreshSeconds?: number; body: SafeHtml }): string {
  const navItem = (key: Nav, href: string, label: string, icon: SafeHtml) =>
    html`<a href="${href}" ${opts.nav === key ? html`aria-current="page"` : ''}>${icon}${label}</a>`;
  return html`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
${opts.refreshSeconds ? html`<meta http-equiv="refresh" content="${opts.refreshSeconds}">` : ''}
<title>${opts.title} · Claude 점검 서버</title>
${FONT_LINKS}
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
${opts.nav
  ? html`<div class="shell">
  <aside class="side">
    <a class="brand" href="/dashboard">${icons.logo}<span><b>Claude 점검 서버</b><small>중앙 대시보드</small></span></a>
    <nav class="nav" aria-label="주 메뉴">
      ${navItem('jobs', '/dashboard', '작업', icons.jobs)}
      ${navItem('projects', '/dashboard/projects', '프로젝트', icons.projects)}
      ${navItem('notifications', '/dashboard/notifications', '알림 기록', icons.bell)}
    </nav>
    <div class="side-foot">
      <p class="note">읽기 전용 화면입니다. 작업 등록과 설정 변경은 API와 CLI로만 합니다.</p>
      <form method="post" action="/logout"><button class="linkbtn" type="submit">로그아웃</button></form>
    </div>
  </aside>
  <main class="main">${opts.body}</main>
</div>`
  : opts.body}
</body>
</html>`.value;
}

function statusChip(s: JobStatus): SafeHtml {
  return html`<span class="chip st-${s}">${statusLabels[s]}</span>`;
}

function sevChip(sev: string | null | undefined): SafeHtml {
  if (!sev) return html`<span class="sev sev-none">—</span>`;
  return html`<span class="sev sev-${sev}">${sevLabels[sev] ?? sev}</span>`;
}

function bar(used: number, limit: number): SafeHtml {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return html`<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="${used} / ${limit}회 사용">
    <rect class="track" width="100" height="8" rx="4"/>
    ${pct > 0 ? html`<rect class="fill ${pct >= 70 ? 'near' : ''}" width="${pct}" height="8" rx="4"/>` : ''}
  </svg>`;
}

function took(j: { started_at: Date | null; finished_at: Date | null; status: JobStatus }, now: Date): string {
  if (!j.started_at) return '—';
  if (j.finished_at) return duration(j.finished_at.getTime() - j.started_at.getTime());
  if (j.status === 'running') return duration(now.getTime() - j.started_at.getTime());
  return '—';
}

function rowSummary(j: JobRow): string {
  if (j.summary) return j.summary;
  if (j.status === 'failed') return j.last_error ?? '실패';
  if (j.status === 'running') return '분석 중';
  if (j.status === 'queued') return j.last_error ? `재시도 대기 · ${j.last_error}` : '대기 중';
  return '';
}

// ───────────────────────── 작업 목록 ─────────────────────────

export interface JobsPageData {
  range: Range;
  q: string;
  status: StatusFilter;
  page: number;
  rows: JobRow[];
  hasMore: boolean;
  counts: { total: number; queued: number; running: number; waiting_approval: number; done: number; failed: number; errors: number; health: number; timeouts: number };
  queue: { queued: number; oldest: Date | null };
  projects: ProjectRow[];
}

const rangeLabels: Record<Range, string> = { today: '오늘', '7d': '최근 7일', '30d': '최근 30일' };

export function jobsPage(d: JobsPageData): string {
  const now = new Date();
  const c = d.counts;
  const waitMin = d.queue.oldest ? Math.floor((now.getTime() - d.queue.oldest.getTime()) / 60000) : 0;
  const active = c.queued + c.running > 0 || d.queue.queued > 0;
  const link = (over: Record<string, string | number | undefined>) =>
    '/dashboard' + qs({ range: d.range === 'today' ? undefined : d.range, q: d.q, status: d.status === 'all' ? undefined : d.status, ...over });

  const filterDefs: Array<[StatusFilter, string, number]> = [
    ['all', '전체', c.total],
    ['running', '실행 중', c.running],
    ['queued', '대기', c.queued],
    ['done', '완료', c.done],
    ['failed', '실패', c.failed],
  ];
  if (c.waiting_approval > 0) filterDefs.splice(3, 0, ['waiting_approval', '승인 대기', c.waiting_approval]);

  const activeProjects = d.projects.filter((p) => p.active);

  const body = html`
<header class="head">
  <div>
    <h1>작업</h1>
    <p class="sub"><span>${kstDateTime(now)} 기준</span>${active ? html`<span class="live">30초마다 새로고침</span>` : ''}</p>
  </div>
  <form class="search" method="get" action="/dashboard" role="search">
    ${d.status !== 'all' ? html`<input type="hidden" name="status" value="${d.status}">` : ''}
    <label class="sr-only" for="q">작업 검색</label>
    <input class="input" id="q" type="search" name="q" value="${d.q}" placeholder="작업 ID, 프로젝트, 요약, error_hash">
    <label class="sr-only" for="range">기간</label>
    <select class="select" id="range" name="range">
      ${(Object.keys(rangeLabels) as Range[]).map((r) => html`<option value="${r}" ${r === d.range ? html`selected` : ''}>${rangeLabels[r]}</option>`)}
    </select>
    <button class="btn" type="submit">조회</button>
  </form>
</header>

<section class="kpis" aria-label="요약">
  <div class="kpi"><span class="label">${rangeLabels[d.range]} 작업</span><span class="value">${c.total}</span><span class="note2">오류 분석 ${c.errors} · 정기 점검 ${c.health}</span></div>
  <div class="kpi"><span class="label">실패</span><span class="value ${c.failed ? 'bad' : ''}">${c.failed}</span><span class="note2">${c.failed ? `타임아웃 ${c.timeouts} · 기타 ${c.failed - c.timeouts}` : '실패한 작업 없음'}</span></div>
  <div class="kpi"><span class="label">진행 중</span><span class="value">${c.running + c.queued}</span><span class="note2">실행 ${c.running} · 대기 ${c.queued}</span></div>
  <div class="kpi"><span class="label">큐 최장 대기</span><span class="value ${waitMin >= 10 ? 'warn' : ''}">${waitMin}분</span><span class="note2">전체 대기 ${d.queue.queued}건 · 알림 기준 10분</span></div>
</section>

<div class="cols">
  <section class="col-main" aria-label="작업 목록">
    <nav class="filters" aria-label="상태 필터">
      ${filterDefs.map(([key, label, n]) => html`<a class="fchip" href="${link({ status: key === 'all' ? undefined : key, page: undefined })}" ${d.status === key ? html`aria-current="true"` : ''}>${label}<span class="n">${n}</span></a>`)}
    </nav>
    <div class="card scroll">
      <div class="table" role="table" aria-label="작업">
        <div class="trow th" role="row"><span role="columnheader">작업</span><span role="columnheader">프로젝트</span><span role="columnheader">유형</span><span role="columnheader">심각도</span><span role="columnheader">상태</span><span role="columnheader">요약</span><span role="columnheader">시작</span><span role="columnheader">소요</span></div>
        ${d.rows.map(
          (j) => html`<a class="trow" role="row" href="/dashboard/jobs/${j.id}">
          <span class="id" role="cell">${jobLabel(j.id)}</span>
          <span class="mono" role="cell">${j.project}</span>
          <span role="cell">${j.type === 'error' ? '오류 분석' : '정기 점검'}</span>
          <span role="cell">${sevChip(j.type === 'health' ? j.report_severity : j.severity)}</span>
          <span role="cell">${statusChip(j.status)}</span>
          <span class="sum" role="cell" title="${rowSummary(j)}">${rowSummary(j)}</span>
          <span class="mono" role="cell">${kstShort(j.created_at, now)}</span>
          <span class="mono muted" role="cell">${took(j, now)}</span>
        </a>`,
        )}
        ${d.rows.length === 0 ? html`<div class="empty">${d.q ? '검색 결과가 없습니다.' : '이 조건의 작업이 없습니다.'}</div>` : ''}
      </div>
      ${d.page > 1 || d.hasMore
        ? html`<div class="pager">
        ${d.page > 1 ? html`<a href="${link({ page: d.page - 1 === 1 ? undefined : d.page - 1 })}">← 이전</a>` : ''}
        ${d.hasMore ? html`<a href="${link({ page: d.page + 1 })}">다음 →</a>` : ''}
      </div>`
        : ''}
    </div>
  </section>

  <aside class="col-side">
    <section class="card pad-s" aria-label="프로젝트별 일일 호출">
      <h2>프로젝트별 오늘 호출</h2>
      ${activeProjects.length === 0 ? html`<p class="muted">등록된 프로젝트가 없습니다.</p>` : ''}
      ${activeProjects.map((p) => {
        const near = p.daily_limit > 0 && p.used_today / p.daily_limit >= 0.7;
        return html`<div class="usage">
          <div class="usage-top"><span class="mono">${p.name}</span><span class="${near ? 'near' : 'muted'}">${p.used_today} / ${p.daily_limit}회</span></div>
          ${bar(p.used_today, p.daily_limit)}
          ${near ? html`<span class="muted" style="font-size:12px">한도 임박 · 초과 시 429 응답</span>` : ''}
        </div>`;
      })}
    </section>

    <section class="card pad-s" aria-label="정기 점검 현황">
      <h2>정기 점검 현황</h2>
      <div>
      ${activeProjects.map((p) =>
        p.health_job_id
          ? html`<a class="hrow" href="/dashboard/jobs/${p.health_job_id}">
              <span class="meta"><span class="mono">${p.name}</span><span>${p.health_status === 'done' ? p.health_summary ?? '' : statusLabels[p.health_status!]} · ${p.health_at ? ago(p.health_at, now) : ''}</span></span>
              ${p.health_status === 'done' ? sevChip(p.health_severity) : statusChip(p.health_status!)}
            </a>`
          : html`<div class="hrow"><span class="meta"><span class="mono">${p.name}</span><span>아직 점검 기록 없음</span></span></div>`,
      )}
      </div>
    </section>
  </aside>
</div>`;

  return page({ title: '작업', nav: 'jobs', refreshSeconds: active ? 30 : undefined, body });
}

// ───────────────────────── 작업 상세 ─────────────────────────

export function jobPage(j: JobDetail, notifications: NotificationRow[]): string {
  const now = new Date();
  const title = j.summary ?? (j.type === 'health' ? '정기 점검' : '오류 분석');
  const inProgress = j.status === 'queued' || j.status === 'running';
  const body = j.body ?? {};

  type Step = { label: string; at: string; state: 'done' | 'now' | 'bad' | 'todo' };
  const steps: Step[] = [{ label: 'queued', at: kstTimeSec(j.created_at), state: 'done' }];
  if (j.started_at) {
    steps.push({
      label: 'running',
      at: `${kstTimeSec(j.started_at)} · ${took(j, now)}${j.attempts > 1 ? ` · 시도 ${j.attempts}` : ''}`,
      state: j.status === 'running' ? 'now' : 'done',
    });
  } else {
    steps.push({ label: 'running', at: '대기 중', state: 'todo' });
  }
  if (j.status === 'done') steps.push({ label: 'done', at: j.finished_at ? kstTimeSec(j.finished_at) : '', state: 'done' });
  else if (j.status === 'failed') steps.push({ label: 'failed', at: j.finished_at ? kstTimeSec(j.finished_at) : '', state: 'bad' });
  else steps.push({ label: 'done', at: '리포트 저장 시 완료', state: 'todo' });

  const content = html`
<header style="display:flex;flex-direction:column;gap:12px">
  <a class="back" href="/dashboard">${icons.back}작업 목록</a>
  <div class="title">
    <h1><span class="id">${jobLabel(j.id)}</span>${title}</h1>
    ${sevChip(j.report_severity ?? j.severity)}
    ${statusChip(j.status)}
  </div>
  <p class="sub">
    ${j.summary ? '리포트는 Claude Code가 생성했으며 사람의 검토가 필요합니다.' : ''}
    ${inProgress ? html`<span class="live">10초마다 새로고침</span>` : ''}
  </p>
</header>

<section class="card pad" aria-label="작업 정보">
  <dl class="metagrid">
    <div><dt>프로젝트</dt><dd class="mono">${j.project}</dd></div>
    <div><dt>유형</dt><dd>${j.type === 'error' ? '오류 분석' : '정기 점검'}</dd></div>
    ${j.type === 'error' ? html`<div><dt>보고된 심각도</dt><dd>${j.severity ?? '—'}</dd></div>` : ''}
    ${j.error_hash ? html`<div><dt>error_hash</dt><dd class="mono">${j.error_hash}</dd></div>` : ''}
    ${j.payload.occurred_at ? html`<div><dt>발생 시각</dt><dd class="mono">${fmtIso(j.payload.occurred_at)}</dd></div>` : ''}
    <div><dt>등록</dt><dd class="mono">${kstDateTime(j.created_at)}</dd></div>
    <div><dt>시도</dt><dd class="mono">${j.attempts}</dd></div>
    ${j.cost_usd !== null ? html`<div><dt>Claude 비용</dt><dd class="mono">$${Number(j.cost_usd).toFixed(4)}</dd></div>` : ''}
  </dl>
</section>

<div class="cols">
  <div class="col-main">
    ${j.status === 'failed' && j.last_error
      ? html`<div class="callout fail" role="alert"><b>실패 사유</b><span>${j.last_error}</span></div>`
      : ''}
    ${j.status === 'queued' && j.last_error
      ? html`<div class="callout info"><b>재시도 대기</b><span>이전 시도 실패: ${j.last_error}</span></div>`
      : ''}

    ${j.summary
      ? html`<section class="card pad prose" aria-label="분석 리포트">
      <h2>요약</h2>
      <p>${j.summary}</p>
      ${body.causes?.length
        ? html`<h2 class="section-h">${j.type === 'health' ? '발견 사항' : '원인 추정'}</h2><ul>${body.causes.map((x) => html`<li>${x}</li>`)}</ul>`
        : ''}
      ${body.evidence
        ? html`<h2 class="section-h">근거 로그 <small>· 마스킹됨</small></h2><pre class="code">${body.evidence}</pre>`
        : ''}
      ${body.actions?.length
        ? html`<h2 class="section-h">권장 조치</h2><ol>${body.actions.map((x) => html`<li>${x}</li>`)}</ol>`
        : ''}
    </section>`
      : html`<section class="card pad"><h2>리포트</h2><p class="muted">${inProgress ? 'Claude Code가 분석을 마치면 리포트가 여기에 표시됩니다.' : '저장된 리포트가 없습니다.'}</p></section>`}

    ${j.payload.logs
      ? html`<section class="card pad">
      <details class="raw"><summary>수신한 로그 원문 (서버 마스킹 적용)</summary><pre class="code">${j.payload.logs}</pre></details>
    </section>`
      : ''}
  </div>

  <aside class="col-side">
    <section class="card pad-s" aria-label="진행 이력">
      <h2>진행 이력</h2>
      <div class="steps">
        ${steps.map(
          (s) => html`<div class="step"><span class="dot ${s.state === 'todo' ? '' : s.state}"></span><div><b>${s.label}</b><div class="t">${s.at}</div></div></div>`,
        )}
      </div>
    </section>

    <section class="card pad-s" aria-label="알림 기록">
      <h2>알림 기록</h2>
      ${notifications.length
        ? html`<div class="nlist">${notifications.map((n) => html`<div><span class="mono">#${n.channel}</span><span class="mono muted">${kstTimeSec(n.sent_at)}</span></div>`)}</div>`
        : html`<p class="muted" style="font-size:14px">${j.type === 'error' ? 'critical 결과와 최종 실패만 #alerts로 즉시 알립니다.' : '정기 점검 결과는 #daily-report 요약에 포함됩니다.'}</p>`}
    </section>
  </aside>
</div>`;

  return page({ title: jobLabel(j.id), nav: 'jobs', refreshSeconds: inProgress ? 10 : undefined, body: content });
}

function fmtIso(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : kstDateTime(d);
}

// ───────────────────────── 프로젝트 ─────────────────────────

export function projectsPage(projects: ProjectRow[]): string {
  const now = new Date();
  const body = html`
<header class="head"><div><h1>프로젝트</h1><p class="sub">등록과 토큰 재발급은 <span class="mono">project:add</span> CLI로 합니다.</p></div></header>
<div class="card scroll">
  <div class="ptable" role="table" aria-label="프로젝트">
    <div class="prow th" role="row"><span role="columnheader">프로젝트</span><span role="columnheader">저장소</span><span role="columnheader">오늘 호출</span><span role="columnheader">최근 정기 점검</span><span role="columnheader">마지막 작업</span></div>
    ${projects.map(
      (p) => html`<div class="prow ${p.active ? '' : 'inactive'}" role="row">
      <span class="stack" role="cell"><span class="mono">${p.name}</span><span class="muted" style="font-size:12px">${p.active ? `디바운스 ${Math.round(p.debounce_seconds / 60)}분` : '비활성'}</span></span>
      <span class="stack" role="cell"><a class="mono" href="${p.repo_url}" rel="noreferrer">${p.repo_url.replace('https://github.com/', '')}</a><span class="muted mono" style="font-size:12px">${p.repo_branch}</span></span>
      <span class="stack" role="cell"><span class="mono">${p.used_today} / ${p.daily_limit}</span>${bar(p.used_today, p.daily_limit)}</span>
      <span class="stack" role="cell">${p.health_job_id
        ? html`<a href="/dashboard/jobs/${p.health_job_id}">${p.health_status === 'done' ? sevChip(p.health_severity) : statusChip(p.health_status!)}</a><span class="muted" style="font-size:12px">${p.health_summary ?? ''}</span>`
        : html`<span class="muted">기록 없음</span>`}</span>
      <span class="mono muted" role="cell">${p.last_job_at ? ago(p.last_job_at, now) : '—'}</span>
    </div>`,
    )}
    ${projects.length === 0 ? html`<div class="empty">등록된 프로젝트가 없습니다. <span class="mono">npm run project:add</span>로 등록하세요.</div>` : ''}
  </div>
</div>`;
  return page({ title: '프로젝트', nav: 'projects', body });
}

// ───────────────────────── 알림 기록 ─────────────────────────

const kindLabels: Record<string, string> = {
  job_critical: 'critical 결과',
  job_failed: '작업 실패',
  daily_summary: '일일 요약',
  queue_backlog: '큐 정체',
};

export function notificationsPage(rows: NotificationRow[]): string {
  const body = html`
<header class="head"><div><h1>알림 기록</h1><p class="sub">최근 100건 · Discord로 발송된 알림</p></div></header>
<div class="card scroll">
  <div class="ntable" role="table" aria-label="알림">
    <div class="nrow th" role="row"><span role="columnheader">발송 시각</span><span role="columnheader">채널</span><span role="columnheader">내용</span><span role="columnheader">작업</span></div>
    ${rows.map(
      (n) => html`<div class="nrow" role="row">
      <span class="mono" role="cell">${kstDate(n.sent_at).slice(5)} ${kstTimeSec(n.sent_at)}</span>
      <span class="mono" role="cell">#${n.channel}</span>
      <span role="cell">${kindLabels[n.kind] ?? n.kind}${n.project ? html` · <span class="mono">${n.project}</span>` : ''}</span>
      <span role="cell">${n.job_id ? html`<a class="mono" href="/dashboard/jobs/${n.job_id}">${jobLabel(n.job_id)}</a>` : html`<span class="muted">—</span>`}</span>
    </div>`,
    )}
    ${rows.length === 0 ? html`<div class="empty">아직 발송된 알림이 없습니다.</div>` : ''}
  </div>
</div>`;
  return page({ title: '알림 기록', nav: 'notifications', body });
}

// ───────────────────────── 로그인 ─────────────────────────

export function loginPage(error?: string): string {
  const body = html`
<div class="login-wrap">
  <main class="card login">
    <a class="brand" href="/login" style="padding:0">${icons.logo}<span><b>Claude 점검 서버</b><small>중앙 대시보드</small></span></a>
    <form method="post" action="/login">
      <label for="password">관리자 비밀번호</label>
      <input class="input" id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      ${error ? html`<p class="err" role="alert">${error}</p>` : ''}
      <button class="btn primary" type="submit">로그인</button>
    </form>
  </main>
</div>`;
  return page({ title: '로그인', body });
}
