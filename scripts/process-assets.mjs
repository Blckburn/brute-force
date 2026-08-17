#!/usr/bin/env node
/**
 * Постобработка иконок. ART-BIBLE §3 и §5.
 *
 * Берёт исходные PNG из assets-src/, приводит к продакшн-виду и кладёт
 * в apps/web/public/assets/. Пути готовых файлов сам вписывает
 * в packages/data/assets.json — руками их не правят.
 *
 *   assets-src/zones/wastes.png
 *     -> apps/web/public/assets/icons/zones/wastes.webp       (256)
 *     -> apps/web/public/assets/icons/zones/wastes@128.webp   (128)
 *     -> в манифесте: "zone.wastes": "icons/zones/wastes.webp"
 *
 * Имя файла без расширения = идентификатор сущности, имя папки = категория.
 * Соответствие папок категориям — в CATEGORY_BY_DIR ниже.
 *
 * Проверки, после которых ассет отклоняется:
 *   - размер исходника меньше требуемого (мельчить нельзя, увеличивать тоже)
 *   - нет альфа-канала: иконка обязана быть на прозрачном фоне
 *   - фон непрозрачный по углам — значит подложка запечена в картинку
 *   - результат тяжелее 20 КБ
 *
 *   node scripts/process-assets.mjs            # обработать всё
 *   node scripts/process-assets.mjs --check    # только проверить, не писать
 */
import { readdir, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'assets-src');
const OUT = join(ROOT, 'apps/web/public/assets/icons');
const MANIFEST = join(ROOT, 'packages/data/assets.json');

/** ART-BIBLE §3. */
const SOURCE_SIZE = 1024;
const SIZES = [256, 128];
const MAX_BYTES = 20 * 1024;
const WEBP_QUALITY = 90;

/** Папка в assets-src -> категория ключа в манифесте. */
const CATEGORY_BY_DIR = {
  zones: 'zone',
  statuses: 'status',
  archetypes: 'archetype',
  slots: 'slot',
  weapons: 'weapon',
  offhands: 'offhand',
  armor: 'armor',
  accessories: 'accessory',
  traits: 'trait',
};

const checkOnly = process.argv.includes('--check');
const problems = [];
const processed = [];

async function listSources(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSources(full, join(prefix, entry.name))));
    else if (extname(entry.name).toLowerCase() === '.png') out.push({ full, prefix });
  }
  return out;
}

/** Прозрачны ли углы: непрозрачные означают запечённую подложку. */
async function cornersAreTransparent(image) {
  const { data, info } = await image
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const alphaAt = (x, y) => data[(y * width + x) * channels + (channels - 1)];
  const inset = Math.max(1, Math.floor(Math.min(width, height) * 0.02));

  return [
    alphaAt(inset, inset),
    alphaAt(width - 1 - inset, inset),
    alphaAt(inset, height - 1 - inset),
    alphaAt(width - 1 - inset, height - 1 - inset),
  ].every((a) => a === 0);
}

async function processOne({ full, prefix }) {
  const dirName = prefix.split(/[/\\]/)[0] ?? '';
  const category = CATEGORY_BY_DIR[dirName];
  const id = basename(full, '.png');
  const rel = relative(SRC, full);

  if (category === undefined) {
    problems.push(`${rel}: папка "${dirName}" не сопоставлена категории (см. CATEGORY_BY_DIR)`);
    return null;
  }
  if (!/^[a-z0-9-]+$/.test(id)) {
    problems.push(`${rel}: имя файла должно быть kebab-case латиницей (ART-BIBLE §3)`);
    return null;
  }

  const image = sharp(full);
  const meta = await image.metadata();

  if ((meta.width ?? 0) < SOURCE_SIZE || (meta.height ?? 0) < SOURCE_SIZE) {
    problems.push(
      `${rel}: ${meta.width}×${meta.height}, нужен исходник не меньше ${SOURCE_SIZE}×${SOURCE_SIZE}`,
    );
    return null;
  }
  if (meta.width !== meta.height) {
    problems.push(`${rel}: ${meta.width}×${meta.height}, иконка должна быть квадратной`);
    return null;
  }
  if (!meta.hasAlpha) {
    problems.push(`${rel}: нет альфа-канала, фон обязан быть прозрачным (ART-BIBLE §3)`);
    return null;
  }
  if (!(await cornersAreTransparent(image))) {
    problems.push(`${rel}: углы непрозрачны — похоже, подложка запечена в картинку`);
    return null;
  }

  const outDir = join(OUT, dirName);
  const results = [];

  for (const size of SIZES) {
    const buffer = await image
      .clone()
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: WEBP_QUALITY, alphaQuality: 100, effort: 6 })
      .toBuffer();

    if (buffer.byteLength > MAX_BYTES) {
      problems.push(
        `${rel} @${size}: ${Math.round(buffer.byteLength / 1024)} КБ, предел ${MAX_BYTES / 1024} КБ`,
      );
      return null;
    }

    const name = size === SIZES[0] ? `${id}.webp` : `${id}@${size}.webp`;
    results.push({ size, name, buffer, path: join(outDir, name) });
  }

  if (!checkOnly) {
    await mkdir(outDir, { recursive: true });
    for (const r of results) await writeFile(r.path, r.buffer);
  }

  const primary = results[0];
  processed.push({
    key: `${category}.${id}`,
    manifestPath: `icons/${dirName}/${primary.name}`,
    sizes: results
      .map((r) => `${r.size}: ${Math.round((r.buffer.byteLength / 1024) * 10) / 10} КБ`)
      .join(', '),
  });

  return true;
}

const sources = await listSources(SRC);

if (sources.length === 0) {
  console.log(`В ${relative(ROOT, SRC)}/ нет ни одного PNG.`);
  console.log('Это нормальное состояние: игра собирается с нулём иконок,');
  console.log('на их месте рисуются плейсхолдеры (ART-BIBLE §4).');
  process.exit(0);
}

for (const source of sources) await processOne(source);

if (processed.length > 0) {
  console.log(checkOnly ? 'Прошли бы проверку:' : 'Обработано:');
  for (const p of processed) console.log(`  ${p.key.padEnd(28)} ${p.manifestPath}  (${p.sizes})`);
}

if (!checkOnly && processed.length > 0) {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  let added = 0;
  for (const p of processed) {
    if (manifest.icons[p.key] !== p.manifestPath) {
      manifest.icons[p.key] = p.manifestPath;
      added += 1;
    }
  }
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nВ манифест внесено записей: ${added}`);
}

if (problems.length > 0) {
  console.error(`\nОтклонено (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nART-BIBLE §3: не опознаётся в 48px или не проходит проверки — ассет не принимается.',
  );
  process.exit(1);
}

const size = await Promise.all(
  processed.map(
    async (p) => (await stat(join(ROOT, 'apps/web/public/assets', p.manifestPath))).size,
  ),
).catch(() => []);
if (size.length > 0) {
  console.log(
    `\nИтого ${processed.length} иконок, ${Math.round(size.reduce((a, b) => a + b, 0) / 1024)} КБ.`,
  );
}
