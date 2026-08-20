import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../../config.ts';
import { reportRuntimePrivileges, type RuntimePrivileges } from '../privileges.ts';
import type { Database } from '../client.ts';
import type { Logger } from '../../logger.ts';

/**
 * Принятые исключения в проверке прав.
 *
 * Смысл механизма: известный и осознанно принятый риск не должен
 * выглядеть как инцидент, а неизвестный — должен. Проверка при старте
 * стоит на том, что ей верят; постоянно горящее верное предупреждение
 * это доверие и уничтожает.
 *
 * Тесты держат обе половины. Забыть про вторую опаснее: механизм,
 * который умеет только молчать, — это выключенная проверка.
 */

type Captured = { level: string; msg: string; fields: Record<string, unknown> };

function fakeLogger(sink: Captured[]): Logger {
  const at =
    (level: string) =>
    (msg: string, fields: Record<string, unknown> = {}): void => {
      sink.push({ level, msg, fields });
    };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') } as Logger;
}

/** База не нужна: подменяется только результат запроса о правах. */
function dbReturning(p: RuntimePrivileges): Database {
  return {
    execute: vi.fn().mockResolvedValue({
      rows: [
        {
          role: p.role,
          may_create: p.mayCreateInPublic,
          may_write_journal: p.mayWriteMigrationJournal,
          is_superuser: p.isSuperuser,
        },
      ],
    }),
  } as unknown as Database;
}

const clean: RuntimePrivileges = {
  role: 'extramundum_app',
  mayCreateInPublic: false,
  mayWriteMigrationJournal: false,
  isSuperuser: false,
};

const journalOpen: RuntimePrivileges = { ...clean, mayWriteMigrationJournal: true };
const ddlOpen: RuntimePrivileges = { ...clean, mayCreateInPublic: true };

async function run(
  p: RuntimePrivileges,
  accepted: readonly 'migration-journal'[] = [],
): Promise<Captured[]> {
  const sink: Captured[] = [];
  await reportRuntimePrivileges(dbReturning(p), fakeLogger(sink), true, accepted);
  return sink;
}

const warnings = (sink: Captured[]): Captured[] =>
  sink.filter((r) => r.msg === 'сервер работает ролью с избыточными правами');

describe('отчёт о правах роли', () => {
  it('чистая роль: предупреждения нет, исключений ноль', async () => {
    const sink = await run(clean);

    expect(warnings(sink)).toHaveLength(0);
    expect(sink[0]?.msg).toBe('права роли проверены');
    expect(sink[0]?.fields['acceptedExceptions']).toBe(0);
  });

  it('журнал открыт и это принято: молчит, но факт виден в строке отчёта', async () => {
    const sink = await run(journalOpen, ['migration-journal']);

    expect(warnings(sink)).toHaveLength(0);
    expect(sink[0]?.fields['acceptedExceptions']).toBe(1);
    expect(sink[0]?.fields['accepted']).toEqual(['migration-journal']);
    expect(sink[0]?.fields['see']).toBe('ADR 0002');
  });

  it('журнал открыт, но НЕ принят: предупреждение печатается', async () => {
    const sink = await run(journalOpen, []);

    const [w] = warnings(sink);
    expect(w).toBeDefined();
    expect(w?.level).toBe('warn');
    expect(w?.fields['excessive']).toEqual(['mayWriteMigrationJournal']);
  });

  it('DDL у рантайма кричит даже при объявленных исключениях', async () => {
    const sink = await run({ ...ddlOpen, mayWriteMigrationJournal: true }, ['migration-journal']);

    const [w] = warnings(sink);
    expect(w?.level).toBe('warn');
    // Принятое исключение не должно утащить за собой жёсткий сигнал.
    expect(w?.fields['excessive']).toEqual(['mayCreateInPublic']);
  });

  it('суперпользователь кричит: принять это нельзя никаким значением', async () => {
    const sink = await run({ ...clean, isSuperuser: true }, ['migration-journal']);

    expect(warnings(sink)[0]?.fields['excessive']).toEqual(['isSuperuser']);
  });
});

describe('DB_PRIVILEGE_EXCEPTIONS', () => {
  const base = {
    DATABASE_URL: 'postgres://user@localhost:5432/db',
    BETTER_AUTH_SECRET: 'test-secret-value-at-least-32-characters',
    BETTER_AUTH_URL: 'https://server.example.com',
    NODE_ENV: 'test',
  };

  it('по умолчанию пусто', () => {
    expect(loadConfig({ ...base }).DB_PRIVILEGE_EXCEPTIONS).toEqual([]);
  });

  it('разбирает список и убирает повторы', () => {
    const config = loadConfig({
      ...base,
      DB_PRIVILEGE_EXCEPTIONS: ' migration-journal , migration-journal ',
    });
    expect(config.DB_PRIVILEGE_EXCEPTIONS).toEqual(['migration-journal']);
  });

  it('неизвестное имя валит старт, а не возвращает шум молчанием', () => {
    expect(() => loadConfig({ ...base, DB_PRIVILEGE_EXCEPTIONS: 'migrationjournal' })).toThrow();
  });
});
