import type { ArmorClass, CombatBalance, FighterConfig, WeaponClass } from '@extramundum/shared';

import { activeModifiers, type StatusInstance } from './statuses.js';

/**
 * Производные величины бойца. GDD §4.2.
 *
 * Всё, что здесь считается, считается ОДИН раз при входе в бой и дальше
 * не пересчитывается. Причина — пункт 2 аудита v1.0: там
 * `applyEquippedToFighter` заново выводил максимум HP по формуле при
 * каждом входе в бой и молча стирал бонусы путей. Три билда из десяти
 * не работали, и никто не замечал, потому что число выглядело правдоподобно.
 */

/** Изменяемое состояние бойца по ходу боя. */
export type FighterState = {
  readonly config: FighterConfig;
  readonly maxHp: number;
  hp: number;
  /** Накопитель инициативы. GDD §4.1. */
  initiative: number;
  /** Активные статусы. Могут быть несколько экземпляров одного вида. */
  statuses: StatusInstance[];
  /**
   * Пропустил ли боец ПРЕДЫДУЩИЙ свой ход из-за контроля.
   *
   * Защита от стан-лока (GDD §4.4) — жёсткое правило, а не вероятность:
   * пропустивший ход не может быть остановлен снова на следующем.
   * Без этого достаточно двух источников стана, чтобы боец не сходил
   * ни разу за бой, и это не баланс, а неиграбельность.
   */
  skippedLastTurn: boolean;
};

/**
 * Максимум HP: `60 + DEF × 6 + уровень × 14 + бонусы_путей` (GDD §4.2).
 *
 * `pathBonusHp` СКЛАДЫВАЕТСЯ, а не выводится. Единственная функция,
 * считающая максимум HP, — эта; второй такой нет и быть не должно,
 * иначе повторится расхождение v1.0.
 */
export function maxHp(config: FighterConfig, balance: CombatBalance): number {
  const { base, perDef, perLevel } = balance.maxHp;
  return base + config.def * perDef + config.level * perLevel + config.pathBonusHp;
}

export function createFighterState(config: FighterConfig, balance: CombatBalance): FighterState {
  const hp = maxHp(config, balance);
  return { config, maxHp: hp, hp, initiative: 0, statuses: [], skippedLastTurn: false };
}

/* ───────────────────────── эффективные значения ──────────────────────── */

/**
 * Статы с учётом активных статусов.
 *
 * Считаются из БАЗЫ плюс сумма модификаторов при каждом обращении,
 * а не хранятся. Хранимое значение пришлось бы возвращать к исходному
 * при истечении статуса — и однажды это забыли бы сделать, а величина
 * поехала бы на весь бой. Это ровно баг v1.0 с HP от путей (GDD §13,
 * пункт 2), только в другом месте.
 *
 * `maxHp` сюда не входит намеренно: он вычисляется один раз при входе
 * в бой, и статусы его не меняют. Плавающий максимум HP означал бы, что
 * при истечении статуса надо решать, что делать с текущим HP выше нового
 * максимума, — вопрос, которого GDD не ставит.
 */
export type EffectiveStats = {
  readonly atk: number;
  readonly agi: number;
  readonly spd: number;
  readonly armor: number;
  readonly accuracy: number;
  /** Прибавка к множителю атаки от статусов. 0 — статусов нет. */
  readonly attackMultiplierBonus: number;
};

