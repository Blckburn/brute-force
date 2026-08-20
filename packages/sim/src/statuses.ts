import type {
  BattleEvent,
  CombatBalance,
  StatusId,
  StatusInstanceId,
  ActorIndex,
} from '@extramundum/shared';

import type { FighterState } from './fighter.js';

/**
 * Статусы как система. GDD §4.4.
 *
 * Один интерфейс вместо россыпи полей `_bleed`, `_stunned`, `_cursedHits`,
 * `_furyStacks` из v1.0. Ни один из десяти эффектов не имеет собственной
 * ветки в цикле боя: если эффекту понадобился частный случай в
 * `resolve.ts`, интерфейс спроектирован неверно.
 *
 * Два свойства держат корректность и стоят отдельного внимания.
 *
 * **Модификаторы не мутируют базу.** `modify` — чистая функция,
 * возвращающая прибавки; эффективное значение считается из базы плюс
 * сумма активных модификаторов при каждом обращении. Мутация означала бы,
 * что после истечения статуса величина не вернётся к исходной, и ошибка
 * копилась бы весь бой. Это ровно тот класс поломки, из-за которого
 * в v1.0 обнулялись HP от путей (GDD §13, пункт 2).
 *
 * **Порядок разрешения задан явно.** Он не зависит от порядка вставки
 * в массив — см. `compareInstances`.
 */

/* ────────────────────────── состояние экземпляра ─────────────────────── */

/**
 * Экземпляр статуса на бойце.
 *
 * Кровотечение и яд стакаются НЕЗАВИСИМЫМИ экземплярами (GDD §4.4):
 * два наложения — две записи, каждая со своим таймером. Не «обновить
 * длительность»: обновление стирало бы историю и делало второй удар
 * бесполезным, если первый ещё висит.
 */
export type StatusInstance = {
  readonly instance: StatusInstanceId;
  readonly id: StatusId;
  stacks: number;
  /** В тиках. -1 — до конца боя, вниз не тикает. */
  duration: number;
  /** Порядок наложения. Разрешает ничью при сортировке. */
  readonly seq: number;
};

/** Прибавки к статам от одного статуса. Складываются, множители перемножаются. */
export type StatModifiers = {
  readonly atk?: number;
  readonly agi?: number;
  readonly spd?: number;
  readonly armor?: number;
  readonly accuracy?: number;
  /** Прибавка к множителю атаки: 0.5 значит ×1.5 итогового урона. */
  readonly attackMultiplierBonus?: number;
  /** Множитель брони: 0.8 значит −20%. */
  readonly armorMultiplier?: number;
};

export type TickResult = {
  readonly kind: 'damage' | 'heal';
  readonly amount: number;
};

/* ─────────────────────────────── интерфейс ───────────────────────────── */

/**
 * Категория определяет, КОГДА статус разрешается. Внутри категории
 * порядок задаётся `STATUS_IDS`.
 */
export type StatusCategory = 'control' | 'modifier' | 'absorb' | 'damage' | 'heal';

export type StatusDefinition = {
  readonly id: StatusId;
  readonly category: StatusCategory;
  /**
   * `instances` — каждое наложение создаёт свой экземпляр со своим
   * таймером (GDD §4.4 про кровотечение и яд).
   * `refresh` — повторное наложение обновляет существующий экземпляр.
   */
  readonly stacking: 'instances' | 'refresh';

  /** Длительность по умолчанию при наложении, из данных. */
  defaultDuration(balance: CombatBalance): number;

  /** Прибавки к статам, пока активен. Чистая функция. */
  modify?(instance: StatusInstance, balance: CombatBalance): StatModifiers;

  /** Урон или лечение за тик. `null` — в этот тик ничего не даёт. */
  tick?(instance: StatusInstance, balance: CombatBalance): TickResult | null;

  /** Запрещает бойцу действовать в этот ход. */
  preventsAction?(instance: StatusInstance): boolean;

  /**
   * Поглощает часть входящего урона и РАСХОДУЕТСЯ.
   * Возвращает поглощённое количество, мутируя собственные стеки.
   * Собственное состояние статуса — единственное, что ему позволено менять.
   */
  absorb?(instance: StatusInstance, incoming: number, balance: CombatBalance): number;
};

/* ──────────────────────────── реестр эффектов ────────────────────────── */

/** Урон за тик, пропорциональный стекам. Общая форма для bleed/poison/burn. */
function damageOverTime(
  id: StatusId,
  stacking: 'instances' | 'refresh',
  read: (b: CombatBalance) => { damagePerStack: number; duration: number },
): StatusDefinition {
  return {
    id,
    category: 'damage',
    stacking,
    defaultDuration: (b) => read(b).duration,
    tick: (inst, b) => ({ kind: 'damage', amount: read(b).damagePerStack * inst.stacks }),
  };
}

