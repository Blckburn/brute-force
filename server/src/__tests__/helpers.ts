import { fileURLToPath } from 'node:url';

import type { Hono } from 'hono';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createApp } from '../app.ts';
import { loadConfig, type Config } from '../config.ts';
import { createDatabase, type Database } from '../db/client.ts';
import { createLogger } from '../logger.ts';
import type { AppEnv } from '../http/middleware.ts';

/**
 * Обвязка для интеграционных тестов.
 *
 * Тесты ходят в НАСТОЯЩИЙ Postgres и поднимают НАСТОЯЩЕЕ приложение —
 * без моков БД и без подмены Better Auth. Мок здесь бесполезен: проверять
 * надо ровно то, что стоит между клиентом и базой, а мок это и выкидывает.
 *
 * Локально: pnpm db:local:up, затем
 *   DATABASE_URL=postgres://postgres@127.0.0.1:55432/extramundum pnpm test
 * В CI база поднимается сервисом postgres:16.
 */

export type TestContext = {
  app: Hono<AppEnv>;
  db: Database;
  close: () => Promise<void>;
};

export function databaseUrl(): string | undefined {
  return process.env['DATABASE_URL'];
}

export async function createTestContext(): Promise<TestContext> {
  const url = databaseUrl();
  if (url === undefined) throw new Error('DATABASE_URL не задан');

  const config: Config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    // Секрет фиксированный и заведомо тестовый: он никуда не уезжает,
    // а плавающее значение ломало бы проверку куки между запросами.
    BETTER_AUTH_SECRET: 'integration-test-secret-value-32-chars-min',
    BETTER_AUTH_URL: 'http://localhost',
    CORS_ORIGINS: 'http://localhost',
    LOG_LEVEL: 'error',
  });

  const { db, pool } = createDatabase(config.DATABASE_URL);

  // Миграции применяет сам тест: так порядок шагов в CI не важен,
  // и локальный прогон не требует помнить про отдельную команду.
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });

  const log = createLogger('error', {}, () => {});
  const app = createApp(db, config, log);

  return { app, db, close: () => pool.end() };
}

/** Уникальный суффикс, чтобы прогоны не спотыкались друг о друга. */
export function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Минимальный «браузер»: помнит куки между запросами.
 * Сессия живёт в httpOnly-куке, без её переноса проверить вход нельзя.
 */
export class CookieJar {
  private cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';', 1)[0];
      if (pair === undefined) continue;
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get isEmpty(): boolean {
    return this.cookies.size === 0;
  }
}

export type Json = Record<string, unknown>;

/** POST с телом JSON и переносом кук. */
export async function post(
  ctx: TestContext,
  path: string,
  body: unknown,
  jar?: CookieJar,
): Promise<{ status: number; body: Json }> {
  const response = await ctx.app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jar && !jar.isEmpty ? { Cookie: jar.header() } : {}),
    },
    body: JSON.stringify(body),
  });

  jar?.absorb(response);
  return { status: response.status, body: await readJson(response) };
}

export async function get(
  ctx: TestContext,
  path: string,
  jar?: CookieJar,
): Promise<{ status: number; body: Json }> {
  const response = await ctx.app.request(path, {
    headers: jar && !jar.isEmpty ? { Cookie: jar.header() } : {},
  });

  jar?.absorb(response);
  return { status: response.status, body: await readJson(response) };
}

async function readJson(response: Response): Promise<Json> {
  const text = await response.text();
  if (text === '') return {};
  try {
    return JSON.parse(text) as Json;
  } catch {
    return { _raw: text };
  }
}

/** Регистрирует игрока и возвращает его куки. */
export async function register(
  ctx: TestContext,
  overrides: Partial<{ email: string; password: string; username: string }> = {},
): Promise<{ jar: CookieJar; username: string; email: string; status: number; body: Json }> {
  const suffix = unique();
  const email = overrides.email ?? `player-${suffix}@example.com`;
  const username = overrides.username ?? `Игрок${suffix}`;
  const password = overrides.password ?? 'correct-horse-battery';

  const jar = new CookieJar();
  const { status, body } = await post(ctx, '/auth/register', { email, password, username }, jar);

  return { jar, username, email, status, body };
}
