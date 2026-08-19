import {
  API_ROUTES,
  battleStartInputSchema,
  simulatePreviewInputSchema,
} from '@extramundum/shared';
import { Hono } from 'hono';

import { notImplemented } from '../http/errors.ts';
import { parseBody, type AppEnv } from '../http/middleware.ts';
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
export function battleRoutes(): Hono<AppEnv> {
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

  app.post(API_ROUTES.simulatePreview, async (c) => {
    await requireSession(c);
    const input = await parseBody(c, simulatePreviewInputSchema);

    // Бюджет ответа для этого эндпоинта — p95 < 500 мс (GDD §6.4).
    c.get('log').info('simulate/preview вызван до реализации движка', {
      zone: input.zone,
      runs: input.runs,
    });

    throw notImplemented('серверное превью реализуется в M1');
  });

  return app;
}