const DEFINITIONS: readonly StatusDefinition[] = [
  // Кровотечение и яд — независимые экземпляры, прямо по GDD §4.4.
  damageOverTime('bleed', 'instances', (b) => b.statuses.bleed),
  damageOverTime('poison', 'instances', (b) => b.statuses.poison),
  // Горение обновляется: это одна горящая цель, а не несколько очагов.
  damageOverTime('burn', 'refresh', (b) => b.statuses.burn),

  {
    id: 'stun',
    category: 'control',
    stacking: 'refresh',
    defaultDuration: (b) => b.statuses.stun.duration,
    preventsAction: () => true,
  },

  {
    id: 'hex',
    category: 'modifier',
    stacking: 'refresh',
    defaultDuration: (b) => b.statuses.hex.duration,
    modify: (inst, b) => ({ atk: b.statuses.hex.atkPerStack * inst.stacks }),
  },

  {
    id: 'fury',
    category: 'modifier',
    stacking: 'refresh',
    defaultDuration: (b) => b.statuses.fury.duration,
    modify: (inst, b) => ({ atk: b.statuses.fury.atkPerStack * inst.stacks }),
  },

  {
    id: 'regen',
    category: 'heal',
    stacking: 'refresh',
    defaultDuration: (b) => b.statuses.regen.duration,
    tick: (inst, b) => ({ kind: 'heal', amount: b.statuses.regen.healPerStack * inst.stacks }),
  },

  {
    id: 'shield',
    category: 'absorb',
    stacking: 'refresh',
    defaultDuration: (b) => b.statuses.shield.duration,
    absorb: (inst, incoming, b) => {
      const perStack = b.statuses.shield.absorbPerStack;
      const capacity = perStack * inst.stacks;
      const absorbed = Math.min(incoming, capacity);
      // Щит расходуется: постоянное снижение урона — это броня,
      // а не щит. Списываем целые стеки, остаток стека сгорает.
      const spent = perStack > 0 ? Math.ceil(absorbed / perStack) : inst.stacks;
      inst.stacks = Math.max(0, inst.stacks - spent);
      return absorbed;
    },
  },

  {
    id: 'enrage',
    category: 'modifier',
    stacking: 'refresh',
    defaultDuration: (b) => b.statuses.enrage.duration,
    modify: (_inst, b) => ({
      attackMultiplierBonus: b.statuses.enrage.attackMultiplierBonus,
      armorMultiplier: b.statuses.enrage.armorMultiplier,
    }),
  },

  {
    id: 'chill',
    category: 'modifier',
    stacking: 'refresh',
    defaultDuration: (b) => b.statuses.chill.duration,
    modify: (inst, b) => ({ spd: b.statuses.chill.spdPerStack * inst.stacks }),
  },
];

export const STATUS_REGISTRY: ReadonlyMap<StatusId, StatusDefinition> = new Map(
  DEFINITIONS.map((d) => [d.id, d]),
);

/**
 * Канонический порядок эффектов внутри одной категории.
 *
 * Выводится из порядка объявления в реестре, а НЕ импортируется из
 * `@extramundum/shared`: движок не берёт оттуда ничего, кроме типов
 * (инвариант 2, ADR 0003). Совпадение с `STATUS_IDS` из контракта —
 * требование рендера, который раскладывает иконки в том же порядке,
 * и оно проверяется тестом, а не соблюдается на честном слове.
 */
export const STATUS_ORDER: readonly StatusId[] = DEFINITIONS.map((d) => d.id);

export function statusDefinition(id: StatusId): StatusDefinition {
  const def = STATUS_REGISTRY.get(id);
  // Пропущенный в реестре статус — ошибка сборки набора, а не повод
  // молча ничего не делать: эффект существовал бы в описании и не
  // существовал в бою. Это пункт 3 аудита v1.0.
  if (def === undefined) throw new Error(`статус «${id}» объявлен, но не реализован`);
  return def;
}

/* ─────────────────────────── порядок разрешения ──────────────────────── */

/**
 * Категории в порядке разрешения внутри тика.
 *
 * Урон РАНЬШЕ лечения — это решение, а не мелочь. Боец на 3 HP
 * с кровотечением на 5 и регенерацией на 5 при таком порядке умирает,
 * при обратном выживает. Причина выбора: иначе DoT перестаёт быть
 * угрозой и превращается в арифметику, которую регенерация молча гасит.
 * Плюс «умер от кровотечения» читается в логе как событие, а «регенерация
 * успела» — нет, и игрок не поймёт, что его спасло. В автобаттлере игрок
 * видит только лог, и того, чего в логе нет, для него не произошло.
 *
 * `absorb` стоит между ними, потому что поглощение относится к входящему
 * удару, а не к тику.
 */
