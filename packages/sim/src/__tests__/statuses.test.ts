import { STATUS_IDS, type BattleEvent, type BattleSetup, type StatusId } from '@extramundum/shared';
import { describe, expect, it } from 'vitest';

import { createFighterState, effectiveStats, maxHp } from '../fighter.js';
import { resolveBattle } from '../resolve.js';
import {
  applyStatus,
  createStatusClock,
  orderedStatuses,
  statusDefinition,
  tickFighterStatuses,
  STATUS_ORDER,
  STATUS_REGISTRY,
  type StatusInstance,
} from '../statuses.js';
import { balance, fighter } from './helpers.js';

/**
 * Статусы. GDD §4.4.
 *
 * Правило прежнее: механики нет, пока нет теста, доказывающего, что она
 * делает то, что написано в описании. В v1.0 шесть трейтов из семнадцати
 * описывали одно, а делали другое (GDD §13, пункт 3) — здесь каждый
 * из десяти эффектов наблюдается в логе с числом.
 */

type Starting = { id: StatusId; stacks: number; duration: number };

/** Боец со статусом против безобидного мешка: наблюдаем чистый эффект. */
function withStatus(statuses: Starting[], overrides: Parameters<typeof fighter>[0] = {}) {
  const harmless = {
    atk: 0,
    spd: 1,
    weapon: { dmgMin: 0, dmgMax: 0, ilvl: 1, class: 'balanced' as const },
  };
  const setup: BattleSetup = [fighter({ ...harmless, statuses, ...overrides }), fighter(harmless)];
  return resolveBattle(setup, balance, 'status-probe');
}

/** Противник для расчёта эффективных статов: часть пассивов смотрит на цель. */
const dummy = () => createFighterState(fighter(), balance);

const ticksOf = (events: readonly BattleEvent[], status: StatusId, target = 0) =>
  events.filter((e) => e.t === 'status_tick' && e.status === status && e.target === target);

/* ─────────────────────────────── десять ──────────────────────────────── */

