import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { containerEnum, equipmentSlotEnum, rarityEnum } from './enums.ts';
import { players } from './game.ts';

/**
 * player_traits — выбранные трейты. GDD §2.3, §4.2.
 *
 * Трейт выдаётся каждый пятый уровень, слот — порядковый номер выбора.
 */
export const playerTraits = pgTable(
  'player_traits',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    traitId: text('trait_id').notNull(),
    slot: integer('slot').notNull(),
  },
  (table) => [
    uniqueIndex('player_traits_slot_idx').on(table.playerId, table.slot),
    // Один и тот же трейт нельзя взять дважды.
    uniqueIndex('player_traits_unique_idx').on(table.playerId, table.traitId),
    check('player_traits_slot_non_negative', sql`${table.slot} >= 0`),
  ],
);

/**
 * items — предметы. GDD §2.3, §5.
 *
 * ilvl вынесен в отдельную колонку и участвует в расчёте силы предмета
 * (GDD §5.1). Это фикс провала v1.0, где легендарка 1 уровня была равна
 * легендарке 30 уровня.
 *
 * affixes — jsonb, и именно jsonb, а не строка с JSON внутри. Двойное
 * кодирование из v1.0 (пункт 15 аудита) здесь невозможно по типу колонки.
 */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),

    container: containerEnum('container').notNull().default('inv'),
    slotIndex: integer('slot_index'),

    /** Ключ базового типа: совпадает с ключом иконки в assets.json. */
    baseKey: text('base_key').notNull(),
    ilvl: integer('ilvl').notNull(),
    rarity: rarityEnum('rarity').notNull(),
    affixes: jsonb('affixes')
      .notNull()
      .default(sql`'[]'::jsonb`),
    upgradeLevel: integer('upgrade_level').notNull().default(0),

    /** Защита от случайной продажи и разбора. GDD §5.3. */
    locked: boolean('locked').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('items_owner_container_idx').on(table.ownerId, table.container),
    check('items_ilvl_range', sql`${table.ilvl} between 1 and 200`),
    check('items_upgrade_range', sql`${table.upgradeLevel} between 0 and 10`),
    check(
      'items_slot_index_non_negative',
      sql`${table.slotIndex} is null or ${table.slotIndex} >= 0`,
    ),
  ],
);

/**
 * equipment — что надето. GDD §2.3, §4.3.
 *
 * Отдельная таблица, а не колонка в items, потому что слот обязан быть
 * занят не более чем одним предметом — это выражается уникальностью
 * первичного ключа и не зависит от корректности серверного кода.
 */
export const equipment = pgTable(
  'equipment',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    slot: equipmentSlotEnum('slot').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('equipment_player_slot_idx').on(table.playerId, table.slot),
    // Один предмет не может быть надет в два слота одновременно.
    uniqueIndex('equipment_item_idx').on(table.itemId),
  ],
);
