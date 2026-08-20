import type { BattleEvent, CombatBalance, RollBreakdown } from '@extramundum/shared';

import {
  atkMultiplier,
  critChance,
  dodgeChance,
  effectiveStats,
  ilvlScale,
  matchupMultiplier,
  mitigation,
  type FighterState,
} from './fighter.js';
import type { Rng } from './rng.js';

/**
 * Пайплайн удара. GDD §4.2, восемь шагов строго по порядку.
 *
 * **Каждый шаг — отдельный бросок.** В v1.0 уклонение и блок делили
 * один `r` внутри `pickMove()`, из-за чего шанс блока зависел от шанса
 * уклонения: поднимаешь AGI — блок работает иначе, хотя щит тот же
 * (GDD §13, пункт 5). Здесь на каждую проверку идёт свой вызов `rng`,
 * и на независимость есть статистический тест.
 *
 * **Числа оружия участвуют напрямую.** `dmgMin/dmgMax` — это урон,
 * ATK — множитель. В v1.0 к ATK прибавлялся средний урон оружия, а потом
 * бралось 80% от суммы, и числа в тултипе не имели отношения
 * к происходящему (GDD §13, пункт 4).
 */

export type AttackOutcome =
  | { readonly kind: 'dodged'; readonly events: readonly BattleEvent[] }
  | {
      readonly kind: 'hit';
      readonly damage: number;
      readonly crit: boolean;
      readonly roll: RollBreakdown;
      readonly events: readonly BattleEvent[];
    };

/**
 * Разрешает один удар и ВОЗВРАЩАЕТ результат, не применяя его.
 * Применение — в resolve.ts, там же, где мутируется состояние: так
 * видно, что урон снимается ровно один раз и ровно в момент хода.
 */
export function resolveAttack(
  attacker: FighterState,
  defender: FighterState,
  balance: CombatBalance,
  rng: Rng,
  attackerIndex: 0 | 1,
  defenderIndex: 0 | 1,
): AttackOutcome {
  const events: BattleEvent[] = [];

  // Статы читаются ОДИН раз на удар и уже с учётом активных статусов.
  // Читать `config` напрямую здесь нельзя: тогда hex, fury и chill
  // существовали бы в описании и не существовали в бою.
  const att = effectiveStats(attacker, balance);
  const def = effectiveStats(defender, balance);

  // ── Шаг 1. Уклонение. Промах, урона нет.
  const dodge = dodgeChance(def.agi, att.accuracy, balance);
  if (rng.chance(dodge)) {
    events.push({ t: 'dodge', actor: defenderIndex, mitigated: 0 });
    return { kind: 'dodged', events };
  }

  // ── Шаг 2. Блок. Только если в оффхенде щит.
  const offhand = defender.config.shield;
  let blockReduction = 0;
  let blocked = false;
  if (offhand !== null) {
    // Отдельный бросок: см. пункт 5 аудита в шапке файла.
    if (rng.chance(offhand.blockChance)) {
      blocked = true;
      blockReduction = offhand.blockReduction;
    }
  }

  // ── Шаг 3. Базовый ролл оружия × масштаб уровня предмета.
  const weapon = attacker.config.weapon;
  const lo = Math.min(weapon.dmgMin, weapon.dmgMax);
  const hi = Math.max(weapon.dmgMin, weapon.dmgMax);
  const weaponRoll = lo + rng.next() * (hi - lo);
  const scale = ilvlScale(weapon.ilvl, balance);

  // ── Шаг 4. Множитель ATK.
  const atkMult = atkMultiplier(att.atk, balance, att.attackMultiplierBonus);

  // ── Шаг 5. Матчап «класс оружия × класс брони».
  const matchup = matchupMultiplier(weapon.class, defender.config.armorClass, balance);

  // ── Шаг 6. Митигация бронёй.
  const dr = mitigation(def.armor, attacker.config.level, balance);

  // ── Шаг 7. Крит. Тоже отдельный бросок.
  const crit = rng.chance(critChance(att.agi, attacker.config.critBonus, balance));
  const critMult = crit ? balance.damage.critMultiplier : 1;

  // ── Шаг 8. Эффекты — M1b и M1c. Здесь их нет, и место под них не занято
  //    заглушками: пустой хук выглядел бы как реализованная механика.

  const beforeBlock = weaponRoll * scale * atkMult * matchup * (1 - dr) * critMult;
  const raw = beforeBlock * (1 - blockReduction);
  const final = Math.max(0, Math.round(raw));

  const roll: RollBreakdown = {
    weaponRoll,
    ilvlScale: scale,
    atkMultiplier: atkMult,
    matchupMultiplier: matchup,
    mitigation: dr,
    critMultiplier: critMult,
    blockReduction,
    final,
  };

  events.push({ t: 'attack', actor: attackerIndex, move: 'basic', roll });

  if (blocked) {
    // Сколько сняли блоком — в тех же единицах, что и урон: игрок должен
    // видеть «щит съел 14», а не «щит сработал».
    const mitigated = Math.max(0, Math.round(beforeBlock) - final);
    events.push({ t: 'block', actor: defenderIndex, mitigated });
  }

  return { kind: 'hit', damage: final, crit, roll, events };
}
