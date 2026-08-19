import { ERROR_STATUS, type ApiError, type ErrorCode } from '@extramundum/shared';

/**
 * Ошибка, которую сервер осознанно показывает клиенту.
 *
 * Всё остальное — необработанные исключения — превращается в `internal`
 * с текстом из локали. Наружу никогда не уходит стек, имя таблицы или
 * текст ошибки драйвера: это подсказки для того, кто ищет дыру.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly messageKey: string;
  readonly fields: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    options: {
      /** Ключ локали. По умолчанию — `error.<code>`. */
      messageKey?: string;
      /** Текст для логов, игроку не показывается. */
      message?: string;
      fields?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    super(
      options.message ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AppError';
    this.code = code;
    this.messageKey = options.messageKey ?? `error.${code}`;
    this.fields = options.fields;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toBody(requestId: string): ApiError {
    return {
      error: {
        code: this.code,
        messageKey: this.messageKey,
        message: this.message,
        ...(this.fields === undefined ? {} : { fields: this.fields }),
        requestId,
      },
    };
  }
}

export const unauthorized = (message = 'нет активной сессии') =>
  new AppError('unauthorized', { message });

export const notFound = (message = 'ресурс не найден') => new AppError('not_found', { message });

export const notImplemented = (message: string) => new AppError('not_implemented', { message });