describe('каждый эффект наблюдаем в логе с числом', () => {
  /**
   * Сколько раз периодический эффект сработает за `duration` тиков.
   * Первое срабатывание — на нулевом возрасте, поэтому это потолок.
   */
  const expectedTicks = (duration: number, period: number) => Math.ceil(duration / period);

  it('bleed снимает урон раз в период, пропорционально стекам', () => {
    const { tickEvery, damagePerStack } = balance.statuses.bleed;
    const duration = tickEvery * 5;
    const { log } = withStatus([{ id: 'bleed', stacks: 3, duration }]);
    const ticks = ticksOf(log.events, 'bleed');

    expect(ticks).toHaveLength(expectedTicks(duration, tickEvery));
    for (const e of ticks) {
      expect(e.t === 'status_tick' && e.amount).toBe(damagePerStack * 3);
    }
  });

  it('период настоящий: за те же тики срабатываний строго меньше', () => {
    // Проверка ПРОТИВ вырождения. «Раз в десять тиков» и «каждый тик»
    // различаются только числом срабатываний на одном отрезке; без этой
    // пары тест выше был бы зелёным и при периоде, равном единице.
    const { tickEvery } = balance.statuses.bleed;
    expect(tickEvery, 'период равен единице — сравнивать не с чем').toBeGreaterThan(1);

    const duration = tickEvery * 4;
    const ticks = ticksOf(withStatus([{ id: 'bleed', stacks: 1, duration }]).log.events, 'bleed');

    expect(ticks.length).toBe(4);
    expect(ticks.length).toBeLessThan(duration);
  });

  it('poison снимает урон раз в период', () => {
    const { tickEvery, damagePerStack } = balance.statuses.poison;
    const duration = tickEvery * 4;
    const { log } = withStatus([{ id: 'poison', stacks: 2, duration }]);
    const ticks = ticksOf(log.events, 'poison');

    expect(ticks).toHaveLength(expectedTicks(duration, tickEvery));
    expect(ticks[0]?.t === 'status_tick' && ticks[0].amount).toBe(damagePerStack * 2);
  });

  it('burn снимает урон раз в период и сильнее яда на стек', () => {
    const { tickEvery, damagePerStack } = balance.statuses.burn;
    const duration = tickEvery * 3;
    const { log } = withStatus([{ id: 'burn', stacks: 1, duration }]);
    const ticks = ticksOf(log.events, 'burn');

    expect(ticks).toHaveLength(expectedTicks(duration, tickEvery));
    expect(ticks[0]?.t === 'status_tick' && ticks[0].amount).toBe(damagePerStack);
    expect(damagePerStack).toBeGreaterThan(balance.statuses.poison.damagePerStack);
  });

  it('regen лечит раз в период и не поднимает выше максимума', () => {
    const { tickEvery, healPerStack } = balance.statuses.regen;
    const state = createFighterState(fighter({ atk: 0, spd: 1 }), balance);
    const clock = createStatusClock();
    applyStatus(state, 0, 'regen', 2, tickEvery * 6, balance, clock);

    const perTick = healPerStack * 2;
    state.hp = state.maxHp - perTick - 5;

    const first = tickFighterStatuses(state, 0, balance, STATUS_ORDER);
    expect(state.hp).toBe(state.maxHp - 5);
    const healed = first.events.find((e) => e.t === 'status_tick' && e.status === 'regen');
    expect(healed?.t === 'status_tick' && healed.amount).toBe(perTick);

    // Внутри периода лечения нет — и HP это подтверждает, а не догадка.
    for (let i = 1; i < tickEvery; i++) tickFighterStatuses(state, 0, balance, STATUS_ORDER);
    expect(state.hp).toBe(state.maxHp - 5);

    // Следующий период снова лечит и упирается в максимум.
    tickFighterStatuses(state, 0, balance, STATUS_ORDER);
    expect(state.hp).toBe(state.maxHp);
  });

  it('stun пропускает ход: у застаненного бойца ходов меньше', () => {
    const stunned = withStatus([{ id: 'stun', stacks: 1, duration: 400 }], { spd: 20 });
    const free = withStatus([], { spd: 20, atk: 0 });

    const turns = (r: typeof stunned, actor: 0 | 1) =>
      r.log.events.filter((e) => e.t === 'turn_start' && e.actor === actor).length;

    expect(turns(stunned, 0)).toBeLessThan(turns(free, 0));
    // И при этом ходы всё-таки есть: защита от лока не даёт пропустить всё.
    expect(turns(stunned, 0)).toBeGreaterThan(0);
  });

  it('shield поглощает урон, расходуется и это видно числом', () => {
    const setup: BattleSetup = [
      fighter({ atk: 0, spd: 1, weapon: { dmgMin: 0, dmgMax: 0, ilvl: 1, class: 'balanced' } }),
      fighter({ atk: 30, spd: 20, statuses: [] }),
    ];
    setup[0].statuses.push({ id: 'shield', stacks: 3, duration: 400 });

    const { log } = resolveBattle(setup, balance, 'shield-probe');
    const absorbs = log.events.filter((e) => e.t === 'status_tick' && e.status === 'shield');

    expect(absorbs.length).toBeGreaterThan(0);
    for (const e of absorbs) {
      expect(e.t === 'status_tick' && (e.amount ?? 0)).toBeGreaterThan(0);
    }

    // Расходуется: щит не может гасить удары бесконечно.
    const expired = log.events.filter((e) => e.t === 'status_expire' && e.status === 'shield');
    expect(expired).toHaveLength(1);
  });

  it('hex снижает ATK, пока висит', () => {
    const base = createFighterState(fighter({ atk: 40 }), balance);
    const hexed = createFighterState(
      fighter({ atk: 40, statuses: [{ id: 'hex', stacks: 2, duration: 10 }] }),
      balance,
    );
    hexed.statuses.push({ instance: 1, id: 'hex', stacks: 2, duration: 10, seq: 1 });

    expect(effectiveStats(hexed, dummy(), balance).atk).toBe(
      base.config.atk + balance.statuses.hex.atkPerStack * 2,
    );
    expect(effectiveStats(hexed, dummy(), balance).atk).toBeLessThan(
      effectiveStats(base, dummy(), balance).atk,
    );
  });

  it('fury повышает ATK за стек', () => {
    const state = createFighterState(fighter({ atk: 10 }), balance);
    state.statuses.push({ instance: 1, id: 'fury', stacks: 3, duration: -1, seq: 1 });

    expect(effectiveStats(state, dummy(), balance).atk).toBe(
      10 + balance.statuses.fury.atkPerStack * 3,
    );
  });

  it('chill снижает SPD и боец действует реже', () => {
    const chilled = withStatus([{ id: 'chill', stacks: 2, duration: 400 }], { spd: 20 });
    const free = withStatus([], { spd: 20, atk: 0 });

    const turns = (r: typeof chilled) =>
      r.log.events.filter((e) => e.t === 'turn_start' && e.actor === 0).length;

    expect(turns(chilled)).toBeLessThan(turns(free));
  });

  it('enrage даёт +50% урона и −20% брони по GDD §7.5', () => {
    const state = createFighterState(fighter({ atk: 60, armor: 100 }), balance);
    const plain = effectiveStats(state, dummy(), balance);
    state.statuses.push({ instance: 1, id: 'enrage', stacks: 1, duration: -1, seq: 1 });
    const raging = effectiveStats(state, dummy(), balance);

    expect(raging.attackMultiplierBonus).toBe(balance.statuses.enrage.attackMultiplierBonus);
    expect(raging.armor).toBeCloseTo(plain.armor * balance.statuses.enrage.armorMultiplier, 10);
  });

  it('все десять объявленных статусов реализованы', () => {
    for (const id of STATUS_IDS) {
      expect(() => statusDefinition(id), id).not.toThrow();
    }
    expect(STATUS_REGISTRY.size).toBe(STATUS_IDS.length);
  });

  it('порядок в движке совпадает с порядком в контракте', () => {
    // Рендер раскладывает иконки по STATUS_IDS. Разойдись эти списки —
    // и одинаковый бой выглядел бы по-разному.
    expect([...STATUS_ORDER]).toEqual([...STATUS_IDS]);
  });
});

