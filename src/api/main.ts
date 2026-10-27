import { config, required } from '../config.js';
import { closeDb } from '../db.js';
import { buildApp } from './app.js';

// 시작할 때 필수 환경변수를 확인해 잘못된 배포가 요청을 받기 전에 실패하게 한다
for (const name of ['DATABASE_URL', 'SCHEDULER_TOKEN', 'DASHBOARD_PASSWORD', 'SESSION_SECRET']) required(name);
if (required('SESSION_SECRET').length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

const app = buildApp();

const shutdown = async () => {
  await app.close();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
