import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth.ts';

/**
 * players — игровой профиль. GDD §2.3.
 *
 * Инвариант 1: строки этой таблицы правит только сервер. Клиент не имеет
 * ни роли в БД, ни строки подключения, ни эндпоинта, принимающего эти
 * поля от него. Именно здесь в v1.0 золото правилось из devtools.
 *
 * Стартовые значения статов сознательно заданы в БД, а не в коде: игрок,
 * созданный миграцией, обходом или скриптом, получит те же числа.
 */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Связь 1:1 с учётной записью Better Auth. */
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),

    username: text('username').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    level: integer('level').notNull().default(1),
    xp: integer('xp').notNull().default(0),
    paragonPoints: integer('paragon_points').notNull().default(0),
    gold: integer('gold').notNull().default(0),

    statAtk: integer('stat_atk').notNull().default(5),
    statDef: integer('stat_def').notNull().default(5),
    statAgi: integer('stat_agi').notNull().default(5),
    statSpd: integer('stat_spd').notNull().default(5),

    /**
     * Максимум HP не хранится: он считается по формуле GDD §3.2 из DEF,
     * уровня и бонусов путей. Хранить оба числа значит однажды их
     * рассинхронизировать — ровно баг №2 из аудита v1.0.
     */
    hpCurrent: integer('hp_current').notNull().default(90),

    elo: integer('elo').notNull().default(1000),
    seasonId: integer('season_id'),

    /** Титул для аккаунтов из v1.0. GDD §10, раздел о миграции. */
    founder: boolean('founder').notNull().default(false),
  },
  (table) => [
    // Имя уникально без учёта регистра: «Гром» и «гром» — один игрок.
    uniqueIndex('players_username_lower_idx').on(sql`lower(${table.username})`),

    // Границы, которые не должен уметь нарушить даже баг в серверном коде.
    check('players_level_range', sql`${table.level} between 1 and 40`),
    check('players_xp_non_negative', sql`${table.xp} >= 0`),
    check('players_gold_non_negative', sql`${table.gold} >= 0`),
    check('players_paragon_non_negative', sql`${table.paragonPoints} >= 0`),
    check('players_hp_non_negative', sql`${table.hpCurrent} >= 0`),
    check('players_elo_non_negative', sql`${table.elo} >= 0`),
  ],
);

export type PlayerRow = typeof players.$inferSelect;
export type NewPlayerRow = typeof players.$inferInsert;
