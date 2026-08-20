import { z } from 'zod';

/**
 * Контракт боевого движка. GDD §3.2, §4.
 *
 * Типы живут здесь, а не в `@extramundum/sim`, потому что этот же формат
 * потребляет рендер из M2 — а он исполняется в браузере, куда движок
 * не попадает никогда (инвариант 3). Движок импортирует эти типы через
 * `import type`: такой импорт стирается при компиляции и рантайм-ребра
 * не создаёт. Причина и подпорки — docs/adr/0003-tipy-kontrakta-v-shared.md.
 *
 * Здесь только форма данных. Ни одной формулы: формулы — в движке,
 * коэффициенты — в packages/data/balance.json (инвариант 5).
 */

/* ────────────────────────── классы снаряжения ────────────────────────── */

/** Класс оружия. GDD §4.3. */
export const WEAPON_CLASSES = ['light', 'balanced', 'heavy'] as const;
export const weaponClassSchema = z.enum(WEAPON_CLASSES);
export type WeaponClass = z.infer<typeof weaponClassSchema>;

/** Класс брони. GDD §4.3. */
export const ARMOR_CLASSES = ['cloth', 'light', 'medium', 'heavy'] as const;
export const armorClassSchema = z.enum(ARMOR_CLASSES);
export type ArmorClass = z.infer<typeof armorClassSchema>;

/* ──────────────────────────────── статусы ────────────────────────────── */

/**
 * Стартовый набор статусов. GDD §4.4.
 *
 * Порядок в этом массиве — КАНОНИЧЕСКИЙ порядок разрешения внутри одной
 * категории (см. `STATUS_ORDER` в движке). Он объявлен здесь, а не в
 * движке, потому что рендер обязан раскладывать иконки в том же порядке:
 * иначе одинаковый бой будет выглядеть по-разному.
 */
export const STATUS_IDS = [
  'bleed',
  'poison',
  'burn',
  'stun',
  'hex',
  'fury',
  'regen',
  'shield',
  'enrage',
  'chill',
] as const;
export const statusIdSchema = z.enum(STATUS_IDS);
export type StatusId = z.infer<typeof statusIdSchema>;

/* ──────────────────────────── конфигурация бойца ─────────────────────── */

export const weaponConfigSchema = z.object({
  /** Урон оружия. Эти числа участвуют в расчёте НАПРЯМУЮ (GDD §4.2). */
  dmgMin: z.number().min(0),
  dmgMax: z.number().min(0),
  /** Уровень предмета: масштабирует базу, GDD §6.1. */
  ilvl: z.int().min(1),
  class: weaponClassSchema,
});
export type WeaponConfig = z.infer<typeof weaponConfigSchema>;

/**
 * Щит в оффхенде. GDD §5.3: оффхенд может быть щитом, вторым оружием
 * или фокусом. В M1a реализован только щит — остальное меняет урон
 * и эффекты статусов, то есть относится к M1b и позже.
 */
export const shieldConfigSchema = z.object({
  blockChance: z.number().min(0).max(1),
  /** Насколько блок гасит урон: 0.6–1.0 (GDD §4.2). */
  blockReduction: z.number().min(0).max(1),
});
export type ShieldConfig = z.infer<typeof shieldConfigSchema>;

export const fighterConfigSchema = z.object({
  level: z.int().min(1),

  /** Четыре базовые характеристики. GDD §3.3. Пятой нет и не будет. */
  atk: z.number().min(0),
  def: z.number().min(0),
  agi: z.number().min(0),
  spd: z.number().min(0),

  /**
   * Бонусы HP от путей уровня. ОТДЕЛЬНОЕ ПОЛЕ, а не пересчёт из уровня.
   *
   * В v1.0 `applyEquippedToFighter` считал максимум HP по формуле заново
   * и молча стирал бонусы путей GUARDIAN, IRON и TITAN — три билда
   * из десяти не работали (GDD §13, пункт 2). Поэтому хранится здесь
   * и складывается с формулой, а не выводится из неё.
   */
  pathBonusHp: z.number().min(0).default(0),

  /**
   * Точность. Производная величина из экипировки, не базовый стат
   * (GDD §4.2). Без соответствующих аффиксов — ноль.
   */
  accuracy: z.number().min(0).default(0),

  /** Суммарная броня со всех слотов. */
  armor: z.number().min(0).default(0),
  armorClass: armorClassSchema,

  /** Прибавка к шансу крита от аффиксов, сверх формулы от AGI. */
  critBonus: z.number().min(0).default(0),

  weapon: weaponConfigSchema,
  /** null — оффхенд пуст или занят не щитом. */
  shield: shieldConfigSchema.nullable().default(null),

  /**
   * Статусы, с которыми боец входит в бой.
   *
   * В M1b это единственный способ их выдать: трейты (M1c) и предметы
   * с эффектами (M3) появятся позже. Поле нужно и потом — босс входит
   * в бой уже под `enrage`, зона может накладывать эффект на входе.
   */
  statuses: z
    .array(
      z.object({
        id: statusIdSchema,
        stacks: z.int().min(1),
        /** -1 — до конца боя. */
        duration: z.int().min(-1),
      }),
    )
    .default([]),
});
export type FighterConfig = z.infer<typeof fighterConfigSchema>;

