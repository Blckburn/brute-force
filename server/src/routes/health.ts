import { API_ROUTES } from '@bruteforce/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Database } from '../db/client.ts';
import type { AppEnv } from '../http/middleware.ts';

/**
 * Health-check для Render.
 *
 * Проверяет и живость процесса, и доступность БД: сервер, который
 * поднялся, но не видит базу, здоровым не является.
 */
export function healthRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get(API_ROUTES.health, async (c) => {
    try {
      await db.execute(sql`select 1`);
    } catch (err) {
      c.get('log').error('health-check: БД недоступна', {
        detail: err instanceof Error ? err.message : String(err),
      });
      return c.json({ status: 'degraded', database: 'down' } as const, 503);
    }

    return c.json({ status: 'ok', database: 'up' } as const);
  });

  return app;
}
