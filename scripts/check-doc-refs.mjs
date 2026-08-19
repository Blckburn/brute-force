#!/usr/bin/env node
/**
 * Проверка ссылок на разделы документов.
 *
 * В коде десятки комментариев вида «GDD §7.2» и «ART-BIBLE §6». Пока
 * номера разделов не меняются, они безобидны. Как только документ
 * перенумеровали — каждая такая ссылка молча начинает указывать не туда,
 * и заметить это глазами нельзя.
 *
 * Скрипт разбирает заголовки документов, находит все ссылки в репозитории
 * и падает, если ссылка ведёт в несуществующий раздел.
 *
 * Что он НЕ умеет: понять, что §7.2 существует, но по смыслу неверен.
 * Это проверяется чтением вывода — он печатает название раздела рядом
 * с каждой ссылкой.
 *
 *   node scripts/check-doc-refs.mjs          # таблица и код возврата
 *   node scripts/check-doc-refs.mjs --quiet  # только ошибки
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const quiet = process.argv.includes('--quiet');

const DOCS = {
  GDD: 'docs/GDD-2.0.md',
  'ART-BIBLE': 'docs/ART-BIBLE.md',
  LORE: 'docs/LORE.md',
};

/** Заголовки документа -> { '7': 'Название', '7.2': 'Название' }. */
function sectionsOf(path) {
  const text = readFileSync(join(ROOT, path), 'utf8');
  const out = {};
  for (const m of text.matchAll(/^## (\d+)\. (.+)$/gm)) out[m[1]] = m[2].trim();
  for (const m of text.matchAll(/^### (\d+)\.(\d+) (.+)$/gm)) out[`${m[1]}.${m[2]}`] = m[3].trim();
  return out;
}

const sections = Object.fromEntries(Object.entries(DOCS).map(([k, v]) => [k, sectionsOf(v)]));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-types', '.git', '.localdb', '.vite']);
const EXTS = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.json',
  '.md',
  '.sql',
  '.yml',
  '.yaml',
  '.html',
  '.css',
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTS.has(extname(entry))) out.push(full);
  }
  return out;
}

const rows = [];
const broken = [];

for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    // Документ определяется по последнему упомянутому имени слева от ссылки.
    for (const m of line.matchAll(/§(\d+(?:\.\d+)?)/g)) {
      const before = line.slice(0, m.index);
      let doc = null;
      for (const name of Object.keys(DOCS)) {
        const at = before.lastIndexOf(name);
        if (at !== -1 && (doc === null || at > doc.at)) doc = { name, at };
      }
      if (doc === null) continue;

      const ref = m[1];
      const title = sections[doc.name][ref];
      if (title === undefined) {
        broken.push({ rel, line: i + 1, doc: doc.name, ref, text: line.trim().slice(0, 80) });
      } else {
        rows.push({ rel, line: i + 1, doc: doc.name, ref, title });
      }
    }
  });
}

if (!quiet) {
  const w = Math.max(...rows.map((r) => r.rel.length), 20);
  for (const r of rows.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)) {
    console.log(
      `${r.rel.padEnd(w)} ${String(r.line).padStart(4)}  ${r.doc} §${r.ref.padEnd(4)} -> ${r.title}`,
    );
  }
  console.log();
}

if (broken.length > 0) {
  console.error(`✗ Ссылок в несуществующие разделы: ${broken.length}`);
  for (const b of broken) {
    console.error(`  ${b.rel}:${b.line}  ${b.doc} §${b.ref} не существует`);
    console.error(`     ${b.text}`);
  }
  process.exit(1);
}

console.log(`✓ Проверено ссылок: ${rows.length}. Все ведут в существующие разделы.`);
