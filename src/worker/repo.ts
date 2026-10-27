import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args[0]} 실패 (code ${code}): ${stderr.slice(-500)}`));
    });
  });
}

// 작업마다 임시 디렉터리에 얕은 clone을 받는다. 토큰은 명령 인자가 아닌 환경변수로 git에 전달한다.
export async function prepareRepo(repoUrl: string, branch: string, githubToken: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const base = await mkdtemp(path.join(tmpdir(), 'inspect-'));
  const dir = path.join(base, 'repo');
  const cleanup = () => rm(base, { recursive: true, force: true });

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_TERMINAL_PROMPT: '0',
  };
  if (githubToken) {
    const basic = Buffer.from(`x-access-token:${githubToken}`).toString('base64');
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  }

  try {
    await run('git', ['clone', '--depth', '20', '--single-branch', '--branch', branch, '--', repoUrl, dir], env, 120_000);
  } catch (err) {
    await cleanup();
    // 오류 메시지에 토큰이 섞이지 않도록 한다
    throw new Error(String(err instanceof Error ? err.message : err).split(githubToken || '\u0000').join('[MASKED]'));
  }
  return { dir, cleanup };
}
