import {
  API_ROUTES,
  battleStartInputSchema,
  simulatePreviewInputSchema,
  type SimulatePreviewResponse,
} from '@extramundum/shared';
import { Hono } from 'hono';

import { estimateWinRate } from '../battle/preview.ts';
import type { Database } from '../db/client.ts';
import { AppError, notImplemented } from '../http/errors.ts';
import { parseBody, type AppEnv } from '../http/middleware.ts';
import { findPlayerByUserId } from '../players/repository.ts';
import { requireSession } from '../auth/session.ts';

/**
 * Заглушки боевых эндпоинтов. Реализация — M1 (GDD §11).
 *
 * Заглушки не пустые: они уже требуют сессию и уже валидируют тело
 * схемой из @extramundum/shared. То есть контракт зафиксирован и проверяем
 * прямо сейчас, а в M1 меняется только последняя строка каждого обработчика.
 *
 * Оба обработчика намеренно НЕ принимают состояние игрока из тела запроса.
 * В M1 они прочитают его из БД по сессии (инвариант 1, GDD §3.2 шаг 1).
 */
export function battleRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(API_ROUTES.battleStart, async (c) => {
    await requireSession(c);
    const input = await parseBody(c, battleStartInputSchema);

    c.get('log').info('battle/start вызван до реализации движка', {
      zone: input.zone,
      difficulty: input.difficulty,
    });

    throw notImplemented('боевой движок реализуется в M1');
  });

  /**
   * POST /simulate/preview — оценка шанса победы. GDD §6.4.
   *
   * Инвариант 1 в чистом виде: в теле запроса нет НИ ОДНОГО поля,
   * описывающего бойца. Идентификатор берётся из сессии, профиль
   * читается из БД. Подменить статы, чтобы получить красивое число,
   * нечем — и это важнее, чем кажется для «безобидного» превью:
   * ровно из таких исключений в v1.0 выросла дыра.
   *
   * Ничего не пишет и наград не выдаёт.
   */
  app.post(API_ROUTES.simulatePreview, async (c) => {
    const sessionUser = await requireSession(c);
    const input = await parseBody(c, simulatePreviewInputSchema);

    const profile = await findPlayerByUserId(db, sessionUser.id);
    if (profile === null) {
      throw new AppError('not_found', {
        messageKey: 'error.not_found',
        message: 'профиль не найден',
      });
    }

    const started = performance.now();
    const { winRate, runs } = estimateWinRate({
      profile,
      zone: input.zone,
      difficulty: input.difficulty,
      runs: input.runs,
    });
    const durationMs = Math.round(performance.now() - started);

    // Бюджет ответа для этого эндпоинта — p95 < 500 мс (GDD §6.4).
    // Логируем длительность, чтобы выход за бюджет был виден в проде,
    // а не выяснялся по жалобам.
    c.get('log').info('simulate/preview', {
      zone: input.zone,
      difficulty: input.difficulty,
      runs,
      winRate: Math.round(winRate * 1000) / 1000,
      durationMs,
    });

    const body: SimulatePreviewResponse = { winRate, runs, basis: 'sparring-dummy' };
    return c.json(body);
  });

  return app;
}
