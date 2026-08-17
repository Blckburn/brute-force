/**
 * Структурированный логгер: одна строка JSON на событие.
 *
 * Написан вручную и намеренно: pino не входит в зафиксированный стек,
 * а всё, что нам нужно от логгера на этом этапе, — уровни, дочерний
 * контекст и защита от утечки секретов — умещается в этот файл.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;
export type LogFields = Record<string, unknown>;

/**
 * Ключи, значения которых никогда не попадают в лог. Проверка идёт по
 * подстроке в нижнем регистре, поэтому `DATABASE_URL`, `authToken`
 * и `x-api-key` перехватываются одинаково.
 */
const REDACTED_KEY_PARTS = [
  'password',
  'secret',
  'token',
  'cookie',
  'authorization',
  'session',
  'apikey',
  'api_key',
  'database_url',
  'connectionstring',
];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    out[key] = REDACTED_KEY_PARTS.some((part) => lowered.includes(part))
      ? '[скрыто]'
      : redact(val, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export function createLogger(
  level: LogLevel = 'info',
  bindings: LogFields = {},
  sink: (line: string) => void = (line) => process.stdout.write(line + '\n'),
): Logger {
  const threshold = LEVELS[level];

  function emit(msgLevel: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVELS[msgLevel] < threshold) return;

    const record = {
      level: msgLevel,
      time: new Date().toISOString(),
      msg,
      ...(redact(bindings) as LogFields),
      ...(redact(fields ?? {}) as LogFields),
    };

    sink(JSON.stringify(record));
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (extra) => createLogger(level, { ...bindings, ...extra }, sink),
  };
}
