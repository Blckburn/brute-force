import { sql } from 'drizzle-orm';

import type { Database } from './client.ts';
import type { Logger } from '../logger.ts';

/**
 * Проверка прав роли, под которой работает сервер.
 *
 * Разделение ролей (server/sql/app-role-grants.sql) — договорённость, которую
 * легко забыть применить на новом окружении. Поэтому сервер проверяет её
 * сам при каждом старте и говорит, если работает ролью с лишними правами.
 *
 * Проверяется не набор выданных грантов, а то, что роль фактически может
 * сделать. Разница существенная: на управляемом хостинге право приходит
 * членством в широкой роли мимо грантов на объект, и проверка грантов
 * показала бы благополучие там, где его нет. Обратная ошибка не менее
 * вредна: проверка, кричащая на здоровом окружении, перестаёт читаться.
 *
 * Не падаем, а предупреждаем: сервер с избыточными правами работает
 * правильно, просто хуже защищён. Уронить деплой из-за этого — хуже,
 * чем громко сказать в логах.
 */
export type RuntimePrivileges = {
  role: string;
  mayCreateInPublic: boolean;
  mayWriteMigrationJournal: boolean;
  isSuperuser: boolean;
};

export async function checkRuntimePrivileges(db: Database): Promise<RuntimePrivileges> {
  const result = await db.execute<{
    role: string;
    may_create: boolean;
    may_write_journal: boolean;
    is_superuser: boolean;
  }>(sql`
    with journal as (
      select c.oid, c.relrowsecurity, c.relowner
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'drizzle' and c.relname = '__drizzle_migrations'
    ),
    me as (
      select oid, rolbypassrls from pg_roles where rolname = current_user
    )
    select
      current_user                                          as role,
      has_schema_privilege(current_user, 'public', 'CREATE') as may_create,
      coalesce(
        (
          -- Право на запись может прийти не грантом на таблицу, а членством
          -- в роли (на Neon это pg_write_all_data). Отозвать его на уровне
          -- объекта нельзя, поэтому смотреть на гранты недостаточно.
          --
          -- Зато построчную защиту эти роли не обходят. Значит журнал
          -- достижим, только если запись разрешена И защита выключена,
          -- либо роль владеет таблицей, либо у неё BYPASSRLS.
          select
            has_table_privilege(current_user, journal.oid, 'INSERT')
            and (
              not journal.relrowsecurity
              or journal.relowner = (select oid from me)
              or coalesce((select rolbypassrls from me), false)
            )
          from journal
        ),
        false
      )                                                     as may_write_journal,
      coalesce((select rolsuper from pg_roles where rolname = current_user), false)
                                                            as is_superuser
  `);

  const row = result.rows[0];
  return {
    role: row?.role ?? 'unknown',
    mayCreateInPublic: row?.may_create ?? false,
    mayWriteMigrationJournal: row?.may_write_journal ?? false,
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
    privileges.mayCreateInPublic || privileges.mayWriteMigrationJournal || privileges.isSuperuser;

  if (!excessive) {
    log.info('права роли в порядке: только работа со строками', { role: privileges.role });
    return;
  }

  // В проде это заметный недосмотр, локально — обычное дело.
  const level = isProduction ? 'warn' : 'debug';
  log[level]('сервер работает ролью с избыточными правами', {
    role: privileges.role,
    mayCreateInPublic: privileges.mayCreateInPublic,
    mayWriteMigrationJournal: privileges.mayWriteMigrationJournal,
    isSuperuser: privileges.isSuperuser,
    fix: 'server/sql/app-role-grants.sql — выдать extramundum_app права и указать её в DATABASE_URL',
  });
}
