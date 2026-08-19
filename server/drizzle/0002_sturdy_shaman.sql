-- Номера изгнанных. LORE §2, GDD §1.
--
-- Тело миграции написано вручную: автоматическое ADD COLUMN ... GENERATED
-- ALWAYS AS IDENTITY заполнило бы существующие строки в порядке, в котором
-- Postgres их читает с диска. Порядок номеров — часть смысла: маленький
-- номер значит, что человек снаружи давно. Поэтому существующие аккаунты
-- нумеруются по created_at, и только потом колонка становится identity.

ALTER TABLE "players" ADD COLUMN "exile_number" integer;--> statement-breakpoint

-- Существующим аккаунтам — номера по времени регистрации.
-- id в сортировке вторым ключом: created_at может совпасть до микросекунды,
-- и без него порядок был бы недетерминированным.
UPDATE "players" AS p
SET "exile_number" = numbered.rn
FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
  FROM "players"
) AS numbered
WHERE p."id" = numbered."id";--> statement-breakpoint

ALTER TABLE "players" ALTER COLUMN "exile_number" SET NOT NULL;--> statement-breakpoint

-- Дальше номера выдаёт последовательность внутри БД. Атомарно: две
-- одновременные регистрации не могут получить один номер. ALWAYS, а не
-- BY DEFAULT — вставить номер извне нельзя даже из серверного кода.
ALTER TABLE "players" ALTER COLUMN "exile_number" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint

-- Продолжить с числа, следующего за максимальным выданным.
SELECT setval(
  pg_get_serial_sequence('players', 'exile_number'),
  COALESCE((SELECT MAX("exile_number") FROM "players"), 0) + 1,
  false
);--> statement-breakpoint

ALTER TABLE "players" ADD CONSTRAINT "players_exile_number_unique" UNIQUE("exile_number");