/* ──────────────────────────── правила GDD §4.4 ───────────────────────── */

describe('стан не может сработать два хода подряд', () => {
  it('пропущенных ходов не больше половины, и стан ДЕЙСТВИТЕЛЬНО срабатывал', () => {
    // Стан висит весь бой: без защиты от лока боец не сходил бы ни разу.
    const { log } = withStatus([{ id: 'stun', stacks: 1, duration: -1 }], { spd: 25 });

    const turns = log.events.filter((e) => e.t === 'turn_start' && e.actor === 0).length;
    const opponentTurns = log.events.filter((e) => e.t === 'turn_start' && e.actor === 1).length;

    // ПРОВЕРКА, ЧТО ИСКОМОЕ ВООБЩЕ ПРОИСХОДИТ.
    // В M1a тест на корреляцию прошёл мимо диверсии ровно потому, что
    // убирал то, что искал. Здесь так же легко: если стан не выпадет
    // ни разу, «пропущено не больше половины» пройдёт само собой.
    // Боец 0 быстрее в 25 раз — без стана его ходов было бы кратно
    // больше; равенство означает, что каждый второй ход съеден.
    expect(turns).toBeGreaterThan(0);
    expect(turns).toBeLessThan(opponentTurns * 25);

    // Жёсткое правило: ход через ход, то есть не меньше трети от того,
    // что боец сделал бы без стана вовсе.
    const free = withStatus([], { spd: 25, atk: 0 });
    const freeTurns = free.log.events.filter((e) => e.t === 'turn_start' && e.actor === 0).length;

    expect(turns).toBeGreaterThan(freeTurns / 3);
    expect(turns).toBeLessThan(freeTurns);
  });

  it('ходы идут через один: пропуск, ход, пропуск, ход', () => {
    const harmless = {
      atk: 0,
      spd: 50,
      weapon: { dmgMin: 0, dmgMax: 0, ilvl: 1, class: 'balanced' as const },
    };
    const dummy = fighter({ ...harmless, spd: 1 });

    const free = resolveBattle([fighter(harmless), dummy], balance, 'stun-free');
    const stunned = resolveBattle(
      [fighter({ ...harmless, statuses: [{ id: 'stun', stacks: 1, duration: -1 }] }), dummy],
      balance,
      'stun-locked',
    );

    const ticksOfTurns = (r: typeof free) =>
      r.log.events.filter((e) => e.t === 'turn_start' && e.actor === 0).map((e) => e.tick);

    const freeTicks = ticksOfTurns(free);
    const stunnedTicks = ticksOfTurns(stunned);

    // Стан ДЕЙСТВИТЕЛЬНО срабатывал: иначе всё ниже пройдёт само собой.
    expect(freeTicks.length).toBeGreaterThan(10);
    expect(stunnedTicks.length).toBeLessThan(freeTicks.length);

    // При SPD 50 боец получает право хода каждые 2 тика. Со станом
    // через раз — каждые 4. Больше 4 означало бы два пропуска подряд.
    const step = (freeTicks[1] ?? 0) - (freeTicks[0] ?? 0);
    for (let i = 1; i < stunnedTicks.length; i++) {
      expect((stunnedTicks[i] ?? 0) - (stunnedTicks[i - 1] ?? 0)).toBeLessThanOrEqual(step * 2);
    }

    // И ровно половина: ход через ход, а не «иногда пропускает».
    expect(stunnedTicks.length).toBeGreaterThan(freeTicks.length / 2 - 2);
    expect(stunnedTicks.length).toBeLessThan(freeTicks.length / 2 + 2);
  });
});

