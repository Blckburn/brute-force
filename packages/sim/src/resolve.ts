import type {
  ActorIndex,
  BattleEvent,
  BattleResult,
  BattleSetup,
  CombatBalance,
} from '@extramundum/shared';

import { resolveAttack } from './damage.js';
import { createFighterState, effectiveStats, type FighterState } from './fighter.js';
import { rngFromSeed, type Rng } from './rng.js';
import {
  absorbDamage,
  actionPrevented,
  applyStatus,
  createStatusClock,
  tickFighterStatuses,
  STATUS_ORDER,
  type StatusClock,
} from './statuses.js';

/** Версия формата лога. Инкрементируется при несовместимых изменениях. */
export const LOG_VERSION = 2;

/**
 * Разрешение боя. GDD §4.1.
 *
 * ```
 * tick = 0
 * пока оба живы и tick < LIMIT:
 *     для каждого бойца: initiative += spd
 *     кто перешёл порог — действует (порядок при равенстве — по seed)
 *     initiative -= порог
 *     ─ разрешить действие ПОЛНОСТЬЮ, мутируя состояние ─
 *     тикнуть статусы
 *     tick++
 * ```
 *
 * **Очередь не предгенерируется.** Это пункт 1 аудита v1.0 и главная
 * причина, по которой тот баланс нельзя было отладить: `buildQueue()`
 * строил 42 действия до начала боя, и всё, что зависит от состояния —
 * проверка HP цели, накопленные стаки, кровотечение, — считалось
 * в вакууме. Здесь действие разрешается в момент своего хода и сразу
 * меняет состояние; следующее действие видит результат предыдущего.
 *
 * **Статусов в этом файле нет ни одного по имени.** Ни `stun`, ни
 * `shield`, ни `bleed` тут не упоминаются: цикл вызывает общие хуки,
 * а какой эффект что делает — знает только реестр. Как только здесь
 * появится `if (id === '...')`, интерфейс спроектирован неверно.
 */
export function resolveBattle(
  setup: BattleSetup,
  balance: CombatBalance,
  seed: string,
): BattleResult {
  const rng = rngFromSeed(seed);
  const fighters: [FighterState, FighterState] = [
    createFighterState(setup[0], balance),
    createFighterState(setup[1], balance),
  ];

  const events: BattleEvent[] = [];
  const clock = createStatusClock();
  const { initiativeThreshold, limit } = balance.tick;

  // Стартовые статусы: босс входит в бой уже под enrage, зона может
  // наложить эффект на входе. В M1b это ещё и единственный способ
  // выдать статус, пока нет трейтов.
  applyStartingStatuses(fighters, balance, clock, events);

  let tick = 0;
  let winner: ActorIndex | null = null;

  outer: while (tick < limit) {
    for (const f of fighters) f.initiative += effectiveStats(f, balance).spd;

    for (const actor of actingOrder(fighters, initiativeThreshold, rng)) {
      const attacker = fighters[actor];
      const defenderIndex: ActorIndex = actor === 0 ? 1 : 0;
      const defender = fighters[defenderIndex];

      // Порог вычитается независимо от того, чем кончится ход: право
      // на действие уже израсходовано, в том числе если ход пропущен.
      attacker.initiative -= initiativeThreshold;

      if (attacker.hp <= 0 || defender.hp <= 0) continue;

      // Контроль. Защита от лока — жёсткое правило: боец, пропустивший
      // предыдущий ход, действует независимо от того, что на нём висит.
      if (actionPrevented(attacker, STATUS_ORDER) && !attacker.skippedLastTurn) {
        attacker.skippedLastTurn = true;
        continue;
      }
      attacker.skippedLastTurn = false;

      events.push({ t: 'turn_start', actor, tick });

      const outcome = resolveAttack(attacker, defender, balance, rng, actor, defenderIndex);
      events.push(...outcome.events);

      if (outcome.kind === 'hit') {
        // Поглощение стоит между расчётом и применением: щит съедает
        // часть удара и расходуется, а в лог идёт число, а не факт.
        const absorbed = absorbDamage(
          defender,
          defenderIndex,
          outcome.damage,
          balance,
          STATUS_ORDER,
        );
        events.push(...absorbed.events);

        defender.hp = Math.max(0, defender.hp - absorbed.remaining);
        events.push({
          t: 'damage',
          target: defenderIndex,
          amount: absorbed.remaining,
          crit: outcome.crit,
          hpAfter: defender.hp,
        });
      }

      if (defender.hp <= 0) {
        events.push({ t: 'death', actor: defenderIndex });
        winner = actor;
        break outer;
      }
    }

    // Статусы тикают после всех действий тика (GDD §4.1).
    for (const index of [0, 1] as const) {
      const fighter = fighters[index];
      if (fighter.hp <= 0) continue;

      const result = tickFighterStatuses(fighter, index, balance, STATUS_ORDER);
      events.push(...result.events);

      if (fighter.hp <= 0) {
        events.push({ t: 'death', actor: index });
        winner = index === 0 ? 1 : 0;
        break outer;
      }
    }

    tick++;
  }

  return {
    log: { version: LOG_VERSION, seed, events },
    outcome: {
      winner,
      ticks: tick,
      hpRemaining: [fighters[0].hp, fighters[1].hp],
    },
  };
}

function applyStartingStatuses(
  fighters: readonly [FighterState, FighterState],
  balance: CombatBalance,
  clock: StatusClock,
  events: BattleEvent[],
): void {
  for (const index of [0, 1] as const) {
    const fighter = fighters[index];
    for (const starting of fighter.config.statuses) {
      events.push(
        ...applyStatus(
          fighter,
          index,
          starting.id,
          starting.stacks,
          starting.duration,
          balance,
          clock,
        ),
      );
    }
  }
}

/**
 * Кто действует в этом тике и в каком порядке.
 *
 * Порог могут перейти оба — тогда быстрый действует первым. При РАВНОЙ
 * инициативе порядок решает бросок, а не позиция в массиве: иначе боец 0
 * всегда бил бы первым при равном SPD, и зеркальный бой был бы
 * несимметричным. Бросок идёт из того же генератора, то есть тоже
 * определяется сидом.
 */
function actingOrder(
  fighters: readonly [FighterState, FighterState],
  threshold: number,
  rng: Rng,
): ActorIndex[] {
  const ready: ActorIndex[] = [];
  if (fighters[0].initiative >= threshold) ready.push(0);
  if (fighters[1].initiative >= threshold) ready.push(1);

  if (ready.length < 2) return ready;

  const [a, b] = [fighters[0].initiative, fighters[1].initiative];
  if (a > b) return [0, 1];
  if (b > a) return [1, 0];
  return rng.chance(0.5) ? [0, 1] : [1, 0];
}