export function effectiveStats(fighter: FighterState, balance: CombatBalance): EffectiveStats {
  const base = fighter.config;

  // Быстрый путь: пока статусов нет, считать нечего.
  if (fighter.statuses.length === 0) {
    return {
      atk: base.atk,
      agi: base.agi,
      spd: base.spd,
      armor: base.armor,
      accuracy: base.accuracy,
      attackMultiplierBonus: 0,
    };
  }

  const m = activeModifiers(fighter, balance);

  return {
    // Статы не уходят ниже нуля: отрицательная ловкость означала бы
    // отрицательный шанс уклонения, а отрицательная броня — лечение
    // от удара.
    atk: Math.max(0, base.atk + (m.atk ?? 0)),
    agi: Math.max(0, base.agi + (m.agi ?? 0)),
    spd: Math.max(0, base.spd + (m.spd ?? 0)),
    armor: Math.max(0, (base.armor + (m.armor ?? 0)) * (m.armorMultiplier ?? 1)),
    accuracy: Math.max(0, base.accuracy + (m.accuracy ?? 0)),
    attackMultiplierBonus: m.attackMultiplierBonus ?? 0,
  };
}

/**
 * Множитель уровня предмета: `1 + ilvl × коэффициент` (GDD §6.1).
 * Масштабирует базу оружия, поэтому входит в разбор броска отдельным
 * числом — игрок должен видеть вклад ilvl, а не получать готовый итог.
 */
export function ilvlScale(ilvl: number, balance: CombatBalance): number {
  return 1 + ilvl * balance.items.ilvlScale;
}

/** Множитель матчапа «класс оружия × класс брони». GDD §4.3. */
export function matchupMultiplier(
  weapon: WeaponClass,
  armor: ArmorClass,
  balance: CombatBalance,
): number {
  const row = balance.matchup[weapon];
  const value = row?.[armor];
  // Пустая клетка таблицы — это ошибка данных, а не повод молча бить
  // с множителем 1: так незаметно исчезла бы вся система матчапов.
  if (value === undefined) {
    throw new Error(`balance.matchup: нет клетки «${weapon} × ${armor}»`);
  }
  return value;
}

/**
 * Шанс уклонения: `clamp(base + (AGI_защ − ACC_атак) × k, min, max)`.
 * GDD §4.2. ACC — производная из экипировки, без аффиксов ноль.
 */
export function dodgeChance(
  defenderAgi: number,
  attackerAccuracy: number,
  balance: CombatBalance,
): number {
  const { base, perAgiOverAccuracy, min, max } = balance.dodge;
  const raw = base + (defenderAgi - attackerAccuracy) * perAgiOverAccuracy;
  return Math.min(max, Math.max(min, raw));
}

/** Шанс крита: `base + AGI × k + бонусы`, с капом. GDD §4.2. */
export function critChance(agi: number, critBonus: number, balance: CombatBalance): number {
  const { base, perAgi, cap } = balance.crit;
  return Math.min(cap, base + agi * perAgi + critBonus);
}

/**
 * Митигация бронёй: `ARM / (ARM + C + k × уровень_атакующего)`, кап 75%.
 * GDD §4.2.
 *
 * Уровень берётся у АТАКУЮЩЕГО: одна и та же броня хуже держит удар
 * противника выше уровнем. Это то, что не даёт броне решать бой в одиночку.
 */
export function mitigation(
  defenderArmor: number,
  attackerLevel: number,
  balance: CombatBalance,
): number {
  const { armorConstant, armorPerAttackerLevel, cap } = balance.damage.mitigation;
  const denominator = defenderArmor + armorConstant + armorPerAttackerLevel * attackerLevel;
  if (denominator <= 0) return 0;
  return Math.min(cap, defenderArmor / denominator);
}

/**
 * Множитель ATK: `(1 + ATK / делитель) × (1 + прибавки статусов)`.
 * ATK множит урон, а не прибавляется к нему (GDD §4.2).
 *
 * Прибавка статусов входит СЮДА, а не отдельным полем разбора: `enrage`
 * по §7.5 даёт «+50% урона», и как множитель атаки это ровно +50%.
 * Отдельное поле в `RollBreakdown` означало бы правку формата лога;
 * складывать же его с чем-то другим было бы неверно арифметически.
 */
export function atkMultiplier(atk: number, balance: CombatBalance, statusBonus = 0): number {
  return (1 + atk / balance.damage.atkDivisor) * (1 + statusBonus);
}
