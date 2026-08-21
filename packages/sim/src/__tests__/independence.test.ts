import { describe, expect, it } from 'vitest';

import { resolveAttack } from '../damage.js';
import { createFighterState } from '../fighter.js';
import { rngFromSeed } from '../rng.js';
import { balance, fighter } from './helpers.js';

/**
 * Независимость бросков. GDD §4.2 и §13, пункт 5.
 *
 * В v1.0 уклонение и блок делили один `r` внутри `pickMove()`. Следствие:
 * шанс блока зависел от шанса уклонения — поднимаешь AGI, и щит начинает
 * работать иначе, хотя щит тот же. Такую поломку нельзя заметить глазами
 * и нельзя вывести из кода за разумное время, её видно только измерением.
 *
 * Поэтому здесь статистика, а не единичный вызов: каждый бросок обязан
 * иметь свой вызов генератора, и частоты обязаны сходиться с формулами.
 */

const RUNS = 20_000;

/** Прогон N ударов, считаем, чем они кончились. */
function sample(
  attackerOverrides: Parameters<typeof fighter>[0],
  defenderOverrides: Parameters<typeof fighter>[0],
  seed: string,
): { dodged: number; blocked: number; crit: number; hits: number } {
  const attacker = createFighterState(fighter(attackerOverrides), balance);
  const defender = createFighterState(fighter(defenderOverrides), balance);
  const rng = rngFromSeed(seed);

  let dodged = 0;
  let blocked = 0;
  let crit = 0;
  let hits = 0;

  for (let i = 0; i < RUNS; i++) {
    const outcome = resolveAttack(attacker, defender, balance, rng, 0, 1);
    if (outcome.kind === 'dodged') {
      dodged++;
      continue;
    }
    hits++;
    if (outcome.crit) crit++;
    if (outcome.roll.blockReduction > 0) blocked++;
  }

  return { dodged, blocked, crit, hits };
}

describe('частоты сходятся с формулами', () => {
  it('уклонение выпадает с расчётной вероятностью', () => {
    // AGI 20 против ACC 8 → 12.6% (пример из GDD §4.2).
    const { dodged } = sample({ accuracy: 8 }, { agi: 20 }, 'dodge-rate');
    expect(dodged / RUNS).toBeCloseTo(0.126, 2);
  });

  it('крит выпадает с расчётной вероятностью', () => {
    // AGI 20 → 13% (пример из GDD §4.2). Считаем от ударов, дошедших
    // до шага крита, а не от всех попыток.
    const { crit, hits } = sample({ agi: 20 }, { agi: 0 }, 'crit-rate');
    expect(crit / hits).toBeCloseTo(0.13, 2);
  });

  it('блок выпадает с вероятностью щита', () => {
    const { blocked, hits } = sample(
      { accuracy: 1000 }, // уклонений нет, все удары доходят до блока
      { shield: { blockChance: 0.25, blockReduction: 0.8 } },
      'block-rate',
    );
    expect(blocked / hits).toBeCloseTo(0.25, 2);
  });
});