const CATEGORY_ORDER: readonly StatusCategory[] = [
  'control',
  'modifier',
  'absorb',
  'damage',
  'heal',
];

/**
 * Сравнение экземпляров для детерминированного порядка.
 *
 * Три ключа, и все три нужны:
 *  1. категория — задаёт смысл (см. CATEGORY_ORDER);
 *  2. позиция идентификатора в STATUS_IDS — канонический порядок эффектов
 *     одной категории, тот же, в котором рендер раскладывает иконки;
 *  3. порядковый номер наложения — разрешает ничью между двумя
 *     экземплярами одного статуса.
 *
 * Порядок в массиве бойца НЕ участвует. Если бы участвовал, добавление
 * статуса в другой момент боя меняло бы исход при том же сиде.
 */
export function compareInstances(
  a: StatusInstance,
  b: StatusInstance,
  order: readonly StatusId[],
): number {
  const ca = CATEGORY_ORDER.indexOf(statusDefinition(a.id).category);
  const cb = CATEGORY_ORDER.indexOf(statusDefinition(b.id).category);
  if (ca !== cb) return ca - cb;

  const ia = order.indexOf(a.id);
  const ib = order.indexOf(b.id);
  if (ia !== ib) return ia - ib;

  return a.seq - b.seq;
}

/* ──────────────────────────── работа с бойцом ────────────────────────── */

/** Активные экземпляры бойца в каноническом порядке. */
export function orderedStatuses(
  fighter: FighterState,
  order: readonly StatusId[],
): readonly StatusInstance[] {
  return [...fighter.statuses].sort((a, b) => compareInstances(a, b, order));
}

/** Сумма модификаторов всех активных статусов. */
export function activeModifiers(fighter: FighterState, balance: CombatBalance): StatModifiers {
  let atk = 0;
  let agi = 0;
  let spd = 0;
  let armor = 0;
  let accuracy = 0;
  let attackMultiplierBonus = 0;
  let armorMultiplier = 1;

  for (const inst of fighter.statuses) {
    const def = statusDefinition(inst.id);
    if (def.modify === undefined) continue;
    const m = def.modify(inst, balance);
    atk += m.atk ?? 0;
    agi += m.agi ?? 0;
    spd += m.spd ?? 0;
    armor += m.armor ?? 0;
    accuracy += m.accuracy ?? 0;
    attackMultiplierBonus += m.attackMultiplierBonus ?? 0;
    armorMultiplier *= m.armorMultiplier ?? 1;
  }

  // Сложение и умножение коммутативны, поэтому здесь порядок не важен.
  // Если однажды появится некоммутативный модификатор, эту сумму
  // придётся считать по compareInstances — и это будет видно отсюда.
  return { atk, agi, spd, armor, accuracy, attackMultiplierBonus, armorMultiplier };
}

/* ─────────────────────────── наложение и тик ─────────────────────────── */

/** Счётчик экземпляров, общий на бой: номера уникальны для обоих бойцов. */
export type StatusClock = { nextInstance: StatusInstanceId; nextSeq: number };

export function createStatusClock(): StatusClock {
  return { nextInstance: 1, nextSeq: 1 };
}

/**
 * Наложить статус. Возвращает события для лога.
 *
 * Единая точка входа: и стартовые статусы из конфигурации, и всё, что
 * будут накладывать трейты в M1c, проходят здесь. Второго способа
 * завести статус на бойце нет и не должно быть.
 */
export function applyStatus(
  fighter: FighterState,
  target: ActorIndex,
  id: StatusId,
  stacks: number,
  duration: number,
  balance: CombatBalance,
  clock: StatusClock,
): readonly BattleEvent[] {
  const def = statusDefinition(id);
  const finalDuration = duration === 0 ? def.defaultDuration(balance) : duration;

  if (def.stacking === 'refresh') {
    const existing = fighter.statuses.find((i) => i.id === id);
    if (existing !== undefined) {
      existing.stacks += stacks;
      existing.duration = finalDuration;
      return [
        {
          t: 'status_apply',
          target,
          instance: existing.instance,
          status: id,
          stacks: existing.stacks,
          duration: existing.duration,
        },
      ];
    }
  }

  // Кап на число экземпляров: без него достаточно долгий бой копит
  // кровотечения без предела, и урон от статусов перестаёт быть
  // ограниченным чем-либо.
  const sameId = fighter.statuses.filter((i) => i.id === id);
  if (sameId.length >= balance.statuses.maxInstances) {
    // Вытесняется САМЫЙ КОРОТКИЙ по остатку: так наложение всегда
    // что-то даёт, а не пропадает молча. Ничья — по номеру экземпляра.
    let weakest = sameId[0] as StatusInstance;
    for (const inst of sameId) {
      const a = inst.duration === -1 ? Number.POSITIVE_INFINITY : inst.duration;
      const b = weakest.duration === -1 ? Number.POSITIVE_INFINITY : weakest.duration;
      if (a < b || (a === b && inst.seq < weakest.seq)) weakest = inst;
    }
    const events = removeInstance(fighter, target, weakest);
    return [...events, ...applyStatus(fighter, target, id, stacks, duration, balance, clock)];
  }

  const instance: StatusInstance = {
    instance: clock.nextInstance++,
    id,
    stacks,
    duration: finalDuration,
    seq: clock.nextSeq++,
  };
  fighter.statuses.push(instance);

  return [
    {
      t: 'status_apply',
      target,
      instance: instance.instance,
      status: id,
      stacks: instance.stacks,
      duration: instance.duration,
    },
  ];
}