describe('кровотечение и яд: независимые экземпляры', () => {
  it('два наложения дают два экземпляра, а не одно обновление', () => {
    const state = createFighterState(fighter(), balance);
    const clock = createStatusClock();

    applyStatus(state, 0, 'bleed', 1, 10, balance, clock);
    applyStatus(state, 0, 'bleed', 1, 30, balance, clock);

    expect(state.statuses.filter((i) => i.id === 'bleed')).toHaveLength(2);
  });

  it('таймеры независимы: истекают в разные тики', () => {
    const state = createFighterState(fighter({ def: 100 }), balance);
    const clock = createStatusClock();

    applyStatus(state, 0, 'bleed', 1, 2, balance, clock);
    applyStatus(state, 0, 'bleed', 1, 5, balance, clock);

    const expiredAt: number[] = [];
    for (let tick = 1; tick <= 6; tick++) {
      const { events } = tickFighterStatuses(state, 0, balance, STATUS_ORDER);
      for (const e of events) if (e.t === 'status_expire') expiredAt.push(tick);
    }

    expect(expiredAt).toEqual([2, 5]);
  });

  it('у каждого экземпляра свой номер, и он связывает наложение с истечением', () => {
    const state = createFighterState(fighter(), balance);
    const clock = createStatusClock();

    const first = applyStatus(state, 0, 'poison', 1, 2, balance, clock);
    const second = applyStatus(state, 0, 'poison', 1, 4, balance, clock);

    const idOf = (events: readonly BattleEvent[]) =>
      events.find((e) => e.t === 'status_apply')?.t === 'status_apply'
        ? (events.find((e) => e.t === 'status_apply') as { instance: number }).instance
        : -1;

    const a = idOf(first);
    const b = idOf(second);
    expect(a).not.toBe(b);

    const expired: number[] = [];
    for (let tick = 0; tick < 5; tick++) {
      const { events } = tickFighterStatuses(state, 0, balance, STATUS_ORDER);
      for (const e of events) if (e.t === 'status_expire') expired.push(e.instance);
    }

    expect(expired).toEqual([a, b]);
  });

  it('burn обновляется, а не плодит экземпляры', () => {
    const state = createFighterState(fighter(), balance);
    const clock = createStatusClock();

    applyStatus(state, 0, 'burn', 1, 10, balance, clock);
    applyStatus(state, 0, 'burn', 1, 10, balance, clock);

    expect(state.statuses.filter((i) => i.id === 'burn')).toHaveLength(1);
    expect(state.statuses[0]?.stacks).toBe(2);
  });

  it('число экземпляров ограничено капом из данных', () => {
    const state = createFighterState(fighter(), balance);
    const clock = createStatusClock();

    for (let i = 0; i < balance.statuses.maxInstances + 4; i++) {
      applyStatus(state, 0, 'bleed', 1, 20 + i, balance, clock);
    }

    expect(state.statuses.filter((i) => i.id === 'bleed')).toHaveLength(
      balance.statuses.maxInstances,
    );
  });
});