describe('броски не коррелируют между собой', () => {
  it('шанс блока не зависит от ловкости защитника', () => {
    // ГЛАВНАЯ проверка файла: ровно баг v1.0 №5.
    //
    // Точность атакующего здесь НЕ задирается. Обнулить уклонение —
    // значит убрать то самое, с чем ищется корреляция: при нулевом
    // шансе уклонения общий бросок неотличим от раздельного. Первая
    // редакция этого теста именно так и промахнулась мимо диверсии.
    //
    // Поэтому уклонение оставлено живым и РАЗНЫМ: 3% против 27%.
    // При общем броске (`r < dodge` → уклон, иначе `r < dodge + block`
    // → блок) доля блоков среди дошедших ударов равна block/(1 − dodge),
    // то есть 0.309 против 0.411. При раздельных бросках — 0.3 в обоих.
    const shield = { blockChance: 0.3, blockReduction: 0.7 };

    const slow = sample({}, { agi: 0, shield }, 'corr-a'); // уклонение 3%
    const nimble = sample({}, { agi: 30, shield }, 'corr-b'); // уклонение 27%

    // Проверяем, что уклонение действительно разное: иначе тест
    // незаметно выродится в предыдущую редакцию.
    expect(slow.dodged / RUNS).toBeCloseTo(0.03, 2);
    expect(nimble.dodged / RUNS).toBeCloseTo(0.27, 2);

    const slowRate = slow.blocked / slow.hits;
    const nimbleRate = nimble.blocked / nimble.hits;

    expect(slowRate).toBeCloseTo(0.3, 2);
    expect(nimbleRate).toBeCloseTo(0.3, 2);
    expect(Math.abs(slowRate - nimbleRate)).toBeLessThan(0.02);
  });

  it('шанс крита не зависит от того, есть ли у защитника щит', () => {
    const withShield = sample(
      { agi: 20, accuracy: 1000 },
      { shield: { blockChance: 0.5, blockReduction: 0.6 } },
      'crit-shield',
    );
    const without = sample({ agi: 20, accuracy: 1000 }, { shield: null }, 'crit-no-shield');

    expect(Math.abs(withShield.crit / withShield.hits - without.crit / without.hits)).toBeLessThan(
      0.02,
    );
  });

  it('шанс уклонения не зависит от наличия щита', () => {
    const withShield = sample(
      {},
      { agi: 25, shield: { blockChance: 0.35, blockReduction: 0.9 } },
      'dodge-shield',
    );
    const without = sample({}, { agi: 25, shield: null }, 'dodge-no-shield');

    expect(Math.abs(withShield.dodged / RUNS - without.dodged / RUNS)).toBeLessThan(0.02);
  });
});

describe('сам генератор', () => {
  it('равномерен по десяти корзинам', () => {
    const rng = rngFromSeed('uniform');
    const buckets = new Array<number>(10).fill(0);

    for (let i = 0; i < 100_000; i++) {
      const idx = Math.min(9, Math.floor(rng.next() * 10));
      buckets[idx] = (buckets[idx] ?? 0) + 1;
    }

    for (const count of buckets) {
      expect(count / 100_000).toBeCloseTo(0.1, 2);
    }
  });

  it('соседние значения не коррелируют', () => {
    const rng = rngFromSeed('serial');
    const n = 50_000;
    let sumXY = 0;
    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumY2 = 0;

    let prev = rng.next();
    for (let i = 0; i < n; i++) {
      const cur = rng.next();
      sumXY += prev * cur;
      sumX += prev;
      sumY += cur;
      sumX2 += prev * prev;
      sumY2 += cur * cur;
      prev = cur;
    }

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    expect(Math.abs(numerator / denominator)).toBeLessThan(0.02);
  });

  it('int попадает в границы включительно', () => {
    const rng = rngFromSeed('bounds');
    const seen = new Set<number>();

    for (let i = 0; i < 5000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }

    expect(seen.size).toBe(5);
  });

  it('chance на границах отвечает верно и всё равно тратит бросок', () => {
    const rng = rngFromSeed('edges');
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }

    // Состояние СДВИНУЛОСЬ ровно на 200 бросков. Раньше здесь стояло
    // обратное утверждение — «вырожденные вероятности не тратят броски», —
    // и оно закрепляло поведение, из-за которого поток генератора зависел
    // от ЗНАЧЕНИЯ коэффициента: билд с нулевым шансом расходился с билдом,
    // где шанс равен полупроценту, с первого же такого броска, и матрица
    // винрейтов мерила смещение выборки вместо силы трейта.
    const reference = rngFromSeed('edges');
    for (let i = 0; i < 200; i++) reference.next();
    expect(rng.next()).toBe(reference.next());

    // И это не совпадение двух одинаково сломанных счётчиков: генератор,
    // не потративший ничего, даёт ДРУГОЕ число.
    expect(rng.state()).not.toEqual(rngFromSeed('edges').state());
  });
});
