import { ZONE_IDS } from '@bruteforce/shared';

import manifest from './assets.json' with { type: 'json' };

/**
 * Манифест иконок. ART-BIBLE §4.
 *
 * Ключ совпадает с `base_key` предмета, `StatusId`, `TraitId` или
 * идентификатором зоны/архетипа. Значение — путь относительно
 * `apps/web/public/assets/`, либо `null`.
 *
 * ЗАЧЕМ NULL. Требования ART-BIBLE на первый взгляд противоречат друг
 * другу: тест должен падать, если у сущности нет иконки, но игра должна
 * собираться при нуле готовых иконок. Разрешается это тем, что `null` —
 * не отсутствие записи, а ЯВНОЕ заявление «ещё не нарисовано, показывать
 * плейсхолдер».
 *
 * Отсюда три состояния и три разных исхода в тесте:
 *
 *   ключа нет вовсе   -> сборка падает: про сущность забыли
 *   значение null     -> норма: плейсхолдер, рисовать позже
 *   путь есть         -> файл обязан лежать на диске, иначе сборка падает
 *
 * «Не забыли нарисовать» и «не забыли положить файл» становятся красной
 * сборкой, а не чьей-то памятью.
 */
export type IconPath = string | null;
export type IconKey = keyof typeof manifest.icons;

export const assets = manifest;
export const icons: Record<string, IconPath> = manifest.icons;

/**
 * Категории сущностей, которым нужна иконка.
 *
 * Здесь перечислено только то, что УЖЕ существует в коде или названо
 * в GDD поимённо. Оружие, броня, аффиксы и трейты появятся вместе
 * с содержимым в M1 и M3 — тогда же расширится и этот список, а тест
 * сразу потребует для них записи в манифесте.
 */
export const ICON_ENTITIES = {
  /** GDD §6.4. Карточки зон. */
  zone: [...ZONE_IDS],

  /** GDD §3.4, стартовый набор статусов. */
  status: ['bleed', 'poison', 'burn', 'stun', 'hex', 'fury', 'regen', 'shield', 'enrage', 'chill'],

  /** GDD §4.1, четыре архетипа. Портреты. */
  archetype: ['swordsman', 'guardian', 'blade', 'cursed'],

  /** GDD §4.3, восемь слотов экипировки. Иконки пустого слота. */
  slot: ['weapon', 'offhand', 'helmet', 'chest', 'bracers', 'boots', 'amulet', 'ring'],
} as const satisfies Record<string, readonly string[]>;

/** Все ключи, которые обязаны присутствовать в манифесте. */
export function expectedIconKeys(): string[] {
  return Object.entries(ICON_ENTITIES).flatMap(([category, ids]) =>
    ids.map((id) => `${category}.${id}`),
  );
}

/**
 * Путь к иконке или null, если её ещё нет.
 *
 * Неизвестный ключ — тоже null: UI покажет плейсхолдер, а не сломается.
 * Забытую регистрацию ловит тест, а не падение в рантайме у игрока.
 */
export function iconPath(key: string): IconPath {
  return icons[key] ?? null;
}
