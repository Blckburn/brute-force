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
