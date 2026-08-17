import { API_ROUTES, PASSWORD_MAX, PASSWORD_MIN } from '@bruteforce/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { schema } from '../db/client.ts';
import { ensurePlayer } from '../players/repository.ts';
import type { Logger } from '../logger.ts';

export type Auth = ReturnType<typeof createAuth>;

/**
 * Better Auth владеет идентичностью: учётной записью, паролем и сессией.
 * Игровой профиль он не трогает — тот живёт в players и создаётся хуком ниже.
 */
export function createAuth(db: Database, config: Config, log: Logger) {
  return betterAuth({
    appName: 'bruteforce',
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: API_ROUTES.auth,
    trustedOrigins: config.CORS_ORIGINS,

    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      // Почту не подтверждаем: почтовый провайдер в стек M0 не входит.
      requireEmailVerification: false,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },

    advanced: {
      // SameSite=Lax, а не None: клиент обращается к API по относительному
      // пути на своём же домене (статика проксирует запрос на сервер),
      // поэтому кука первой стороны. SameSite=None понадобился бы только
      // при обращении на чужой домен — и тогда браузер вправе её выбросить.
      defaultCookieAttributes:
        config.NODE_ENV === 'production'
          ? { sameSite: 'lax', secure: true, httpOnly: true }
          : { sameSite: 'lax', secure: false, httpOnly: true },
    },

    databaseHooks: {
      user: {
        create: {
          async after(createdUser) {
            // Профиль создаётся сразу после учётной записи. Если этот хук
            // не отработает (падение процесса между двумя записями),
            // профиль будет достроен лениво при первом GET /me —
            // ensurePlayer идемпотентен. Двух источников правды не возникает:
            // уникальность players.user_id гарантирует ровно одну строку.
            await ensurePlayer(db, {
              userId: createdUser.id,
              username: createdUser.name,
            });
            log.info('игровой профиль создан', { userId: createdUser.id });
          },
        },
      },
    },
  });
}
