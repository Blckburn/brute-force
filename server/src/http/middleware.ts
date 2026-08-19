import { randomUUID } from 'node:crypto';

import { fieldErrorKeys, type ApiError } from '@extramundum/shared';
import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import { ZodError, type ZodType } from 'zod';

import type { Auth } from '../auth/index.ts';
import type { Logger } from '../logger.ts';
import { AppError } from './errors.ts';

/**
 * Окружение Hono для всего приложения. Один тип на все маршруты:
 * если каждый файл объявляет свой, они неизбежно разъезжаются.
 */
export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    auth: Auth;
  };
};

/** Сквозной идентификатор запроса: он же в логах, он же в теле ошибки. */
export function requestContext(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.set('log', logger.child({ requestId }));
    c.header('x-request-id', requestId);
    await next();
  };
}

/** Одна строка лога на запрос, с длительностью и статусом. */
export const accessLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const startedAt = Date.now();
  await next();
  c.get('log').info('request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - startedAt,
  });
};

/**
 * Единая обработка ошибок. Наружу уходит только конверт ApiError,
 * внутрь лога — всё остальное, включая стек.
 */
export function errorHandler(): ErrorHandler<AppEnv> {
  return (err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    const log = c.get('log');

    if (err instanceof AppError) {
      // 4xx — ожидаемый ход событий, не повод шуметь на уровне error.
      const level = err.status >= 500 ? 'error' : 'warn';
      log[level]('запрос отклонён', { code: err.code, status: err.status, detail: err.message });
      return c.json(err.toBody(requestId), err.status as 400);
    }

    log.error('необработанное исключение', {
      detail: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    const body: ApiError = {
      error: {
        code: 'internal',
        messageKey: 'error.internal',
        message: 'internal error',
        requestId,
      },
    };
    return c.json(body, 500);
  };
}

/**
 * Валидация тела запроса схемой из @extramundum/shared.
 *
 * Инвариант: ни один обработчик не читает `await c.req.json()` напрямую.
 * Всё, что приходит снаружи, проходит здесь.
 */
export async function parseBody<T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('validation_failed', { message: 'тело запроса не является JSON' });
  }

  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      // В fields уходят КЛЮЧИ ЛОКАЛИ, а не текст zod: инвариант 6.
      throw new AppError('validation_failed', {
        message: 'тело запроса не прошло валидацию',
        fields: fieldErrorKeys(err),
      });
    }
    throw err;
  }
}
