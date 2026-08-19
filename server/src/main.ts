import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/client.ts';
import { reportRuntimePrivileges } from './db/privileges.ts';
import { createLogger } from './logger.ts';

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, { service: 'extramundum-server' });
const { db, pool } = createDatabase(config.DATABASE_URL);

const server = serve({ fetch: createApp(db, config, log).fetch, port: config.PORT }, (info) => {
  log.info('сервер запущен', { port: info.port, env: config.NODE_ENV });
});

// Не блокирует старт: сервер с избыточными правами работает правильно,
// просто хуже защищён. Об этом нужно знать, а не падать из-за этого.
void reportRuntimePrivileges(db, log, config.NODE_ENV === 'production');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('останавливаюсь', { signal });
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
