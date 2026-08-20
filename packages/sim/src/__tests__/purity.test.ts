import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SIM_BUNDLE_MARKER, SIM_LOG_VERSION } from '../index.js';

const pkg: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
);

const SRC = fileURLToPath(new URL('..', import.meta.url));
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

function filesUnder(dir: string, ext: string, skip: (name: string) => boolean): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    if (skip(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(filesUnder(full, ext, skip));
    else if (name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Комментарии отбрасываем: в них запрещённые конструкции упоминаются по имени. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Инварианты пакета: чистота и изоляция.
 *
 * Эти тесты охраняют не поведение боя, а условия, при которых движку
 * вообще можно верить. Один `Math.random()` — и бой перестаёт быть
 * воспроизводимым; один рантайм-импорт — и пакет может утечь в бандл.
 *
 * Проверяется ВЕСЬ `src/` и, главное, собранный `dist/`. Проверка
 * манифеста ловит намерение, проверка `dist/` — факт. Инвариант 2
 * читается как «ноль рантайм-зависимостей», и держится он именно
 * вторым: docs/adr/0003-tipy-kontrakta-v-shared.md.
 */
describe('@extramundum/sim: инварианты пакета', () => {
  const sources = filesUnder(SRC, '.ts', (name) => name === '__tests__');

  it('исходники на месте', () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(SIM_BUNDLE_MARKER).toBe('EXTRAMUNDUM_SIM_MUST_NEVER_REACH_THE_BROWSER');
    expect(SIM_LOG_VERSION).toBe(1);
  });

  it('не имеет рантайм-зависимостей в манифесте', () => {
    const manifest = pkg as Record<string, unknown>;
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = manifest[field];
      expect(deps === undefined || Object.keys(deps as object).length === 0, field).toBe(true);
    }
  });

  it('ни в одном файле src нет источников недетерминизма', () => {
    for (const file of sources) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const where = file.slice(SRC.length);

      expect(code, where).not.toMatch(/Math\.random/);
      expect(code, where).not.toMatch(/Date\.now/);
      expect(code, where).not.toMatch(/new Date\b/);
      expect(code, where).not.toMatch(/performance\.now/);
      expect(code, where).not.toMatch(/\bfetch\s*\(/);
      expect(code, where).not.toMatch(/from\s+'node:/);
      expect(code, where).not.toMatch(/process\.env/);
    }
  });

  it('в src все внешние импорты — только типовые', () => {
    for (const file of sources) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const where = file.slice(SRC.length);

      // Любой импорт не из относительного пути обязан быть `import type`.
      const imports = code.matchAll(/^\s*import\s+([\s\S]*?)from\s+'([^']+)';/gm);
      for (const [, clause, from] of imports) {
        if (from?.startsWith('.')) continue;
        expect(clause?.trimStart().startsWith('type'), `${where}: '${from ?? '?'}'`).toBe(true);
      }
    }
  });

  /**
   * Главная проверка. `import type` обязан исчезнуть при компиляции —
   * если кто-то заменит его на обычный импорт, здесь появится ребро,
   * и тест упадёт независимо от того, что написано в манифесте.
   */
  it('в собранном dist нет ни одного импорта наружу', () => {
    const built = filesUnder(DIST, '.js', () => false);
    expect(built.length, 'dist пуст — запусти сборку пакета').toBeGreaterThan(0);

    for (const file of built) {
      // Комментарии в собранном коде остаются, и в них эти конструкции
      // названы по имени как запрещённые.
      const code = stripComments(readFileSync(file, 'utf8'));
      const where = file.slice(DIST.length);

      for (const [, from] of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        expect(from?.startsWith('.'), `${where}: импорт из '${from ?? '?'}'`).toBe(true);
      }
      expect(code, where).not.toMatch(/\brequire\s*\(/);
      expect(code, where).not.toMatch(/Math\.random/);
      expect(code, where).not.toMatch(/Date\.now/);
    }
  });
});