/** Двое бойцов: индекс в этом кортеже и есть `actor` в событиях лога. */
export const battleSetupSchema = z.tuple([fighterConfigSchema, fighterConfigSchema]);
export type BattleSetup = z.infer<typeof battleSetupSchema>;

/* ──────────────────────────── коэффициенты ───────────────────────────── */

/**
 * Срез balance.json, который нужен движку.
 *
 * Движок не читает файлов (инвариант 2) — коэффициенты приходят
 * аргументом. Схема существует, чтобы сервер проверил их один раз
 * при загрузке, а не ловил `undefined` посреди боя.
 */
const matchupRowSchema = z.object({
  cloth: z.number(),
  light: z.number(),
  medium: z.number(),
  heavy: z.number(),
});

export const combatBalanceSchema = z.object({
  damage: z.object({
    atkDivisor: z.number().positive(),
    critMultiplier: z.number().positive(),
    mitigation: z.object({
      armorConstant: z.number(),
      armorPerAttackerLevel: z.number(),
      cap: z.number().min(0).max(1),
    }),
  }),
  dodge: z.object({
    base: z.number(),
    perAgiOverAccuracy: z.number(),
    min: z.number().min(0).max(1),
    max: z.number().min(0).max(1),
  }),
  crit: z.object({
    base: z.number(),
    perAgi: z.number(),
    cap: z.number().min(0).max(1),
  }),
  block: z.object({
    chanceMin: z.number().min(0).max(1),
    chanceMax: z.number().min(0).max(1),
    reductionMin: z.number().min(0).max(1),
    reductionMax: z.number().min(0).max(1),
  }),
  maxHp: z.object({
    base: z.number(),
    perDef: z.number(),
    perLevel: z.number(),
  }),
  // Явные ключи, а не z.record: классы фиксированы, а забытая клетка
  // должна валить загрузку баланса, а не всплывать посреди боя.
  // Пояснительные поля `$source` и `$note` из balance.json отбрасываются.
  matchup: z.object({
    light: matchupRowSchema,
    balanced: matchupRowSchema,
    heavy: matchupRowSchema,
  }),
  items: z.object({ ilvlScale: z.number() }),

  /**
   * Коэффициенты статусов. GDD §4.4 задаёт систему и набор эффектов,
   * но НЕ ДАЁТ НИ ОДНОГО ЧИСЛА — кроме enrage в §7.5. Всё остальное
   * назначено при реализации и помечено в balance.json как ожидающее
   * калибровки: их выверит матрица винрейтов §4.6, то есть M1c.
   */
  statuses: z.object({
    /** Кап экземпляров одного статуса на бойце. Защита от бесконечного стака. */
    maxInstances: z.int().positive(),
    bleed: z.object({ damagePerStack: z.number(), duration: z.int() }),
    poison: z.object({ damagePerStack: z.number(), duration: z.int() }),
    burn: z.object({ damagePerStack: z.number(), duration: z.int() }),
    regen: z.object({ healPerStack: z.number(), duration: z.int() }),
    stun: z.object({ duration: z.int() }),
    shield: z.object({ absorbPerStack: z.number(), duration: z.int() }),
    hex: z.object({ atkPerStack: z.number(), duration: z.int() }),
    fury: z.object({ atkPerStack: z.number(), duration: z.int() }),
    chill: z.object({ spdPerStack: z.number(), duration: z.int() }),
    enrage: z.object({
      /** Прибавка к множителю атаки: 0.5 значит ×1.5 урона (GDD §7.5). */
      attackMultiplierBonus: z.number(),
      /** Множитель брони: 0.8 значит −20% защиты (GDD §7.5). */
      armorMultiplier: z.number(),
      duration: z.int(),
    }),
  }),
  tick: z.object({
    initiativeThreshold: z.number().positive(),
    limit: z.int().positive(),
  }),
});
export type CombatBalance = z.infer<typeof combatBalanceSchema>;

/* ────────────────────────────── боевой лог ───────────────────────────── */

/** Индекс бойца. 0 и 1 — позиции в `BattleSetup`. */
export type ActorIndex = 0 | 1;

/**
 * Вид действия. В M1a есть только обычный удар: приёмы, способности
 * и реакции появятся вместе со статусами и трейтами.
 */
export const MOVE_KINDS = ['basic'] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

/**
 * Полный разбор броска. GDD §3.2: «клиент показывает их в тултипе
 * журнала боя».
 *
 * Здесь лежат ВСЕ промежуточные числа, а не только итог. Это не отладка,
 * а единственное, что есть у игрока в автобаттлере: вмешаться он не может,
 * значит должен хотя бы понимать, откуда взялась цифра. Поле, которое
 * не попало сюда, для игрока не существует.
 *
 * Произведение полей должно давать `final` — на это есть тест.
 */
