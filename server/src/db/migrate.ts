import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
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
    // Кем именно подключились — до попытки миграций, а не после падения.
    // Строка подключения задаётся руками, и перепутать в ней роль легко:
    // достаточно вставить пароль от другой. Ошибка при этом приходит
    // не «не та роль», а «Failed query: CREATE SCHEMA», по которой
    // причина не читается.
    const who = await db.execute<{ role: string; may_create: boolean }>(sql`
      select
        current_user as role,
        has_database_privilege(current_user, current_database(), 'CREATE') as may_create
    `);
    const role = who.rows[0]?.role ?? 'unknown';
    const mayCreate = who.rows[0]?.may_create ?? false;

    log.info('роль подключилась', { role, mayCreateInDatabase: mayCreate });

    if (!mayCreate) {
      log.error('у роли нет права CREATE на базе — это роль рантайма, а не владелец', {
        role,
        fix: 'MIGRATE_DATABASE_URL должен содержать роль-владельца (на Neon neondb_owner) вместе с ЕЁ паролем',
      });
      process.exitCode = 1;
      return;
    }

    log.info('применяю миграции', { migrationsFolder });
    await migrate(db, { migrationsFolder });
    log.info('миграции применены');
  } catch (err) {
    // Драйвер прячет настоящую причину в cause: наружу торчит только
    // «Failed query: ...», по которому не видно ни прав, ни соединения.
    const cause = err instanceof Error ? err.cause : undefined;
    log.error('миграции не применились', {
      detail: err instanceof Error ? err.message : String(err),
      cause: cause instanceof Error ? cause.message : undefined,
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
