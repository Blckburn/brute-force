-- Роль приложения: ПРАВА.
--
-- Две роли вместо одной:
--
--   ВЛАДЕЛЕЦ (на Neon это neondb_owner) — накатывает миграции. Умеет DDL:
--   CREATE, ALTER, DROP. Используется ТОЛЬКО командой db:migrate,
--   строка подключения — MIGRATE_DATABASE_URL.
--
--   extramundum_app — работает в рантайме. Умеет читать и менять СТРОКИ
--   и больше ничего. Используется серверным процессом, строка
--   подключения — DATABASE_URL.
--
-- Зачем: ошибка в серверном коде или уязвимость в зависимости не должны
-- давать возможность снести таблицу или переписать журнал миграций.
-- Рантайму DDL не нужен ни для чего, а значит его быть не должно.
--
-- Почему не RLS: RLS нужен, когда клиенту дают писать в БД напрямую
-- и его надо ограничить. Мы решили не давать (ADR 0001). У клиента нет
-- ни роли, ни строки подключения — ограничивать нечего.
--
-- ─────────────────────────────────────────────────────────────────────
-- ПОРЯДОК ДЕЙСТВИЙ НА NEON
--
-- 1. Neon Console → Roles → New Role → имя extramundum_app.
--    Пароль генерирует Neon и показывает один раз — скопируйте сразу.
--    Через SQL роль там не завести: управление ролями вынесено в панель,
--    у владельца базы прав на роли нет (permission denied to alter role).
--    Поэтому server/sql/app-role-create.sql на Neon НЕ выполняется.
--
-- 2. Накатите миграции владельцем: MIGRATE_DATABASE_URL=<строка
--    neondb_owner> pnpm db:migrate. Гранты ниже выдаются на уже
--    существующие таблицы, так что порядок именно такой.
--
-- 3. Neon Console → SQL Editor (он подключается владельцем) → вставьте
--    ЭТОТ файл целиком и выполните. Пароля здесь нет, подставлять нечего.
--
-- 4. Выполните проверочные запросы в конце файла и сверьте с ожидаемым.
--
-- 5. Render → extramundum-server → Environment:
--      DATABASE_URL         = строка extramundum_app, хост С «-pooler»
--      MIGRATE_DATABASE_URL = строка neondb_owner, хост БЕЗ «-pooler»
--    Сохранение запускает редеплой. В логах старта должно появиться
--    «права роли в порядке: только работа со строками».
--
-- Файл идемпотентен: повторный запуск ничего не ломает, и запускать его
-- повторно — нормальная реакция на «кажется, прошло не всё».
-- Новые миграции его повторного запуска не требуют: ALTER DEFAULT
-- PRIVILEGES ниже закрывает и будущие таблицы тоже.
-- ─────────────────────────────────────────────────────────────────────

-- 0. Без роли всё остальное упадёт двенадцатью невнятными ошибками.
--    Одна внятная лучше.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'extramundum_app') THEN
    RAISE EXCEPTION 'роли extramundum_app нет. На Neon заведите её в консоли (Roles → New Role), в своём кластере — файлом server/sql/app-role-create.sql';
  END IF;
END
$$;

-- 1. Диагностика, ничего не меняющая.
--
--    Роль, заведённая через консоль Neon, получает членство в
--    neon_superuser, а с ним pg_read_all_data и pg_write_all_data.
--    Снять членство отсюда нельзя: это управление ролями, а на Neon
--    оно отклоняется (permission denied to alter role) — попытка
--    завалила бы весь файл. Она живёт в app-role-create.sql, который
--    на Neon не выполняется.
--
--    Что это значит на практике: DDL и TRUNCATE роли всё равно
--    недоступны — pg_write_all_data даёт только INSERT/UPDATE/DELETE
--    по строкам. Открытым остаётся журнал миграций, и он закрывается
--    пунктом 5 ниже.
--
--    Блок только печатает, что унаследовано, чтобы это было видно
--    в выводе, а не выяснялось потом.
DO $$
DECLARE inherited text;
BEGIN
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO inherited
  FROM pg_roles r
  WHERE r.rolname IN ('neon_superuser', 'pg_read_all_data', 'pg_write_all_data')
    AND pg_has_role('extramundum_app', r.oid, 'MEMBER');

  IF inherited IS NULL THEN
    RAISE NOTICE 'extramundum_app не состоит в широких ролях — права заданы только этим файлом';
  ELSE
    RAISE NOTICE 'extramundum_app наследует права от: %. Снять их отсюда нельзя, журнал миграций закрывается построчной защитой ниже.', inherited;
  END IF;
