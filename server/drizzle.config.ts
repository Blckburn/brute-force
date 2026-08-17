import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit generate работает офлайн: он сравнивает схему в коде
 * с журналом уже сгенерированных миграций и пишет новый SQL-файл.
 * Соединение с БД нужно только на этапе применения (src/db/migrate.ts).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