describe('стеки ограничены сверху', () => {
  it('обновляемый эффект не копит стеки без предела', () => {
    const { maxStacks } = balance.statuses.chill;
    const victim = createFighterState(fighter({ spd: 30 }), balance);
    const clock = createStatusClock();

    // По одному стеку, много раз: так их накладывает трейт на каждом ударе.
    const seen: number[] = [];
    for (let i = 0; i < maxStacks + 8; i++) {
      applyStatus(victim, 0, 'chill', 1, 0, balance, clock);
      seen.push(victim.statuses[0]?.stacks ?? 0);
    }

    // Стеки РОСЛИ, а потом упёрлись. Без первой половины проверка
    // «не больше капа» проходила бы и при неработающем наложении.
    expect(seen[0]).toBe(1);
    expect(Math.max(...seen)).toBe(maxStacks);
    expect(maxStacks, 'кап равен единице — рост наблюдать не на чем').toBeGreaterThan(1);
    expect(seen[maxStacks - 1]).toBe(maxStacks);
    expect(seen.at(-1)).toBe(maxStacks);
  });

  it('без капа замедление обнулило бы SPD — а с ним боец продолжает ходить', () => {
    const { minSpd } = balance.tick;
    const { maxStacks, spdPerStack } = balance.statuses.chill;
    const base = 12;

    const victim = createFighterState(fighter({ spd: base }), balance);
    const clock = createStatusClock();
    for (let i = 0; i < maxStacks + 5; i++) applyStatus(victim, 0, 'chill', 1, 0, balance, clock);

    const spd = effectiveStats(victim, dummy(), balance).spd;
    expect(spd).toBe(base + spdPerStack * maxStacks);
    expect(spd, 'замедленный боец обязан продолжать ходить').toBeGreaterThanOrEqual(minSpd);
    expect(spd, 'замедление ничего не сняло — проверять нечего').toBeLessThan(base);
  });

  it('пол по SPD держит бойца в бою при любом замедлении', () => {
    const { minSpd } = balance.tick;
    const { spdPerStack, maxStacks } = balance.statuses.chill;

    // База подобрана так, чтобы СЫРАЯ величина ушла НИЖЕ пола. Иначе
    // проверка проходит и без пола: `max(0, x)` и `max(minSpd, x)`
    // дают одно и то же, пока x выше обоих, и тест ничего не доказывает.
    const base = 1;
    const raw = base + spdPerStack * maxStacks;
    expect(raw, 'замедление не уводит ниже пола — пол проверять нечем').toBeLessThan(minSpd);

    const frozen = createFighterState(fighter({ spd: base }), balance);
    const clock = createStatusClock();
    for (let i = 0; i < maxStacks + 20; i++) applyStatus(frozen, 0, 'chill', 1, 0, balance, clock);

    expect(effectiveStats(frozen, dummy(), balance).spd).toBe(minSpd);

    // И это не арифметика на стенде: в настоящем бою ходы есть.
    const chilled = withStatus([{ id: 'chill', stacks: maxStacks + 20, duration: -1 }], {
      spd: base,
    });
    const turns = chilled.log.events.filter((e) => e.t === 'turn_start' && e.actor === 0).length;
    expect(turns, 'замедленный до предела боец не сделал ни одного хода').toBeGreaterThan(0);
  });
});

