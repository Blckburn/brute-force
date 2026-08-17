-- Права роли приложения.
--
-- Инвариант 1: клиент никогда не пишет в БД. В этой архитектуре он туда
-- вообще не ходит — у браузера нет ни строки подключения, ни роли.
-- Единственная роль, которая касается базы, — та, под которой работает
-- серверный процесс, и её права ограничены здесь.
--
-- Почему не RLS: RLS нужен, когда клиенту дают писать напрямую и его надо
-- ограничить. Мы решили не давать (ADR 0001). RLS свёлся бы к «клиенту
-- всё запрещено» и оставил бы соблазн сделать исключение — ровно так
-- появилась дыра v1.0.
--
-- Применяется ПОСЛЕ миграций:
--   psql "$DATABASE_URL" -v app_role=bruteforce_app -f server/sql/grants.sql
--
-- На Neon имя роли задаётся при её создании в консоли; передайте его
-- через -v app_role=<имя>.

\if :{?app_role}
\else
  \set app_role 'bruteforce_app'
\endif

\echo 'Настраиваю права для роли:' :'app_role'

-- Роль видит схему, но не может создавать в ней объекты: миграции
-- накатываются отдельной, более полномочной ролью (владельцем).
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";

-- Ровно те права, которые нужны серверу для работы: читать и менять
-- строки. Ни CREATE, ни DROP, ни TRUNCATE, ни ALTER.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- Те же права на таблицы, которые появятся в следующих миграциях,
-- иначе после каждой миграции пришлось бы вспоминать про этот файл.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- Явный отзыв прав на журнал миграций: сервер не должен уметь
-- переписать историю применённых миграций.
REVOKE INSERT, UPDATE, DELETE ON drizzle.__drizzle_migrations FROM :"app_role";

\echo 'Готово. Проверить выданные права:'
\echo '  select grantee, table_name, privilege_type from information_schema.role_table_grants'
\echo "  where grantee = '" :app_role "';"
