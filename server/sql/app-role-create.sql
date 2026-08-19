-- Роль приложения: СОЗДАНИЕ.
--
-- Вторая половина — server/sql/app-role-grants.sql. Разделены потому, что
-- на управляемом хостинге эти две половины выполняют разные люди в разных
-- местах, и объединённый файл там не проходит целиком.
--
-- ─────────────────────────────────────────────────────────────────────
-- НА NEON ЭТОТ ФАЙЛ НЕ ВЫПОЛНЯЕТСЯ.
--
-- Управление ролями там вынесено в панель, у владельца базы прав на роли
-- нет. Попытка даёт:
--
--     permission denied to alter role (SQLSTATE 42501)
--
-- На Neon роль заводится в консоли: Roles → New Role → extramundum_app.
-- Пароль генерирует Neon, показывает один раз, в репозиторий он не
-- попадает (инвариант 7). После этого — app-role-grants.sql.
-- ─────────────────────────────────────────────────────────────────────
--
-- Этот файл нужен там, где кластер наш: локальный Postgres, CI,
-- self-hosted. Выполнять владельцем базы, затем app-role-grants.sql.
--
-- 1. Замените ЗАМЕНИТЕ_МЕНЯ ниже на длинный случайный пароль.
--    Сгенерировать:  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
-- 2. psql "<строка владельца>" -f server/sql/app-role-create.sql
-- 3. psql "<строка владельца>" -f server/sql/app-role-grants.sql
--
-- Пароль в этот файл не коммитится (инвариант 7).

-- CREATE ROLE не имеет IF NOT EXISTS, поэтому через DO-блок.
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
-- На Neon эквивалент задан панелью: роль из консоли не суперпользователь.
ALTER ROLE extramundum_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Членство в neon_superuser. Живёт здесь, а не в app-role-grants.sql,
-- потому что это управление ролями: на Neon такая команда отклоняется,
-- и в файле грантов она валила бы весь файл целиком.
--
-- Роль из консоли Neon получает это членство, а с ним pg_read_all_data
-- и pg_write_all_data. Снять его может только тот, у кого есть ADMIN
-- OPTION на neon_superuser, — у владельца базы его нет. Поэтому на Neon
-- членство остаётся, и журнал миграций закрывается иначе: построчной
-- защитой, см. app-role-grants.sql и docs/adr/0002-rls-na-zhurnale.md.
--
-- Там, где кластер наш, членства просто не существует и блок молчит.
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
    RAISE NOTICE 'членство в neon_superuser снять не удалось: нужен ADMIN OPTION на эту роль.';
END
$$;