describe('модификаторы не мутируют базу', () => {
  it('после истечения статуса стат возвращается к исходному', () => {
    const config = fighter({ atk: 40, spd: 18 });
    const state = createFighterState(config, balance);
    const before = effectiveStats(state, dummy(), balance);

    const clock = createStatusClock();
    applyStatus(state, 0, 'hex', 2, 3, balance, clock);
    applyStatus(state, 0, 'chill', 2, 3, balance, clock);

    const during = effectiveStats(state, dummy(), balance);
    expect(during.atk).toBeLessThan(before.atk);
    expect(during.spd).toBeLessThan(before.spd);

    for (let i = 0; i < 3; i++) tickFighterStatuses(state, 0, balance, STATUS_ORDER);

    const after = effectiveStats(state, dummy(), balance);
    expect(after.atk).toBe(before.atk);
    expect(after.spd).toBe(before.spd);
    // База не тронута — это и есть главное свойство.
    expect(state.config.atk).toBe(40);
    expect(state.config.spd).toBe(18);
  });

  it('наложение и истечение десять раз подряд не накапливают ошибку', () => {
    const state = createFighterState(fighter({ atk: 30 }), balance);
    const clock = createStatusClock();

    for (let round = 0; round < 10; round++) {
      applyStatus(state, 0, 'fury', 1, 2, balance, clock);
      tickFighterStatuses(state, 0, balance, STATUS_ORDER);
      tickFighterStatuses(state, 0, balance, STATUS_ORDER);
      expect(state.statuses).toHaveLength(0);
      expect(effectiveStats(state, dummy(), balance).atk).toBe(30);
    }
  });
});

describe('порядок разрешения не зависит от порядка вставки', () => {
  it('перемешанный массив даёт тот же порядок', () => {
    const state = createFighterState(fighter(), balance);
    const make = (id: StatusId, seq: number): StatusInstance => ({
      instance: seq,
      id,
      stacks: 1,
      duration: 10,
      seq,
    });

    const forward = [make('regen', 1), make('bleed', 2), make('hex', 3), make('poison', 4)];
    const backward = [...forward].reverse();

    state.statuses = [...forward];
    const a = orderedStatuses(state, STATUS_ORDER).map((i) => i.id);

    state.statuses = [...backward];
    const b = orderedStatuses(state, STATUS_ORDER).map((i) => i.id);

    expect(b).toEqual(a);
    // Модификаторы, потом урон, потом лечение.
    expect(a).toEqual(['hex', 'bleed', 'poison', 'regen']);
  });

  it('урон разрешается раньше лечения: боец на грани умирает', () => {
    const state = createFighterState(fighter({ def: 0, level: 1 }), balance);
    const clock = createStatusClock();

    applyStatus(state, 0, 'regen', 3, 10, balance, clock);
    applyStatus(state, 0, 'bleed', 3, 10, balance, clock);
    state.hp = 2;

    tickFighterStatuses(state, 0, balance, STATUS_ORDER);

    // При обратном порядке регенерация подняла бы HP и кровотечение
    // не добило бы. Решение записано в CATEGORY_ORDER.
    expect(state.hp).toBe(0);
  });
});

