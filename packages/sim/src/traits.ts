import type { BattleEvent, CombatBalance, TraitId } from '@extramundum/shared';

import type { FighterState } from './fighter.js';
import type { Rng } from './rng.js';

/**
 * Трейты как хуки. GDD §4.5.
 *
 * ЭТАП M1a: объявлен интерфейс, реестр пуст. Реализация — M1c.
 *
 * **Правило GDD §4.5: трейта нет в игре, пока нет теста, доказывающего,
 * что он делает то, что написано в описании.** В v1.0 шесть трейтов
 * из семнадцати были заменены на общие множители, а описания остались:
 * THORNS «отражает 15% урона» на деле давал `fDef × 1.05`, PHANTOM
 * «10% полностью избежать удара» — `fAgi × 1.2`, WARLORD не был
 * реализован вовсе (GDD §13, пункт 3).
 *
 * Поэтому реестр пуст, а не заполнен заглушками. Пустота видна;
 * заглушка, притворяющаяся механикой, — нет.
 */

export type TraitContext = {
  readonly self: FighterState;
  readonly opponent: FighterState;
  readonly balance: CombatBalance;
  readonly rng: Rng;
};

export type TraitHooks = {
  onBattleStart?(ctx: TraitContext): readonly BattleEvent[];
  onBeforeAttack?(ctx: TraitContext): readonly BattleEvent[];
  onHit?(ctx: TraitContext): readonly BattleEvent[];
  onTakeDamage?(ctx: TraitContext): readonly BattleEvent[];
  onTurnStart?(ctx: TraitContext): readonly BattleEvent[];
  onKill?(ctx: TraitContext): readonly BattleEvent[];
};

export type Trait = {
  readonly id: TraitId;
  readonly hooks: TraitHooks;
};

/** Реестр трейтов. Пуст до M1c — по правилу §4.5, а не по недоделке. */
export const TRAITS: ReadonlyMap<TraitId, Trait> = new Map();
