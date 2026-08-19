#!/usr/bin/env node
/**
 * Инвариант 3: packages/sim не попадает в браузерный бандл.
 *
 * Это последний рубеж из четырёх. Предыдущие три — правило ESLint,
 * отсутствие @extramundum/sim в зависимостях apps/web и плагин Vite,
 * падающий на резолве. Здесь мы смотрим уже на СОБРАННЫЕ файлы, потому
 * что только они реально уезжают в браузер. Правило можно отключить
 * комментарием, зависимость — добавить, плагин — убрать; собранный
 * бандл соврать не может.
 *
 * Проверяем заодно, что в бандл не утекли секреты: строка подключения
 * к БД в клиенте — это ровно провал v1.0.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../apps/web/dist', import.meta.url));

/** Что искать -> почему это провал. */
const FORBIDDEN = [
  {
    pattern: 'EXTRAMUNDUM_SIM_MUST_NEVER_REACH_THE_BROWSER',
    reason: 'боевой движок @extramundum/sim оказался в клиентском бандле (GDD §3.1, инвариант 3)',
  },
  {
    pattern: 'postgres://',
    reason: 'строка подключения к БД в клиентском бандле (инвариант 1)',
  },
  {
    pattern: 'postgresql://',
    reason: 'строка подключения к БД в клиентском бандле (инвариант 1)',
  },
  {
    pattern: 'BETTER_AUTH_SECRET',
    reason: 'секрет подписи сессий в клиентском бандле (инвариант 7)',
  },
  {
    pattern: 'neon.tech',
    reason: 'адрес базы данных в клиентском бандле (инвариант 1)',
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`✗ Нет собранного бандла в ${DIST}. Сначала: pnpm build`);
  process.exit(1);
}

// Карты исходников исключаем: в них попадают комментарии и имена файлов,
// но в браузер они не выполняются и в проде не публикуются.
const scanned = files.filter((f) => !f.endsWith('.map'));
const failures = [];

for (const file of scanned) {
  const content = readFileSync(file, 'utf8');
  for (const { pattern, reason } of FORBIDDEN) {
    if (content.includes(pattern)) {
      failures.push({ file: file.slice(DIST.length + 1), pattern, reason });
    }
  }
}

if (failures.length > 0) {
  console.error('✗ Проверка бандла провалена:\n');
  for (const f of failures) {
    console.error(`  ${f.file}`);
    console.error(`    нашёл: ${f.pattern}`);
    console.error(`    почему это плохо: ${f.reason}\n`);
  }
  process.exit(1);
}

console.log(`✓ Проверка бандла пройдена: ${scanned.length} файлов, ${FORBIDDEN.length} шаблонов.`);
console.log('  Боевого движка и секретов в клиенте нет.');
