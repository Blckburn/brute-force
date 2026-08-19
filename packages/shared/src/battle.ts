import { z } from 'zod';

/** Зоны рейда. GDD §7.4. */
export const ZONE_IDS = ['wastes', 'warcamp', 'catacombs', 'forge', 'abyss', 'rift'] as const;
export const zoneIdSchema = z.enum(ZONE_IDS);
export type ZoneId = z.infer<typeof zoneIdSchema>;

/** Тиры сложности. GDD §7.3. */
export const DIFFICULTIES = ['normal', 'dangerous', 'nightmare'] as const;
export const difficultySchema = z.enum(DIFFICULTIES);
export type Difficulty = z.infer<typeof difficultySchema>;

/**
 * Хеш текущей экипировки. Клиент присылает его, чтобы сервер мог
 * обнаружить рассинхрон («ты собирался идти вот в этом, а в базе другое»)
 * и чтобы кэшировать превью (GDD §6.4).
 *
 * Это НЕ источник данных о снаряжении: состав экипировки сервер читает
 * из БД (инвариант 1, GDD §3.2 шаг 1). Хеш — только для сверки и кэша.
 */
export const loadoutHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const battleStartInputSchema = z.object({
  zone: zoneIdSchema,
  difficulty: difficultySchema,
  loadoutHash: loadoutHashSchema,
});
export type BattleStartInput = z.infer<typeof battleStartInputSchema>;

export const simulatePreviewInputSchema = z.object({
  zone: zoneIdSchema,
  difficulty: difficultySchema,
  loadoutHash: loadoutHashSchema,
  /**
   * Сколько прогонов Монте-Карло. GDD §6.4 фиксирует 300; параметр
   * ограничен сверху, чтобы запрос не превращался в способ нагрузить сервер.
   */
  runs: z.int().min(50).max(300).default(300),
});
export type SimulatePreviewInput = z.infer<typeof simulatePreviewInputSchema>;

/**
 * Формат боевого лога определяется в M1 вместе с движком (GDD §3.2).
 * В M0 эндпоинты отвечают 501, поэтому тип объявлен, но не раскрыт:
 * раскрывать его сейчас значило бы проектировать движок раньше срока.
 */
export type BattleLog = {
  readonly version: number;
  readonly events: readonly unknown[];
};

export type BattleStartResponse = {
  readonly battleId: string;
  readonly log: BattleLog;
};

export type SimulatePreviewResponse = {
  /** Оценка шанса победы, 0..1. */
  readonly winRate: number;
  readonly runs: number;
};
