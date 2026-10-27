// 대시보드 스타일. 목업의 색과 배치를 따르고, 다크 모드는 같은 토큰을 다시 정의해 지원한다.
export const css = String.raw`
:root {
  color-scheme: light dark;
  --bg: #F4F5F2;
  --surface: #FFFFFF;
  --surface-2: #F7F9F8;
  --ink: #16191C;
  --ink-2: #2B323B;
  --muted: #5B6370;
  --line: #E1E4E8;
  --line-2: #E6E9ED;
  --accent: #1F5E52;
  --accent-ink: #123B33;
  --accent-soft: #E1EDE9;
  --hover: #ECEEEA;
  --code-bg: #16191C;
  --code-ink: #E8EAED;
  --track: #E6E9ED;

  --q-bg: #ECEEF1; --q-ink: #3F4854;
  --r-bg: #E1EAF8; --r-ink: #1B4A96;
  --w-bg: #FBEED0; --w-ink: #7A4A00;
  --d-bg: #E0F0E6; --d-ink: #17603B;
  --f-bg: #FBE3E2; --f-ink: #9A1F23;

  --crit-bg: #8F1D21; --crit-ink: #FFFFFF;
  --err-ink: #8F1D21;
  --warn-bg: #F6EBD0; --warn-ink: #6B4300;
  --ok-bg: #E0F0E6; --ok-ink: #17603B;
  --near: #B7791F;

  --radius: 12px;
  --shadow: 0 1px 2px rgba(22, 25, 28, .04), 0 4px 16px rgba(22, 25, 28, .04);
  --font: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0F1214;
    --surface: #171B1E;
    --surface-2: #1C2125;
    --ink: #E9ECEE;
    --ink-2: #CDD3D8;
    --muted: #9AA3AD;
    --line: #2A3036;
    --line-2: #242A2F;
    --accent: #6FC2AE;
    --accent-ink: #9ED9CB;
    --accent-soft: #1B302B;
    --hover: #20262A;
    --code-bg: #0B0D0F;
    --track: #2A3036;

    --q-bg: #262C32; --q-ink: #C3CAD2;
    --r-bg: #182A45; --r-ink: #9CC0F5;
    --w-bg: #3A2C10; --w-ink: #F2C574;
    --d-bg: #15301F; --d-ink: #8FD6A9;
    --f-bg: #3D1719; --f-ink: #F4A3A5;

    --crit-bg: #C8383E; --crit-ink: #FFFFFF;
    --err-ink: #F4A3A5;
    --warn-bg: #3A2C10; --warn-ink: #F2C574;
    --ok-bg: #15301F; --ok-ink: #8FD6A9;
    --near: #E0A84A;
    --shadow: none;
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--font); font-feature-settings: 'tnum'; }
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { color: var(--accent-ink); }
h1, h2, p { margin: 0; }
.mono { font-family: var(--mono); font-size: 13px; }
.muted { color: var(--muted); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

/* 레이아웃: 사이드바 + 본문. 좁은 화면에서는 사이드바가 위로 올라간다 */
.shell { display: flex; flex-wrap: wrap; min-height: 100vh; }
.side { flex: 1 1 240px; max-width: 100%; background: var(--surface); border-right: 1px solid var(--line); padding: 24px 16px; display: flex; flex-direction: column; gap: 28px; }
@media (min-width: 900px) { .side { flex: 0 0 240px; position: sticky; top: 0; height: 100vh; } }
.main { flex: 999 1 560px; min-width: 0; padding: 32px 40px 48px; display: flex; flex-direction: column; gap: 24px; }
@media (max-width: 640px) { .main { padding: 24px 16px 40px; } .side { border-right: 0; border-bottom: 1px solid var(--line); gap: 16px; padding: 16px; } .side .note { display: none; } }

.brand { display: flex; align-items: center; gap: 10px; padding: 0 12px; text-decoration: none; color: var(--ink); }
.brand b { display: block; font-size: 15px; line-height: 1.2; }
.brand small { display: block; font-size: 12px; color: var(--muted); }
.nav { display: flex; flex-direction: column; gap: 2px; }
@media (max-width: 899px) { .nav { flex-direction: row; flex-wrap: wrap; } }
.nav a { display: flex; align-items: center; gap: 10px; padding: 10px 12px; min-height: 44px; border-radius: 8px; color: var(--ink-2); text-decoration: none; font-size: 14px; }
.nav a:hover { background: var(--hover); color: var(--ink); }
.nav a[aria-current="page"] { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
.side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 12px; padding: 0 12px; }
.note { font-size: 12px; line-height: 1.55; color: var(--muted); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.linkbtn { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }

/* 헤더 */
.head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }
.head h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
.sub { margin-top: 6px; font-size: 14px; color: var(--muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.live { display: inline-flex; align-items: center; gap: 6px; }
.live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--d-ink); animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .live::before { animation: none; } }

.search { display: flex; flex-wrap: wrap; gap: 8px; }
.input, .select, .btn { min-height: 44px; border: 1px solid #D3D8DE; border-radius: 8px; font: 14px var(--font); background: var(--surface); color: var(--ink); padding: 0 14px; }
@media (prefers-color-scheme: dark) { .input, .select, .btn { border-color: var(--line); } }
.input { width: 280px; max-width: 100%; }
.btn { cursor: pointer; font-weight: 600; }
.btn:hover { border-color: var(--accent); }
.btn.primary { background: var(--ink); border-color: var(--ink); color: var(--bg); }

/* KPI 카드 */
.kpis { display: flex; flex-wrap: wrap; gap: 16px; }
.kpi { flex: 1 1 200px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow); }
.kpi .label { font-size: 13px; color: var(--muted); }
.kpi .value { font-size: 32px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; }
.kpi .value.bad { color: var(--f-ink); }
.kpi .value.warn { color: var(--w-ink); }
.kpi .note2 { font-size: 13px; color: var(--muted); }

.cols { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.col-main { flex: 999 1 640px; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.col-side { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }

/* 상태 필터 */
.filters { display: flex; flex-wrap: wrap; gap: 8px; }
.fchip { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid #D3D8DE; background: var(--surface); color: var(--ink-2); font-size: 14px; font-weight: 500; text-decoration: none; }
@media (prefers-color-scheme: dark) { .fchip { border-color: var(--line); } }
.fchip:hover { border-color: var(--accent); color: var(--ink); }
.fchip[aria-current="true"] { background: var(--ink); border-color: var(--ink); color: var(--bg); }
.fchip .n { font-family: var(--mono); font-size: 12px; opacity: .8; }

/* 작업 표 */
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.pad { padding: 24px; display: flex; flex-direction: column; gap: 14px; }
.pad-s { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.card h2 { font-size: 16px; font-weight: 700; }
.scroll { overflow-x: auto; }
.table { min-width: 900px; }
.trow { display: grid; grid-template-columns: 84px minmax(0, 1.1fr) 88px 96px 104px minmax(0, 2fr) 84px 92px; gap: 12px; align-items: center; padding: 14px 20px; border-top: 1px solid var(--line-2); color: var(--ink); text-decoration: none; font-size: 14px; }
.trow:hover { background: var(--surface-2); color: var(--ink); }
.trow.th { border-top: 0; padding: 12px 20px; font-size: 12px; font-weight: 700; color: var(--muted); }
.trow.th:hover { background: none; }
.trow .id { font-family: var(--mono); font-size: 13px; color: var(--accent); }
.trow .sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: 48px 20px; text-align: center; font-size: 14px; color: var(--muted); border-top: 1px solid var(--line-2); }
.pager { display: flex; justify-content: center; gap: 8px; padding: 12px; border-top: 1px solid var(--line-2); }
.pager a { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; }
.pager a:hover { background: var(--hover); }

/* 상태·심각도 칩 */
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; width: fit-content; }
.chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.st-queued { background: var(--q-bg); color: var(--q-ink); }
.st-running { background: var(--r-bg); color: var(--r-ink); }
.st-running::before { animation: pulse 1.4s ease-in-out infinite; }
.st-waiting_approval { background: var(--w-bg); color: var(--w-ink); }
.st-done { background: var(--d-bg); color: var(--d-ink); }
.st-failed { background: var(--f-bg); color: var(--f-ink); }
.sev { display: inline-flex; padding: 3px 9px; border-radius: 6px; font-size: 12px; font-weight: 700; width: fit-content; }
.sev-critical { background: var(--crit-bg); color: var(--crit-ink); }
.sev-error { color: var(--err-ink); box-shadow: inset 0 0 0 1.5px var(--err-ink); }
.sev-warning { background: var(--warn-bg); color: var(--warn-ink); }
.sev-ok { background: var(--ok-bg); color: var(--ok-ink); }
.sev-none { color: var(--muted); font-weight: 400; padding-left: 0; }

/* 우측 패널 */
.usage { display: flex; flex-direction: column; gap: 8px; }
.usage-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 13px; }
.usage-top .near { color: var(--w-ink); font-weight: 600; }
.bar { display: block; width: 100%; height: 8px; border-radius: 4px; }
.bar .track { fill: var(--track); }
.bar .fill { fill: var(--accent); }
.bar .fill.near { fill: var(--near); }
.hrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line-2); text-decoration: none; color: var(--ink); font-size: 14px; }
.hrow:first-of-type { border-top: 0; }
.hrow:hover { color: var(--accent); }
.hrow .meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hrow .meta span:last-child { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 상세 */
.back { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; width: fit-content; font-size: 14px; text-decoration: none; font-weight: 600; }
.title { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.title h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
.title .id { font-family: var(--mono); font-size: 24px; color: var(--accent); margin-right: 8px; font-weight: 500; }
.metagrid { margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 20px 32px; }
.metagrid dt { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.metagrid dd { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.prose { font-size: 15px; line-height: 1.75; }
.prose ul, .prose ol { margin: 0; padding-left: 20px; }
.prose li + li { margin-top: 4px; }
.section-h { margin-top: 10px; display: flex; align-items: baseline; gap: 8px; }
.section-h small { font-size: 12px; font-weight: 400; color: var(--muted); }
pre.code { margin: 0; background: var(--code-bg); color: var(--code-ink); border-radius: 8px; padding: 16px; font: 13px/1.7 var(--mono); overflow-x: auto; white-space: pre; }
details.raw summary { cursor: pointer; font-size: 14px; font-weight: 600; min-height: 32px; display: flex; align-items: center; }
details.raw pre { margin-top: 10px; max-height: 420px; }
.callout { border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.55; }
.callout.fail { background: var(--f-bg); color: var(--f-ink); }
.callout.info { background: var(--q-bg); color: var(--q-ink); }
.steps { display: flex; flex-direction: column; gap: 16px; }
.step { display: flex; gap: 12px; align-items: flex-start; font-size: 14px; }
.step b { font-family: var(--mono); font-weight: 500; font-size: 13px; }
.step .t { color: var(--muted); font-family: var(--mono); font-size: 13px; }
.dot { flex: 0 0 12px; width: 12px; height: 12px; border-radius: 50%; margin-top: 4px; border: 2px solid var(--muted); }
.dot.done { background: var(--accent); border-color: var(--accent); }
.dot.now { border-color: var(--near); }
.dot.bad { background: var(--f-ink); border-color: var(--f-ink); }
.nlist { display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
.nlist div { display: flex; justify-content: space-between; gap: 8px; }

/* 프로젝트·알림 표 */
.ptable { min-width: 860px; }
.prow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 140px minmax(0, 1.4fr) 110px; gap: 16px; align-items: center; padding: 16px 20px; border-top: 1px solid var(--line-2); font-size: 14px; }
.prow.th, .nrow.th { border-top: 0; padding: 12px 20px; font-size: 12px; font-weight: 700; color: var(--muted); }
.prow .stack { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.prow .stack span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inactive { opacity: .55; }
.ntable { min-width: 640px; }
.nrow { display: grid; grid-template-columns: 150px 140px minmax(0, 1fr) 120px; gap: 16px; align-items: center; padding: 14px 20px; border-top: 1px solid var(--line-2); font-size: 14px; }

/* 로그인 */
.login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.login { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 20px; padding: 32px; }
.login form { display: flex; flex-direction: column; gap: 12px; }
.login label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.login .input { width: 100%; }
.err { font-size: 13px; color: var(--f-ink); background: var(--f-bg); border-radius: 8px; padding: 10px 12px; }
`;
