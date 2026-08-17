import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '../errors.js';
import { KNOWN_FIELD_ERROR_KEYS } from '../validation.js';

const localesDir = new URL('../../../../locales/', import.meta.url);

function load(lang: string): Record<string, string> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${lang}.json`, localesDir)), 'utf8'));
}

const ru = load('ru');
const en = load('en');

/**
 * Инвариант 6: все пользовательские строки — в locales/{ru,en}.json.
 * Эти тесты ловят самую частую поломку локализации: ключ добавили
 * в один язык и забыли во втором.
 */
describe('локали', () => {
  it('ru и en имеют одинаковый набор ключей', () => {
    const ruKeys = Object.keys(ru).sort();
    const enKeys = Object.keys(en).sort();

    expect(enKeys.filter((k) => !ruKeys.includes(k))).toEqual([]);
    expect(ruKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it('ни одна строка не пуста', () => {
    for (const [lang, dict] of [
      ['ru', ru],
      ['en', en],
    ] as const) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${lang}: ${key}`).not.toBe('');
      }
    }
  });

  it('у каждого кода ошибки есть строка в обоих языках', () => {
    for (const code of ERROR_CODES) {
      expect(ru, `ru: error.${code}`).toHaveProperty(`error.${code}`);
      expect(en, `en: error.${code}`).toHaveProperty(`error.${code}`);
    }
  });

  it('у каждого ключа ошибки поля есть строка в обоих языках', () => {
    for (const key of KNOWN_FIELD_ERROR_KEYS) {
      expect(ru, `ru: ${key}`).toHaveProperty(key);
      expect(en, `en: ${key}`).toHaveProperty(key);
    }
  });

  it('подстановки совпадают между языками', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();

    for (const key of Object.keys(ru)) {
      const ruValue = ru[key];
      const enValue = en[key];
      if (ruValue === undefined || enValue === undefined) continue;
      expect(placeholders(enValue), key).toEqual(placeholders(ruValue));
    }
  });
});