export type RollBreakdown = {
  /** Шаг 3: бросок урона оружия до масштабирования по ilvl. */
  readonly weaponRoll: number;
  /** Шаг 3: множитель уровня предмета, 1 + ilvl × коэффициент (GDD §6.1). */
  readonly ilvlScale: number;
  /** Шаг 4: 1 + ATK / делитель. */
  readonly atkMultiplier: number;
  /** Шаг 5: «класс оружия × класс брони» (GDD §4.3). */
  readonly matchupMultiplier: number;
  /** Шаг 6: доля поглощённого бронёй урона, 0..кап. */
  readonly mitigation: number;
  /** Шаг 7: множитель крита либо 1. */
  readonly critMultiplier: number;
  /** Шаг 2: доля, снятая блоком, либо 0. */
  readonly blockReduction: number;
  /** Итог после всех шагов, округлённый. */
  readonly final: number;
};

/**
 * Идентификаторы статусов и трейтов. GDD §4.4 и §4.5.
 *
 * Объявлены сейчас, реализация — M1b и M1c. Причина: события ссылаются
 * на них, а формат лога — контракт с рендером. Добавить вариант в union
 * позже дешевле, чем поменять форму события, когда рендер уже написан.
 */

/**
 * Номер экземпляра статуса, уникальный в пределах боя.
 *
 * Кровотечение и яд стакаются НЕЗАВИСИМЫМИ экземплярами (GDD §4.4):
 * два наложения — это две записи со своими таймерами, а не одна
 * с обновлённой длительностью. Без номера рендер не свяжет
 * `status_apply` с его же `status_expire` и не поймёт, какая из двух
 * иконок погасла.
 *
 * `stacks` в событиях относится к ЭТОМУ экземпляру, а не к сумме
 * по идентификатору: сумму рендер сложит сам, разложить её обратно
 * он бы не смог.
 */
export type StatusInstanceId = number;

/** Трейты появятся в M1c; тип объявлен, набор пока пуст. */
export type TraitId = string;

/**
 * Событие боевого лога. GDD §3.2.
 *
 * `status_*` и `trait_fire` зарезервированы: движок их пока не порождает,
 * но рендер из M2 должен уметь их принять с первого дня, иначе M1b
 * и M1c сломают уже написанный проигрыватель.
 */
export type BattleEvent =
  | { readonly t: 'turn_start'; readonly actor: ActorIndex; readonly tick: number }
  | {
      readonly t: 'attack';
      readonly actor: ActorIndex;
      readonly move: MoveKind;
      readonly roll: RollBreakdown;
    }
  | { readonly t: 'dodge'; readonly actor: ActorIndex; readonly mitigated: number }
  | { readonly t: 'block'; readonly actor: ActorIndex; readonly mitigated: number }
  | {
      readonly t: 'damage';
      readonly target: ActorIndex;
      readonly amount: number;
      readonly crit: boolean;
      readonly hpAfter: number;
    }
  | {
      readonly t: 'status_apply';
      readonly target: ActorIndex;
      readonly instance: StatusInstanceId;
      readonly status: StatusId;
      readonly stacks: number;
      /** В тиках. -1 — до конца боя. */
      readonly duration: number;
    }
  | {
      readonly t: 'status_tick' | 'status_expire';
      readonly target: ActorIndex;
      readonly instance: StatusInstanceId;
      readonly status: StatusId;
      readonly stacks: number;
      /**
       * Сколько эффект дал урона или лечения в этот тик. Игрок должен
       * видеть «яд снял 7», а не «яд сработал» — тот же принцип, что
       * и в `RollBreakdown`. У `status_expire` поля нет.
       */
      readonly amount?: number;
    }
  | {
      readonly t: 'trait_fire';
      readonly actor: ActorIndex;
      readonly trait: TraitId;
      readonly note?: string;
    }
  | { readonly t: 'death'; readonly actor: ActorIndex };

/**
 * Лог боя — последовательность событий, а не итог (GDD §3.2). Итог
 * хранится отдельно, в `battles.result`; из лога его можно вывести,
 * но лог не обязан его дублировать.
 */
export type BattleLog = {
  readonly version: number;
  /** Сид, из которого бой воспроизводится побитово. */
  readonly seed: string;
  readonly events: readonly BattleEvent[];
};

/** Итог боя. Возвращается движком рядом с логом, в сам лог не входит. */
export type BattleOutcome = {
  /** null — бой упёрся в лимит тиков и не завершился. */
  readonly winner: ActorIndex | null;
  readonly ticks: number;
  readonly hpRemaining: readonly [number, number];
};

export type BattleResult = {
  readonly log: BattleLog;
  readonly outcome: BattleOutcome;
};
