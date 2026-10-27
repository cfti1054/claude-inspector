import { spawn } from 'node:child_process';
import { config, required } from '../config.js';
import { parseCliOutput, reportJsonSchema, systemPrompt, type Report } from './report.js';

// 읽기 전용 도구만 허용한다. 5단계(PR 생성) 전까지 수정·실행 도구는 쓰지 않는다.
const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob'];
const DISALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch'];

export function claudeArgs(): string[] {
  const args = [
    '-p',
    '--bare', // 대상 저장소의 CLAUDE.md, 훅, 플러그인을 읽지 않는다
    '--output-format', 'json',
    '--json-schema', reportJsonSchema,
    '--append-system-prompt', systemPrompt(),
    '--allowedTools', ...ALLOWED_TOOLS,
    '--disallowedTools', ...DISALLOWED_TOOLS,
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-budget-usd', String(config.claudeMaxBudgetUsd),
  ];
  if (config.claudeModel) args.push('--model', config.claudeModel);
  return args;
}

export class TimeoutError extends Error {}

// 프롬프트는 인자 길이 제한을 피하려고 stdin으로 넘긴다.
// 자식 프로세스에는 DB 주소나 GitHub 토큰 같은 다른 비밀을 넘기지 않는다.
export function runClaude(cwd: string, prompt: string, timeoutMs = config.jobTimeoutMs): Promise<{ report: Report; costUsd: number | null }> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
  };

  return new Promise((resolve, reject) => {
    const child = spawn(config.claudeBin, claudeArgs(), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
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
        const detail = code === 0 ? '' : ` (exit ${code}) ${stderr.slice(-500)}`;
        reject(new Error(`${err instanceof Error ? err.message : String(err)}${detail}`));
      }
    });

    child.stdin.end(prompt);
  });
}
