import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema/index.ts';

export type Database = ReturnType<typeof createDatabase>['db'];

/**
 * Подключение к Postgres.
 *
 * Живёт ТОЛЬКО внутри серверного процесса (инвариант 1, GDD §2.3).
 * Ни строка подключения, ни этот модуль не должны оказаться в клиентском
 * бандле: apps/web не зависит от @bruteforce/server, и это проверяется
 * сборкой.
 *
 * Neon требует pooled-строку (ADR 0001), поэтому размер локального пула
 * держим небольшим — пулер на стороне Neon и так мультиплексирует.
 */
export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });

  return { db, pool };
}

export { schema };
