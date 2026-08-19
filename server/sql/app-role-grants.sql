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

-- 1. Роль, заведённая через ИНТЕРФЕЙС Neon, автоматически получает
--    членство в neon_superuser, а вместе с ним — все права на public.
--    Разделение ролей при этом не даёт ничего: рантайм снова умеет DDL.
--
--    Снять членство может только тот, у кого есть ADMIN OPTION на
--    neon_superuser. У владельца базы его может не быть — тогда блок
--    напечатает NOTICE и пойдёт дальше, а самопроверка сервера при
--    старте продолжит сообщать про избыточные права. Это не сбой
--    скрипта, это честный отчёт о том, что хостинг такого не позволяет.
DO $$
BEGIN
  IF pg_has_role('extramundum_app', 'neon_superuser', 'MEMBER') THEN
    EXECUTE 'REVOKE neon_superuser FROM extramundum_app';
    RAISE NOTICE 'снято членство extramundum_app в neon_superuser';
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- Не Neon (локальный Postgres, CI): роли neon_superuser просто нет.
    NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'членство extramundum_app в neon_superuser снять не удалось: не хватает прав. Роль сохранит лишние права на public, сервер сообщит об этом в логе старта.';
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
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    REVOKE ALL ON SCHEMA drizzle FROM extramundum_app;
    REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
    REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM extramundum_app;
    REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC;
  ELSE
    RAISE NOTICE 'схемы drizzle нет: миграции ещё не накатывались. Накатите их и запустите этот файл ещё раз.';
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

-- Должно вернуть false, false, false. Если may_create = true при
-- is_neon_superuser = true — членство снять не удалось, см. пункт 1:
-- это ограничение хостинга, а не ошибка применения.
--
--   select
--     has_schema_privilege('extramundum_app', 'public', 'CREATE') as may_create,
--     has_schema_privilege('extramundum_app', 'drizzle', 'USAGE') as sees_migrations,
--     pg_has_role('extramundum_app', 'neon_superuser', 'MEMBER')  as is_neon_superuser;
