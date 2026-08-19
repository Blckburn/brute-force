-- Роль приложения: разделение «кто накатывает схему» и «кто работает».
--
-- Две роли вместо одной:
--
--   ВЛАДЕЛЕЦ (на Neon это neondb_owner) — накатывает миграции. Умеет DDL:
--   CREATE, ALTER, DROP. Используется ТОЛЬКО командой db:migrate.
--
--   extramundum_app — работает в рантайме. Умеет читать и менять СТРОКИ
--   и больше ничего. Используется серверным процессом.
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
-- КАК ПРИМЕНЯТЬ
--
-- 1. Замените ЗАМЕНИТЕ_МЕНЯ ниже на длинный случайный пароль.
--    Сгенерировать:  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
-- 2. Выполните этот файл В КАЧЕСТВЕ ВЛАДЕЛЬЦА базы:
--      Neon → SQL Editor (он подключается владельцем), вставить целиком;
--      либо  psql "<строка владельца>" -f server/sql/app-role.sql
-- 3. Запускать ПОСЛЕ миграций и ПОВТОРНО после каждой новой миграции,
--    которая добавляет таблицы — впрочем, ALTER DEFAULT PRIVILEGES ниже
--    закрывает и будущие таблицы тоже.
-- 4. Файл идемпотентен: повторный запуск ничего не ломает.
--
-- Пароль в этот файл не коммитится (инвариант 7).
-- ─────────────────────────────────────────────────────────────────────

-- 1. Роль. CREATE ROLE не имеет IF NOT EXISTS, поэтому через DO-блок.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'extramundum_app') THEN
    CREATE ROLE extramundum_app WITH LOGIN PASSWORD 'ЗАМЕНИТЕ_МЕНЯ';
  ELSE
    ALTER ROLE extramundum_app WITH LOGIN PASSWORD 'ЗАМЕНИТЕ_МЕНЯ';
  END IF;
END
$$;

-- Роль не должна уметь создавать базы и другие роли.
ALTER ROLE extramundum_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Роль, заведённая через ИНТЕРФЕЙС Neon, автоматически получает членство
-- в neon_superuser, а вместе с ним — все права на public. Разделение ролей
-- при этом не даёт ничего: рантайм снова умеет DDL. NOSUPERUSER выше это
-- членство не снимает, оно снимается только REVOKE.
--
-- Роль, заведённая этим файлом, членства не получает, и блок ничего не
-- делает. Он здесь ради второго случая: роль уже завели через интерфейс.
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
    RAISE NOTICE 'не удалось снять членство в neon_superuser: не хватает прав. Удалите роль в интерфейсе Neon и заведите её этим файлом.';
END
$$;

-- 2. Схема public: видеть можно, создавать в ней — нет.
--    Без CREATE роль не заведёт свою таблицу и не подменит существующую.
GRANT USAGE ON SCHEMA public TO extramundum_app;
REVOKE CREATE ON SCHEMA public FROM extramundum_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 3. Ровно те права, которые нужны серверу: работа со строками.
--    Ни TRUNCATE, ни REFERENCES, ни TRIGGER.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO extramundum_app;
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO extramundum_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO extramundum_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON TYPES TO extramundum_app;

-- 5. Журнал миграций закрыт полностью. Рантайм не должен уметь ни читать
--    его, ни тем более править: переписанный журнал = миграции применятся
--    заново или не применятся вовсе.
REVOKE ALL ON SCHEMA drizzle FROM extramundum_app;
REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM extramundum_app;
REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC;

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

-- Должно вернуть false, false, false:
--
--   select
--     has_schema_privilege('extramundum_app', 'public', 'CREATE') as may_create,
--     has_schema_privilege('extramundum_app', 'drizzle', 'USAGE') as sees_migrations,
--     pg_has_role('extramundum_app', 'neon_superuser', 'MEMBER')  as is_superuser;
