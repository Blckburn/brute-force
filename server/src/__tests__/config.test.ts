import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.ts';

/**
 * Конфигурация как источник поломок на проде.
 *
 * Инвариант 4 говорит: механики без теста не существует. Вход по паролю
 * тестом был закрыт и проходил — но в тестах BETTER_AUTH_URL задан без
 * пути, а на проде он был задан вместе с `/api`. Better Auth складывает
 * baseURL и basePath и сопоставляет результат с путём, который ВИДИТ
 * сервер; статика снимает `/api` при проксировании, до сервера доходит
 * `/auth/...`, совпадения нет — 404 на вход, молча.
 *
 * Тест закрывает не поведение кода, а форму конфигурации: неверное
 * значение обязано валить старт, а не логин месяц спустя.
 */
const base = {
  DATABASE_URL: 'postgres://user@localhost:5432/db',
  BETTER_AUTH_SECRET: 'test-secret-value-at-least-32-characters',
  NODE_ENV: 'test',
};

describe('BETTER_AUTH_URL', () => {
  it('принимает голый origin', () => {
    const config = loadConfig({ ...base, BETTER_AUTH_URL: 'https://server.example.com' });
    expect(config.BETTER_AUTH_URL).toBe('https://server.example.com');
  });

  it('принимает origin со слэшем на конце', () => {
    expect(() =>
      loadConfig({ ...base, BETTER_AUTH_URL: 'https://server.example.com/' }),
    ).not.toThrow();
  });

  it('отвергает адрес клиента вместе с /api — это ломало вход на проде', () => {
    expect(() =>
      loadConfig({ ...base, BETTER_AUTH_URL: 'https://client.example.com/api' }),
    ).toThrow(/только origin/);
  });

  it('отвергает любой другой путь', () => {
    expect(() =>
      loadConfig({ ...base, BETTER_AUTH_URL: 'https://server.example.com/auth' }),
    ).toThrow(/только origin/);
  });
});
