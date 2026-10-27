// 프로젝트를 등록하거나 토큰을 재발급한다. 토큰 원문은 이때 한 번만 출력되고 DB에는 해시만 저장된다.
//   node dist/cli/add-project.js --name my-project-a --repo https://github.com/owner/repo [--branch main] [--limit 20] [--debounce 3600]
//   node dist/cli/add-project.js --name my-project-a --rotate
//   node dist/cli/add-project.js --name my-project-a --deactivate
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { closeDb, db } from '../db.js';
import { hashToken, newProjectToken } from '../security.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    repo: { type: 'string' },
    branch: { type: 'string', default: 'main' },
    limit: { type: 'string' },
    debounce: { type: 'string' },
    rotate: { type: 'boolean', default: false },
    deactivate: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const name = values.name;
  if (!name || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) fail('--name은 소문자, 숫자, 하이픈으로 된 이름이어야 합니다');

  if (values.deactivate) {
    const r = await db().query('UPDATE projects SET active = false WHERE name = $1', [name]);
    if (!r.rowCount) fail(`프로젝트를 찾을 수 없습니다: ${name}`);
    console.log(`${name} 비활성화 완료`);
    return;
  }

  const token = newProjectToken();
  if (values.rotate) {
    const r = await db().query('UPDATE projects SET token_hash = $2 WHERE name = $1', [name, hashToken(token)]);
    if (!r.rowCount) fail(`프로젝트를 찾을 수 없습니다: ${name}`);
  } else {
    const repo = values.repo;
    if (!repo || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/.test(repo)) {
      fail('--repo는 https://github.com/<owner>/<repo> 형식이어야 합니다');
    }
    const limit = Number(values.limit ?? config.defaultDailyLimit);
    const debounce = Number(values.debounce ?? config.defaultDebounceSeconds);
    if (!Number.isInteger(limit) || limit < 1) fail('--limit은 1 이상의 정수여야 합니다');
    if (!Number.isInteger(debounce) || debounce < 0) fail('--debounce는 0 이상의 정수(초)여야 합니다');
    await db().query(
      `INSERT INTO projects (name, repo_url, repo_branch, token_hash, daily_limit, debounce_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (name) DO UPDATE
         SET repo_url = EXCLUDED.repo_url, repo_branch = EXCLUDED.repo_branch, token_hash = EXCLUDED.token_hash,
             daily_limit = EXCLUDED.daily_limit, debounce_seconds = EXCLUDED.debounce_seconds, active = true`,
      [name, repo, values.branch, hashToken(token), limit, debounce],
    );
  }

  console.log(`프로젝트: ${name}`);
  console.log(`토큰 (다시 표시되지 않습니다. 대상 프로젝트의 INSPECTOR_TOKEN 환경변수에 저장하세요):`);
  console.log(token);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
