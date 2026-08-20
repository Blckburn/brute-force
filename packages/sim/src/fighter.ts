import type { ArmorClass, CombatBalance, FighterConfig, WeaponClass } from '@extramundum/shared';

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
  return { config, maxHp: hp, hp, initiative: 0 };
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

/** Множитель ATK: `1 + ATK / делитель`. ATK множит урон, а не прибавляется к нему. */
export function atkMultiplier(atk: number, balance: CombatBalance): number {
  return 1 + atk / balance.damage.atkDivisor;
}
