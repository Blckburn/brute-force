import { API_ROUTES, type MeResponse } from '@extramundum/shared';
import { Hono } from 'hono';

import { requireSession } from '../auth/session.ts';
import type { Database } from '../db/client.ts';
import { AppError } from '../http/errors.ts';
import type { AppEnv } from '../http/middleware.ts';
import { ensurePlayer, findPlayerByUserId } from '../players/repository.ts';

/**
 * GET /me — профиль текущего игрока.
 *
 * Ключевая деталь для инварианта 1: идентификатор берётся ИЗ СЕССИИ,
 * а профиль читается ИЗ БД. В запросе нет ни одного поля, которым клиент
 * мог бы повлиять на ответ. Подменять нечего.
 */
export function meRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get(API_ROUTES.me, async (c) => {
    const sessionUser = await requireSession(c);

    let profile = await findPlayerByUserId(db, sessionUser.id);

    if (profile === null) {
      // Учётная запись есть, профиля нет — значит хук создания не довёл
      // дело до конца. Достраиваем и читаем снова.
      c.get('log').warn('профиль отсутствовал, создаю', { userId: sessionUser.id });
      await ensurePlayer(db, { userId: sessionUser.id, username: sessionUser.name });
      profile = await findPlayerByUserId(db, sessionUser.id);
    }

    if (profile === null) {
      throw new AppError('internal', { message: 'профиль не создался' });
    }

    const body: MeResponse = { player: profile };
    return c.json(body);
  });

  return app;
}
