import { sql } from 'drizzle-orm';

import type { Database } from './client.ts';
import type { Logger } from '../logger.ts';

/**
 * Проверка прав роли, под которой работает сервер.
 *
 * Разделение ролей (server/sql/app-role.sql) — договорённость, которую
 * легко забыть применить на новом окружении. Поэтому сервер проверяет её
 * сам при каждом старте и говорит, если работает ролью с лишними правами.
 *
 * Не падаем, а предупреждаем: сервер с избыточными правами работает
 * правильно, просто хуже защищён. Уронить деплой из-за этого — хуже,
 * чем громко сказать в логах.
 */
export type RuntimePrivileges = {
  role: string;
  mayCreateInPublic: boolean;
  seesMigrationJournal: boolean;
  isSuperuser: boolean;
};

export async function checkRuntimePrivileges(db: Database): Promise<RuntimePrivileges> {
  const result = await db.execute<{
    role: string;
    may_create: boolean;
    sees_journal: boolean;
    is_superuser: boolean;
  }>(sql`
    select
      current_user                                              as role,
      has_schema_privilege(current_user, 'public', 'CREATE')     as may_create,
      coalesce(
        (select has_schema_privilege(current_user, 'drizzle', 'USAGE')
         where exists (select 1 from pg_namespace where nspname = 'drizzle')),
        false
      )                                                         as sees_journal,
      coalesce((select rolsuper from pg_roles where rolname = current_user), false)
                                                                as is_superuser
  `);

  const row = result.rows[0];
  return {
    role: row?.role ?? 'unknown',
    mayCreateInPublic: row?.may_create ?? false,
    seesMigrationJournal: row?.sees_journal ?? false,
    isSuperuser: row?.is_superuser ?? false,
  };
}

export async function reportRuntimePrivileges(
  db: Database,
  log: Logger,
  isProduction: boolean,
): Promise<void> {
  let privileges: RuntimePrivileges;
  try {
    privileges = await checkRuntimePrivileges(db);
  } catch (err) {
    log.warn('не удалось проверить права роли', {
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const excessive =
    privileges.mayCreateInPublic || privileges.seesMigrationJournal || privileges.isSuperuser;

  if (!excessive) {
    log.info('права роли в порядке: только работа со строками', { role: privileges.role });
    return;
  }

  // В проде это заметный недосмотр, локально — обычное дело.
  const level = isProduction ? 'warn' : 'debug';
  log[level]('сервер работает ролью с избыточными правами', {
    role: privileges.role,
    mayCreateInPublic: privileges.mayCreateInPublic,
    seesMigrationJournal: privileges.seesMigrationJournal,
    isSuperuser: privileges.isSuperuser,
    fix: 'server/sql/app-role.sql — завести bruteforce_app и указать её в DATABASE_URL',
  });
}