function removeInstance(
  fighter: FighterState,
  target: ActorIndex,
  instance: StatusInstance,
): readonly BattleEvent[] {
  const at = fighter.statuses.indexOf(instance);
  if (at >= 0) fighter.statuses.splice(at, 1);
  return [
    {
      t: 'status_expire',
      target,
      instance: instance.instance,
      status: instance.id,
      stacks: instance.stacks,
    },
  ];
}

/** Может ли боец действовать. Учитывает все статусы, а не только stun. */
export function actionPrevented(fighter: FighterState, order: readonly StatusId[]): boolean {
  for (const inst of orderedStatuses(fighter, order)) {
    const def = statusDefinition(inst.id);
    if (def.preventsAction?.(inst) === true) return true;
  }
  return false;
}

/**
 * Прогнать входящий урон через поглощающие статусы.
 * Возвращает остаток и события истечения израсходованных.
 */
export function absorbDamage(
  fighter: FighterState,
  target: ActorIndex,
  incoming: number,
  balance: CombatBalance,
  order: readonly StatusId[],
): { remaining: number; absorbed: number; events: readonly BattleEvent[] } {
  let remaining = incoming;
  let absorbed = 0;
  const events: BattleEvent[] = [];

  for (const inst of orderedStatuses(fighter, order)) {
    if (remaining <= 0) break;
    const def = statusDefinition(inst.id);
    if (def.absorb === undefined) continue;

    const took = def.absorb(inst, remaining, balance);
    if (took <= 0) continue;

    remaining -= took;
    absorbed += took;
    events.push({
      t: 'status_tick',
      target,
      instance: inst.instance,
      status: inst.id,
      stacks: inst.stacks,
      amount: took,
    });

    if (inst.stacks <= 0) events.push(...removeInstance(fighter, target, inst));
  }

  return { remaining: Math.max(0, remaining), absorbed, events };
}

export type StatusTickResult = {
  readonly events: readonly BattleEvent[];
  /** Урон, нанесённый статусами. Резолверу нужен, чтобы проверить смерть. */
  readonly damage: number;
};

/**
 * Тик статусов одного бойца: эффекты, затем убывание длительности.
 *
 * Порядок внутри тика — `compareInstances`, то есть урон раньше лечения
 * и оба независимо от порядка вставки.
 */
export function tickFighterStatuses(
  fighter: FighterState,
  target: ActorIndex,
  balance: CombatBalance,
  order: readonly StatusId[],
): StatusTickResult {
  const events: BattleEvent[] = [];
  let damage = 0;

  for (const inst of orderedStatuses(fighter, order)) {
    const def = statusDefinition(inst.id);
    const result = def.tick?.(inst, balance);
    if (result === null || result === undefined) continue;

    const amount = Math.max(0, Math.round(result.amount));
    if (amount === 0) continue;

    if (result.kind === 'damage') {
      const applied = Math.min(amount, fighter.hp);
      fighter.hp -= applied;
      damage += applied;
    } else {
      fighter.hp = Math.min(fighter.maxHp, fighter.hp + amount);
    }

    events.push({
      t: 'status_tick',
      target,
      instance: inst.instance,
      status: inst.id,
      stacks: inst.stacks,
      amount,
    });

    // Смерть от эффекта прекращает разрешение остальных: лечить труп
    // и показывать это в логе — хуже, чем ничего.
    if (fighter.hp <= 0) break;
  }

  // Длительность убывает ПОСЛЕ действия: статус, наложенный на 1 тик,
  // обязан сработать один раз, а не ноль.
  for (const inst of [...fighter.statuses]) {
    if (inst.duration === -1) continue;
    inst.duration -= 1;
    if (inst.duration <= 0) events.push(...removeInstance(fighter, target, inst));
  }

  return { events, damage };
}
