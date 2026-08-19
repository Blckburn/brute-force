import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createLogger } from '../logger.ts';
import { createDatabase } from './client.ts';

/**
 * Применение миграций. Запускается командой `pnpm db:migrate`, а на
 * Render — перед стартом сервера.
 *
 * Ходит в базу ОТДЕЛЬНОЙ РОЛЬЮ с правами DDL (`MIGRATE_DATABASE_URL`),
 * а не той, под которой работает сервер. Рантайму DDL не нужен ни для
 * чего, поэтому у него его и нет — см. server/sql/app-role-grants.sql.
 *
 * Если MIGRATE_DATABASE_URL не задан, берётся DATABASE_URL: так работают
 * локальная разработка и CI, где обе роли — это один суперпользователь
 * в одноразовой базе.
 *
 * Идемпотентно: drizzle ведёт таблицу с журналом применённых миграций
 * и пропускает уже накатанные.
 */
async function main(): Promise<void> {
  const log = createLogger('info', { component: 'migrate' });

  const migrateUrl = process.env.MIGRATE_DATABASE_URL;
  const connectionString = migrateUrl ?? process.env.DATABASE_URL;

  if (!connectionString) {
    log.error('не задан ни MIGRATE_DATABASE_URL, ни DATABASE_URL');
    process.exitCode = 1;
    return;
  }

  log.info('роль для миграций', {
    source: migrateUrl ? 'MIGRATE_DATABASE_URL' : 'DATABASE_URL (запасной вариант)',
  });

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
