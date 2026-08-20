import type {
  ActorIndex,
  BattleEvent,
  BattleResult,
  BattleSetup,
  CombatBalance,
} from '@extramundum/shared';

import { resolveAttack } from './damage.js';
import { createFighterState, type FighterState } from './fighter.js';
import { rngFromSeed, type Rng } from './rng.js';
import { tickStatuses } from './statuses.js';

/** Версия формата лога. Инкрементируется при несовместимых изменениях. */
export const LOG_VERSION = 1;

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
 * Это не оптимизация и не стиль. Как только появится первый трейт вида
 * «добивает раненых», предгенерация начнёт врать — и врать незаметно.
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
  const { initiativeThreshold, limit } = balance.tick;

  let tick = 0;
  let winner: ActorIndex | null = null;

  outer: while (tick < limit) {
    for (const f of fighters) f.initiative += f.config.spd;

    for (const actor of actingOrder(fighters, initiativeThreshold, rng)) {
      const attacker = fighters[actor];
      const defenderIndex: ActorIndex = actor === 0 ? 1 : 0;
      const defender = fighters[defenderIndex];

      // Порог вычитается независимо от того, чем кончится ход: право
      // на действие уже израсходовано.
      attacker.initiative -= initiativeThreshold;

      if (attacker.hp <= 0 || defender.hp <= 0) continue;

      events.push({ t: 'turn_start', actor, tick });

      const outcome = resolveAttack(attacker, defender, balance, rng, actor, defenderIndex);
      events.push(...outcome.events);

      if (outcome.kind === 'hit') {
        // Мутация состояния здесь и только здесь.
        defender.hp = Math.max(0, defender.hp - outcome.damage);
        events.push({
          t: 'damage',
          target: defenderIndex,
          amount: outcome.damage,
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

    // Статусы тикают после всех действий тика (GDD §4.1). В M1a реестр
    // пуст, поэтому вызов ничего не порождает — но место в порядке
    // операций занято сейчас, а не будет вставлено потом наугад.
    events.push(...tickStatuses(fighters, balance, rng));

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
