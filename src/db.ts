import pg from 'pg';
import { config, required } from './config.js';

// bigint(id)를 문자열 대신 number로 받는다. 작업 수가 2^53을 넘을 일은 없다.
pg.types.setTypeParser(20, (v) => Number(v));

let pool: pg.Pool | undefined;

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl || required('DATABASE_URL'),
      max: 5,
    });
  }
  return pool;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
