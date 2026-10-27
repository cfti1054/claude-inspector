import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { isUsageLimitMessage, parseCliOutput, reportJsonSchema, systemPrompt, UsageLimitError, type Report } from './report.js';

// 읽기 전용 도구만 허용한다. 5단계(PR 생성) 전까지 수정·실행 도구는 쓰지 않는다.
const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob'];
const DISALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch'];

// API 키가 있으면 API 키로, 없으면 Claude 구독 토큰(claude setup-token으로 발급)으로 인증한다
export type ClaudeAuth = { kind: 'api-key'; value: string } | { kind: 'subscription'; value: string };

export function claudeAuth(env: NodeJS.ProcessEnv = process.env): ClaudeAuth {
  if (env.ANTHROPIC_API_KEY) return { kind: 'api-key', value: env.ANTHROPIC_API_KEY };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { kind: 'subscription', value: env.CLAUDE_CODE_OAUTH_TOKEN };
  throw new Error('Missing required environment variable: ANTHROPIC_API_KEY 또는 CLAUDE_CODE_OAUTH_TOKEN');
}

export function claudeArgs(auth: ClaudeAuth): string[] {
  const args = ['-p'];
  if (auth.kind === 'api-key') {
    // --bare는 대상 저장소의 CLAUDE.md, 훅, 플러그인을 읽지 않는다. 단 인증은 API 키만 받는다.
    args.push('--bare');
  } else {
    // 구독 토큰은 --bare에서 쓸 수 없으므로, 사용자 설정만 읽게 해 대상 저장소의 설정(훅 포함)을 막는다.
    // CLAUDE.md는 환경변수로 끄고, 저장소의 Claude 설정 파일은 clone 직후 지운다 (repo.ts).
    args.push('--setting-sources', 'user');
  }
  args.push(
    '--output-format', 'json',
    '--json-schema', reportJsonSchema,
    '--append-system-prompt', systemPrompt(),
    '--allowedTools', ...ALLOWED_TOOLS,
    '--disallowedTools', ...DISALLOWED_TOOLS,
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-budget-usd', String(config.claudeMaxBudgetUsd),
  );
  if (config.claudeModel) args.push('--model', config.claudeModel);
  return args;
}

// 자식 프로세스에는 Claude 인증 정보 하나만 넘긴다. DB 주소나 GitHub 토큰 같은 다른 비밀은 넘기지 않는다.
export function claudeEnv(auth: ClaudeAuth, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: base.PATH,
    HOME: base.HOME,
    LANG: 'C.UTF-8',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };
  if (auth.kind === 'api-key') env.ANTHROPIC_API_KEY = auth.value;
  else env.CLAUDE_CODE_OAUTH_TOKEN = auth.value;
  return env;
}

export class TimeoutError extends Error {}

// 프롬프트는 인자 길이 제한을 피하려고 stdin으로 넘긴다.
export function runClaude(cwd: string, prompt: string, timeoutMs = config.jobTimeoutMs): Promise<{ report: Report; costUsd: number | null }> {
  const auth = claudeAuth();

  return new Promise((resolve, reject) => {
    const child = spawn(config.claudeBin, claudeArgs(auth), { cwd, env: claudeEnv(auth), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new TimeoutError(`작업 타임아웃 (${Math.round(timeoutMs / 1000)}초)`));
      try {
        resolve(parseCliOutput(stdout));
      } catch (err) {
        if (err instanceof UsageLimitError) return reject(err);
        const detail = code === 0 ? '' : ` (exit ${code}) ${stderr.slice(-500)}`;
        const message = `${err instanceof Error ? err.message : String(err)}${detail}`;
        reject(isUsageLimitMessage(stderr) ? new UsageLimitError(message) : new Error(message));
      }
    });

    child.stdin.end(prompt);
  });
}