END
$$;

-- 2. Схема public: видеть можно, создавать в ней — нет.
--    Без CREATE роль не заведёт свою таблицу и не подменит существующую.
GRANT USAGE ON SCHEMA public TO extramundum_app;
REVOKE CREATE ON SCHEMA public FROM extramundum_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 3. Ровно те права, которые нужны серверу: работа со строками.
--    Ни TRUNCATE, ни REFERENCES, ни TRIGGER.
--
--    REVOKE перед GRANT: файл мог запускаться раньше в другой редакции
--    или с более широким набором прав. Без него лишнее право, выданное
--    прошлым запуском, останется навсегда — «идемпотентно» означает
--    «после запуска состояние заданное», а не «команды не упали».
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM extramundum_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO extramundum_app;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM extramundum_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO extramundum_app;

-- ALL TYPES IN SCHEMA не существует как синтаксис, поэтому перебором.
-- Нужно из-за перечислений (zone, rarity, run_state и прочих).
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT n.nspname, ty.typname
    FROM pg_type ty
    JOIN pg_namespace n ON n.oid = ty.typnamespace
    WHERE n.nspname = 'public' AND ty.typtype = 'e'
  LOOP
    EXECUTE format('GRANT USAGE ON TYPE %I.%I TO extramundum_app', t.nspname, t.typname);
  END LOOP;
END
$$;

-- 4. То же самое для таблиц, которые появятся в следующих миграциях.
--    Иначе после каждой миграции пришлось бы вспоминать про этот файл.
--    ALTER DEFAULT PRIVILEGES перезаписывает набор для своей цели
--    целиком, так что повторный запуск не накапливает лишнего.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO extramundum_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO extramundum_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON TYPES TO extramundum_app;

-- 5. Журнал миграций закрыт полностью. Рантайм не должен уметь ни читать
--    его, ни тем более править: переписанный журнал = миграции применятся
--    заново или не применятся вовсе.
--
--    Схемы drizzle нет до первой миграции — на чистой базе блок молчит.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    RAISE NOTICE 'схемы drizzle нет: миграции ещё не накатывались. Накатите их и запустите этот файл ещё раз.';
    RETURN;
  END IF;

  REVOKE ALL ON SCHEMA drizzle FROM extramundum_app;
  REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
  REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM extramundum_app;
  REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC;

  -- REVOKE выше не работает против прав, полученных через членство
  -- в роли: pg_write_all_data даёт доступ мимо грантов на объект,
  -- и отозвать его на уровне таблицы нельзя.
  --
  -- Зато pg_read_all_data и pg_write_all_data построчную защиту НЕ
  -- обходят, а владелец таблицы ей не подчиняется, пока не включён
  -- FORCE. Поэтому RLS без единой политики = «журнал виден и правим
  -- только владельцу». Мигратор ходит владельцем, ему всё равно.
  --
  -- Отсутствие политик здесь не забывчивость, а сам запрет.
  -- Причина решения — docs/adr/0002-rls-na-zhurnale.md.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'drizzle' AND c.relname = '__drizzle_migrations'
  ) THEN
    ALTER TABLE drizzle.__drizzle_migrations ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- ПРОВЕРКА. Выполните после применения — ожидаемый результат в комментарии.
-- ─────────────────────────────────────────────────────────────────────

-- Должно вернуть по строке на таблицу с SELECT/INSERT/UPDATE/DELETE
-- и НИ ОДНОЙ строки с TRUNCATE / REFERENCES / TRIGGER:
--
--   select table_name, string_agg(privilege_type, ', ' order by privilege_type)
--   from information_schema.role_table_grants
--   where grantee = 'extramundum_app' and table_schema = 'public'
--   group by table_name order by table_name;

-- may_create и may_write_journal должны быть false. is_neon_superuser
-- на Neon останется true — это ограничение хостинга, а не ошибка
-- применения: важно не членство само по себе, а что оно уже никуда
-- не ведёт.
--
--   select
--     has_schema_privilege('extramundum_app', 'public', 'CREATE')  as may_create,
--     has_table_privilege('extramundum_app', 'drizzle.__drizzle_migrations', 'INSERT')
--       and not (select relrowsecurity
--                from pg_class
--                where oid = 'drizzle.__drizzle_migrations'::regclass) as may_write_journal,
--     pg_has_role('extramundum_app', 'neon_superuser', 'MEMBER')   as is_neon_superuser;
