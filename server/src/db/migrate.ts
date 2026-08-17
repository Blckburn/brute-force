import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createLogger } from '../logger.ts';
import { createDatabase } from './client.ts';

/**
 * Применение миграций. Запускается командой `pnpm db:migrate`, а на
 * Render — перед стартом сервера.
 *
 * Идемпотентно: drizzle ведёт таблицу с журналом применённых миграций
 * и пропускает уже накатанные.
 */
async function main(): Promise<void> {
  const log = createLogger('info', { component: 'migrate' });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    log.error('DATABASE_URL не задан');
    process.exitCode = 1;
    return;
  }

  const { db, pool } = createDatabase(connectionString);
  const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

  try {
    log.info('применяю миграции', { migrationsFolder });
    await migrate(db, { migrationsFolder });
    log.info('миграции применены');
  } catch (err) {
    log.error('миграции не применились', {
      detail: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
