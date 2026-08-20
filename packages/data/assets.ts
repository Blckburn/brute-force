import { ALL_TRAIT_IDS, ARCHETYPE_IDS, STATUS_IDS, ZONE_IDS } from '@extramundum/shared';

import manifest from './assets.json' with { type: 'json' };

/**
 * Манифест иконок. ART-BIBLE §7.
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
 * Списки БЕРУТСЯ ИЗ КОНТРАКТА, а не переписываются сюда руками. Копия
 * рано или поздно расходится с оригиналом молча: до этой правки здесь
 * лежали архетипы `swordsman/guardian/blade/cursed`, которых в коде
 * уже не было — контракт назвал их по причинам изгнания. Тест на
 * «сущность удалили, запись осталась» этого не поймал, потому что
 * сверялся с той же самой копией.
 *
 * Оружие, броня и аффиксы появятся вместе с содержимым в M3 — тогда же
 * расширится и этот список, а тест сразу потребует для них записи
 * в манифесте.
 */
export const ICON_ENTITIES = {
  /** GDD §7.4. Карточки зон. */
  zone: [...ZONE_IDS],

  /** GDD §4.4, десять статусов. */
  status: [...STATUS_IDS],

  /** GDD §5.1, четыре причины изгнания. Портреты. */
  archetype: [...ARCHETYPE_IDS],

  /** GDD §4.5, тридцать выбираемых трейтов и четыре врождённых. */
  trait: [...ALL_TRAIT_IDS],

  /** GDD §5.3, восемь слотов экипировки. Иконки пустого слота. */
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
