import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../client.ts';
import { checkRuntimePrivileges } from '../privileges.ts';

/**
 * Журнал миграций и роль рантайма. ADR 0002.
 *
 * Механика такая: на управляемом хостинге роль рантайма наследует
 * pg_write_all_data, отозвать это грантом на таблицу нельзя, и журнал
 * применённых миграций оказывается доступен на запись. Стёртый журнал
 * означает ручной разбор на живом стенде: таблицы есть, записи о них нет,
 * следующая миграция падает на «уже существует».
 *
 * Закрывается построчной защитой без единой политики — её эти роли
 * не обходят, а владелец таблицы ей не подчиняется.
 *
 * Тест воспроизводит обе стороны: что без защиты журнал действительно
 * стирается, и что с защитой не стирается. Проверка только второй
 * половины ничего не доказывала бы — она проходила бы и на роли,
 * у которой прав не было изначально.
 */

const GRANTS_SQL = readFileSync(
  fileURLToPath(new URL('../../../sql/app-role-grants.sql', import.meta.url)),
  'utf8',
);

/**
 * Тесты выше проверяют, что защита работает, когда она включена. Включает
 * её на новом окружении человек, запуская app-role-grants.sql, — значит
 * исчезновение строки оттуда не поймает ни один из них. Ловится здесь.
 */
it('app-role-grants.sql включает защиту журнала', () => {
  expect(GRANTS_SQL).toMatch(
    /alter\s+table\s+drizzle\.__drizzle_migrations\s+enable\s+row\s+level\s+security/i,
  );
});

/**
 * На Neon управление ролями отклоняется, и одна такая команда роняет весь
 * файл — вместе со всеми правами после неё. Поэтому их там быть не должно.
 */
it('в app-role-grants.sql нет команд управления ролями', () => {
  const withoutComments = GRANTS_SQL.replace(/^\s*--.*$/gm, '');

  expect(withoutComments).not.toMatch(/\bcreate\s+role\b/i);
  expect(withoutComments).not.toMatch(/\balter\s+role\b/i);
  expect(withoutComments).not.toMatch(/\bdrop\s+role\b/i);
  // GRANT/REVOKE роли роли: «revoke neon_superuser from …», без ON.
  expect(withoutComments).not.toMatch(/\brevoke\s+\w+\s+from\s+extramundum_app\b/i);
});

const DB_URL = process.env['DATABASE_URL'];
const TEST_ROLE = 'extramundum_privilege_test';
const TEST_PASSWORD = 'privilege-test-only';

/** Та же база, но под другой ролью: проверять права можно только изнутри. */
function urlForRole(base: string, role: string, password: string): string {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  return url.toString();
}

describe.skipIf(DB_URL === undefined)('журнал миграций закрыт от роли рантайма', () => {
  let owner: ReturnType<typeof createDatabase>;
  let runtime: ReturnType<typeof createDatabase>;
  let enabled = false;

  beforeAll(async () => {
    owner = createDatabase(DB_URL as string);

    // Журнал должен существовать: без миграций проверять нечего.
    await migrate(owner.db, {
      migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url)),
    });

    // Роль заводится тестом, а не берётся из окружения: тест обязан быть
    // воспроизводим на чистой базе и не зависеть от того, применяли ли
    // на ней app-role-grants.sql.
    const canManageRoles = await owner.db.execute<{ ok: boolean }>(sql`
      select coalesce(rolsuper or rolcreaterole, false) as ok
      from pg_roles where rolname = current_user
    `);
    if (canManageRoles.rows[0]?.ok !== true) return;

    await owner.db.execute(sql`
      drop role if exists ${sql.identifier(TEST_ROLE)}
    `);
    await owner.db.execute(
      sql`create role ${sql.identifier(TEST_ROLE)} login password ${sql.raw(`'${TEST_PASSWORD}'`)}`,
    );
    // Ровно то, что даёт членство в neon_superuser на Neon.
    await owner.db.execute(
      sql`grant pg_read_all_data, pg_write_all_data to ${sql.identifier(TEST_ROLE)}`,
    );

    runtime = createDatabase(urlForRole(DB_URL as string, TEST_ROLE, TEST_PASSWORD));
    enabled = true;
  }, 60_000);

  afterAll(async () => {
    await runtime?.pool.end();
    if (owner !== undefined && enabled) {
      await owner.db.execute(
        sql`alter table drizzle.__drizzle_migrations enable row level security`,
      );
      await owner.db.execute(sql`drop owned by ${sql.identifier(TEST_ROLE)}`);
      await owner.db.execute(sql`drop role if exists ${sql.identifier(TEST_ROLE)}`);
    }
    await owner?.pool.end();
  });

  async function setRowLevelSecurity(on: boolean): Promise<void> {
    await owner.db.execute(
      sql.raw(
        `alter table drizzle.__drizzle_migrations ${on ? 'enable' : 'disable'} row level security`,
      ),
    );
  }

  async function journalRowsSeenByRuntime(): Promise<number> {
    const seen = await runtime.db.execute<{ n: string }>(
      sql`select count(*)::text as n from drizzle.__drizzle_migrations`,
    );
    return Number(seen.rows[0]?.n ?? '-1');
  }

  it.runIf(true)('без защиты журнал роли доступен — иначе тест ниже ничего не значит', async () => {
    if (!enabled) return;

    await setRowLevelSecurity(false);

    expect(await journalRowsSeenByRuntime()).toBeGreaterThan(0);

    const privileges = await checkRuntimePrivileges(runtime.db);
    expect(privileges.mayWriteMigrationJournal).toBe(true);
  });

  it('с защитой журнал не виден и не стирается', async () => {
    if (!enabled) return;

    await setRowLevelSecurity(true);

    expect(await journalRowsSeenByRuntime()).toBe(0);

    // Главное: DELETE выполняется без ошибки, но не трогает ни строки.
    await runtime.db.execute(sql`delete from drizzle.__drizzle_migrations`);

    const left = await owner.db.execute<{ n: string }>(
      sql`select count(*)::text as n from drizzle.__drizzle_migrations`,
    );
    expect(Number(left.rows[0]?.n ?? '0')).toBeGreaterThan(0);

    await expect(
      runtime.db.execute(
        sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('poison', 1)`,
      ),
    ).rejects.toThrow();
  });

  it('проверка при старте видит защиту, а не только гранты', async () => {
    if (!enabled) return;

    await setRowLevelSecurity(true);

    const privileges = await checkRuntimePrivileges(runtime.db);

    // Гранта на таблицу у роли нет и не было — доступ приходил членством
    // в роли. Если бы проверка смотрела на гранты, она бы врала в обе
    // стороны: молчала бы без защиты и молчала бы с ней.
    expect(privileges.role).toBe(TEST_ROLE);
    expect(privileges.mayWriteMigrationJournal).toBe(false);
    expect(privileges.isSuperuser).toBe(false);
  });

  it('владелец продолжает читать и писать журнал', async () => {
    if (!enabled) return;

    await setRowLevelSecurity(true);

    const before = await owner.db.execute<{ n: string }>(
      sql`select count(*)::text as n from drizzle.__drizzle_migrations`,
    );
    expect(Number(before.rows[0]?.n ?? '0')).toBeGreaterThan(0);

    // Мигратор дописывает записи в журнал — защита не должна ему мешать.
    await owner.db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('rls-test', 1)`,
    );
    await owner.db.execute(sql`delete from drizzle.__drizzle_migrations where hash = 'rls-test'`);
  });
});