describe('детерминизм со статусами', () => {
  it('один сид даёт побитово идентичный лог — 50 сидов', () => {
    for (let i = 0; i < 50; i++) {
      const setup: BattleSetup = [
        fighter({
          atk: 14,
          spd: 12,
          statuses: [
            { id: 'bleed', stacks: 2, duration: 20 },
            { id: 'fury', stacks: 1, duration: -1 },
          ],
        }),
        fighter({
          atk: 11,
          spd: 10,
          armor: 25,
          statuses: [
            { id: 'shield', stacks: 2, duration: 30 },
            { id: 'chill', stacks: 1, duration: 40 },
          ],
        }),
      ];

      const first = resolveBattle(setup, balance, `st-${i}`);
      const second = resolveBattle(setup, balance, `st-${i}`);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it('в логе есть события статусов, иначе предыдущий тест ничего не значит', () => {
    const setup: BattleSetup = [
      fighter({ atk: 14, spd: 12, statuses: [{ id: 'bleed', stacks: 2, duration: 20 }] }),
      fighter({ atk: 11, spd: 10, statuses: [{ id: 'shield', stacks: 2, duration: 30 }] }),
    ];
    const { log } = resolveBattle(setup, balance, 'st-0');

    expect(log.events.some((e) => e.t === 'status_apply')).toBe(true);
    expect(log.events.some((e) => e.t === 'status_tick')).toBe(true);
    expect(log.events.some((e) => e.t === 'status_expire')).toBe(true);
  });

  it('статус может убить, и смерть попадает в лог', () => {
    const setup: BattleSetup = [
      fighter({
        atk: 0,
        spd: 1,
        weapon: { dmgMin: 0, dmgMax: 0, ilvl: 1, class: 'balanced' },
        statuses: [{ id: 'burn', stacks: 9, duration: -1 }],
      }),
      fighter({ atk: 0, spd: 1, weapon: { dmgMin: 0, dmgMax: 0, ilvl: 1, class: 'balanced' } }),
    ];
    const { log, outcome } = resolveBattle(setup, balance, 'burn-kill');

    expect(outcome.winner).toBe(1);
    expect(log.events.filter((e) => e.t === 'death')).toHaveLength(1);
    expect(log.events[log.events.length - 1]?.t).toBe('death');
  });
});

describe('длительность −1', () => {
  it('не тикает вниз и живёт до конца боя', () => {
    const state = createFighterState(fighter(), balance);
    const clock = createStatusClock();

    applyStatus(state, 0, 'fury', 1, -1, balance, clock);
    for (let i = 0; i < 50; i++) tickFighterStatuses(state, 0, balance, STATUS_ORDER);

    expect(state.statuses).toHaveLength(1);
    expect(state.statuses[0]?.duration).toBe(-1);
  });

  it('событие наложения несёт длительность', () => {
    const state = createFighterState(fighter(), balance);
    const clock = createStatusClock();
    const events = applyStatus(state, 0, 'bleed', 1, 7, balance, clock);
    const apply = events[0];

    expect(apply?.t).toBe('status_apply');
    expect(apply?.t === 'status_apply' && apply.duration).toBe(7);
  });

  it('нулевая длительность означает «взять из данных»', () => {
    const state = createFighterState(fighter(), balance);
    const clock = createStatusClock();
    const events = applyStatus(state, 0, 'poison', 1, 0, balance, clock);
    const apply = events[0];

    expect(apply?.t === 'status_apply' && apply.duration).toBe(balance.statuses.poison.duration);
  });
});

describe('HP от статусов не выходит за границы', () => {
  it('урон не уводит ниже нуля, лечение не поднимает выше максимума', () => {
    const config = fighter({ def: 5 });
    const state = createFighterState(config, balance);
    const clock = createStatusClock();

    applyStatus(state, 0, 'burn', 9, -1, balance, clock);
    for (let i = 0; i < 60; i++) {
      tickFighterStatuses(state, 0, balance, STATUS_ORDER);
      expect(state.hp).toBeGreaterThanOrEqual(0);
      expect(state.hp).toBeLessThanOrEqual(maxHp(config, balance));
    }
  });
});
