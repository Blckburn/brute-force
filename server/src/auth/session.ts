import type { Context } from 'hono';

import { unauthorized } from '../http/errors.ts';
import type { AppEnv } from '../http/middleware.ts';

export type SessionUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

/**
 * Достаёт пользователя из куки сессии и падает с 401, если сессии нет.
 *
 * Это единственный способ, которым обработчик узнаёт, кто он обслуживает.
 * Идентификатор игрока НИКОГДА не берётся из тела запроса, параметра
 * пути или заголовка — только отсюда. Инвариант 1.
 */
export async function requireSession(c: Context<AppEnv>): Promise<SessionUser> {
  const auth = c.get('auth');
  const result = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!result?.user) {
    throw unauthorized();
  }

  return {
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
  };
}
