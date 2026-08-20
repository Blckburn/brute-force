import type { BattleEvent, CombatBalance, StatusId } from '@extramundum/shared';

import type { FighterState } from './fighter.js';
import type { Rng } from './rng.js';

/**
 * Статусы как система. GDD §4.4.
 *
 * ЭТАП M1a: объявлен интерфейс и точка вызова в цикле боя. Ни одного
 * статуса не реализовано — это M1b.
 *
 * Почему интерфейс появляется раньше реализации: место статусов
 * в порядке операций — часть контракта. GDD §4.1 говорит «тикнуть
 * статусы» после действий тика, и если это место не занять сейчас,
 * позже его вставят наугад, а порядок операций в бою определяет,
 * убьёт ли кровотечение до удара или после.
 *
 * Чего здесь намеренно нет: пустых реализаций конкретных статусов.
 * Заглушка `bleed`, которая ничего не делает, — это ровно тот случай
 * из аудита v1.0, где описание есть, а поведения нет (GDD §13, пункт 3).
 * Пустой реестр честнее: он не притворяется.
 */

export type StatusContext = {
  readonly self: FighterState;
  readonly opponent: FighterState;
  readonly balance: CombatBalance;
  readonly rng: Rng;
};

export type Status = {
  readonly id: StatusId;
  stacks: number;
  /** Длительность в тиках. -1 — до конца боя. */
  duration: number;
  /** Урон или лечение за тик. */
  tick?(ctx: StatusContext): readonly BattleEvent[];
  /** Изменение статов, пока активен. */
  modify?(ctx: StatusContext): void;
  onExpire?(ctx: StatusContext): readonly BattleEvent[];
};

/**
 * Тик всех статусов на обоих бойцах.
 *
 * M1a: возвращает пустой список. Сигнатура окончательная — когда
 * появятся статусы, поменяется тело, а не цикл боя.
 */
export function tickStatuses(
  _fighters: readonly [FighterState, FighterState],
  _balance: CombatBalance,
  _rng: Rng,
): readonly BattleEvent[] {
  return [];
}
