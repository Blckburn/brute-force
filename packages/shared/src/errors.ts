import { z } from 'zod';

/**
 * Коды ошибок API. Клиент никогда не показывает `message` из ответа —
 * он показывает строку локали по `code` (инвариант 6). `message`
 * существует для логов и разработчика.
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'not_implemented',
  'internal',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Единый конверт ошибки. Все не-2xx ответы сервера выглядят так. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    /** Ключ в locales/{ru,en}.json — то, что реально увидит игрок. */
    messageKey: z.string(),
    /** Для разработчика и логов. Не показывается игроку. */
    message: z.string(),
    /** Заполняется только при validation_failed: поле -> причина. */
    fields: z.record(z.string(), z.string()).optional(),
    /** Сквозной идентификатор запроса, он же в логах сервера. */
    requestId: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** HTTP-статус, соответствующий коду ошибки. Единственный источник правды. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  not_implemented: 501,
  internal: 500,
};
