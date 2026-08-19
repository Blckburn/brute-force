import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ICON_ENTITIES, expectedIconKeys, iconPath, icons } from '../assets.ts';

/**
 * ART-BIBLE §7: «Тест в CI проходит по всем сущностям и падает, если
 * у чего-то нет иконки или файл отсутствует на диске. Это переводит
 * "не забыли нарисовать" из области памяти в область красной сборки».
 *
 * Здесь же проверяется второе требование того же раздела: игра должна
 * собираться и запускаться с нулём готовых иконок.
 */

/** Куда process-assets.mjs кладёт готовые файлы. */
const PUBLIC_ASSETS = fileURLToPath(new URL('../../../apps/web/public/assets/', import.meta.url));

const MAX_ICON_BYTES = 20 * 1024; // ART-BIBLE §6

describe('манифест иконок', () => {
  it('у каждой сущности есть запись', () => {
    const missing = expectedIconKeys().filter((key) => !(key in icons));

    expect(
      missing,
      `Про эти сущности забыли: добавьте их в packages/data/assets.json ` +
        `со значением null, если иконка ещё не нарисована.`,
    ).toEqual([]);
  });

  it('в манифесте нет записей о несуществующих сущностях', () => {
    const expected = new Set(expectedIconKeys());
    const orphans = Object.keys(icons).filter((key) => !expected.has(key));

    expect(orphans, 'Эти ключи ни к чему не относятся — сущность удалили, запись осталась').toEqual(
      [],
    );
  });

  it('каждый заявленный путь существует на диске', () => {
    const broken: string[] = [];

    for (const [key, path] of Object.entries(icons)) {
      // null — это «ещё не нарисовано», а не поломка.
      if (path === null) continue;
      if (!existsSync(PUBLIC_ASSETS + path)) broken.push(`${key} -> ${path}`);
    }

    expect(broken, 'Путь заявлен, а файла нет. Либо положите файл, либо верните null.').toEqual([]);
  });

  it('готовые иконки укладываются в 20 КБ', () => {
    const heavy: string[] = [];

    for (const [key, path] of Object.entries(icons)) {
      if (path === null) continue;
      const full = PUBLIC_ASSETS + path;
      if (!existsSync(full)) continue; // ловится предыдущим тестом
      const { size } = statSync(full);
      if (size > MAX_ICON_BYTES) heavy.push(`${key}: ${Math.round(size / 1024)} КБ`);
    }

    expect(heavy, 'ART-BIBLE §6: иконка тяжелее 20 КБ').toEqual([]);
  });

  it('пути ведут в WebP и в kebab-case латиницей', () => {
    const wrong: string[] = [];

    for (const [key, path] of Object.entries(icons)) {
      if (path === null) continue;
      if (!path.endsWith('.webp')) wrong.push(`${key}: не .webp`);
      if (!/^[a-z0-9/-]+\.webp$/.test(path)) wrong.push(`${key}: только kebab-case и латиница`);
      if (path.startsWith('/') || path.includes('..'))
        wrong.push(`${key}: путь должен быть относительным`);
    }

    expect(wrong, 'ART-BIBLE §6, именование').toEqual([]);
  });

  it('игра собирается при нуле готовых иконок', () => {
    // Ключевое требование ART-BIBLE §7. Отсутствие иконки не должно быть
    // ошибкой — на её месте рисуется плейсхолдер.
    for (const key of expectedIconKeys()) {
      expect(() => iconPath(key)).not.toThrow();
    }

    // Неизвестный ключ тоже не роняет: UI покажет плейсхолдер.
    expect(iconPath('weapon.которого-нет')).toBeNull();
  });

  it('категории не пересекаются и не пусты', () => {
    const seen = new Set<string>();
    for (const [category, ids] of Object.entries(ICON_ENTITIES)) {
      expect(ids.length, `категория ${category} пуста`).toBeGreaterThan(0);
      for (const id of ids) {
        const key = `${category}.${id}`;
        expect(seen.has(key), `дубль ключа ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });
});
