import type { ZodError, ZodIssue } from 'zod';

/**
 * Превращение ошибок zod в ключи локали.
 *
 * Инвариант 6: наружу не уходит ни одной строки, которую клиент мог бы
 * показать игроку как есть. Текст zod («Invalid email address») —
 * английский хардкод внутри библиотеки; показать его значит повторить
 * ошибку v1.0, где весь UI был захардкожен по-английски.
 *
 * Поэтому сервер отдаёт КЛЮЧ, а строку подбирает клиент из locales/.
 */

function reasonFor(issue: ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      return 'tooShort';
    case 'too_big':
      return 'tooLong';
    default:
      return 'invalid';
  }
}

/**
 * Ключи, которые обязаны существовать в locales/{ru,en}.json.
 * Тест локалей проверяет, что для каждого из них есть строка.
 */
export const KNOWN_FIELD_ERROR_KEYS = [
  'error.field.email.invalid',
  'error.field.email.tooLong',
  'error.field.password.tooShort',
  'error.field.password.tooLong',
  'error.field.username.invalid',
  'error.field.username.tooShort',
  'error.field.username.tooLong',
] as const;

/**
 * Ключ локали для конкретной проблемы. Если для поля нет отдельной
 * строки, отдаётся общий ключ — лучше общая фраза, чем английский
 * текст из библиотеки.
 */
export function issueToLocaleKey(issue: ZodIssue): string {
  const field = issue.path.join('.');
  if (field === '') return 'error.validation_failed';

  const candidate = `error.field.${field}.${reasonFor(issue)}`;
  return (KNOWN_FIELD_ERROR_KEYS as readonly string[]).includes(candidate)
    ? candidate
    : 'error.validation_failed';
}

/** Поле -> ключ локали. Первая проблема на поле выигрывает. */
export function fieldErrorKeys(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '(корень)';
    fields[key] ??= issueToLocaleKey(issue);
  }
  return fields;
}
