import { signUpInputSchema } from '@extramundum/shared';
import { Hono } from 'hono';

import type { Database } from '../db/client.ts';
import { AppError } from '../http/errors.ts';
import { parseBody, type AppEnv } from '../http/middleware.ts';
import { isUsernameTaken } from '../players/repository.ts';

/** Код Postgres для нарушения уникального индекса. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === PG_UNIQUE_VIOLATION && e.constraint === constraint;
}

/**
 * Регистрация — собственный эндпоинт поверх Better Auth.
 *
 * Своим он сделан ради трёх вещей, которых у встроенного нет:
 *   1. валидация имени персонажа схемой из @extramundum/shared;
 *   2. проверка, что имя свободно, до создания учётной записи;
 *   3. ошибки в общем конверте ApiError с ключами локали.
 *
 * Всё остальное (вход, выход, чтение сессии) обслуживает сам Better Auth
 * на /api/auth/* — переписывать его незачем.
 */
export function authRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/register', async (c) => {
    const input = await parseBody(c, signUpInputSchema);
    const auth = c.get('auth');

    // Быстрый путь: имя занято — не создаём учётную запись вообще.
    if (await isUsernameTaken(db, input.username)) {
      throw new AppError('conflict', {
        messageKey: 'error.field.username.taken',
        message: 'имя персонажа занято',
        fields: { username: 'error.field.username.taken' },
      });
    }

    try {
      // asResponse отдаёт ответ Better Auth целиком, вместе с Set-Cookie
      // сессии — регистрация сразу логинит, без второго запроса.
      return await auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: input.username,
        },
        headers: c.req.raw.headers,
        asResponse: true,
      });
    } catch (err) {
      // Гонка: имя заняли между проверкой выше и вставкой профиля.
      // Уникальный индекс — последний рубеж, и он сработал.
      if (isUniqueViolation(err, 'players_username_lower_idx')) {
        throw new AppError('conflict', {
          messageKey: 'error.field.username.taken',
          message: 'имя персонажа занято (гонка при регистрации)',
          fields: { username: 'error.field.username.taken' },
          cause: err,
        });
      }

      if (isUniqueViolation(err, 'user_email_unique')) {
        throw new AppError('conflict', {
          messageKey: 'error.field.email.taken',
          message: 'почта уже занята',
          fields: { email: 'error.field.email.taken' },
          cause: err,
        });
      }

      throw err;
    }
  });

  return app;
}
