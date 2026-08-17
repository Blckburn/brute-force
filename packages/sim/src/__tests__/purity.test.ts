import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SIM_BUNDLE_MARKER, SIM_LOG_VERSION } from '../index.js';

const pkg: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
);

/**
 * Тесты-заглушки этапа M0. Настоящие тесты движка появятся в M1, но эти
 * действуют уже сейчас: они охраняют инварианты пакета, а не поведение боя.
 * Если кто-то добавит сюда зависимость или обращение ко времени —
 * сборка упадёт в тот же день, а не через месяц.
 */
describe('@bruteforce/sim: инварианты пакета', () => {
  it('пакет собирается и экспортирует свои константы', () => {
    expect(SIM_BUNDLE_MARKER).toBe('BRUTEFORCE_SIM_MUST_NEVER_REACH_THE_BROWSER');
    expect(SIM_LOG_VERSION).toBe(0);
  });

  it('не имеет ни одной зависимости', () => {
    const manifest = pkg as Record<string, unknown>;
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = manifest[field];
      expect(deps === undefined || Object.keys(deps as object).length === 0).toBe(true);
    }
  });

  it('в исходниках нет источников недетерминизма', () => {
    const source = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
    // Комментарии отбрасываем: в них эти конструкции упоминаются как запрещённые.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/Date\.now/);
    expect(code).not.toMatch(/new Date\b/);
    expect(code).not.toMatch(/performance\.now/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/from\s+'node:/);
  });
});
