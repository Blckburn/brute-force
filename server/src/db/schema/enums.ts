import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Перечисления БД. Держим их отдельно, потому что на них ссылаются
 * несколько таблиц, а drizzle-kit генерирует CREATE TYPE один раз.
 *
 * Значения дублируют константы из @bruteforce/shared, и это осознанно:
 * пакет shared собирается для браузера, тянуть в него схему БД нельзя.
 * Совпадение наборов проверяется тестом server/src/db/__tests__.
 */

/** GDD §6.4. */
export const zoneEnum = pgEnum('zone', [
  'wastes',
  'warcamp',
  'catacombs',
  'forge',
  'abyss',
  'rift',
]);

/** GDD §6.3. */
export const difficultyEnum = pgEnum('difficulty', ['normal', 'dangerous', 'nightmare']);

/** GDD §4.3, восемь слотов. */
export const equipmentSlotEnum = pgEnum('equipment_slot', [
  'weapon',
  'offhand',
  'helmet',
  'chest',
  'bracers',
  'boots',
  'amulet',
  'ring',
]);

/** GDD §5.2. */
export const rarityEnum = pgEnum('rarity', ['common', 'magic', 'rare', 'epic', 'legendary']);

/** Где лежит предмет. GDD §2.3. */
export const containerEnum = pgEnum('container', ['inv', 'stash', 'equipped']);

/** Состояние забега. GDD §6.2. */
export const runStateEnum = pgEnum('run_state', ['active', 'extracted', 'wiped']);

/** Исход боя с точки зрения игрока. */
export const battleResultEnum = pgEnum('battle_result', ['win', 'loss']);
