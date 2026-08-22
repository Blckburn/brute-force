import { animations } from '@extramundum/data';
import type { AnimationSpec } from '@extramundum/shared';
import { describe, expect, it } from 'vitest';

import { schedule, shownCount, stepCursorAt, timeline, timeOfIndex } from '../schedule.ts';

import { log } from './fixture.ts';

/**
 * Раскладка лога по времени. GDD §3.2, §10.
 *
 * Расписание — чистая функция, и именно поэтому проверяемо без браузера.
 * Утверждение «один лог даёт одну последовательность на экране» здесь
 * можно уронить тестом, а не принять на веру.
 */

const plan = schedule(log, animations);
const steps = timeline(plan, animations);

describe('расписание', () => {
  it('в выборке есть все типы событий — иначе проверять нечего', () => {
    // Тесты ниже вида «ни одно событие не роняет раскладку» проходят
    // и на логе из одних ударов. Без этой проверки они не доказывают
    // ничего: тип, которого нет в выборке, никто не проверял.
    const kinds = new Set(log.events.map((event) => event.t));
    expect(kinds.size).toBe(Object.keys(animations.events).length);
    expect(log.events.length).toBeGreaterThan(100);
  });

  it('каждому событию лога соответствует ровно одна запись', () => {
    expect(plan.items).toHaveLength(log.events.length);
    for (let i = 0; i < plan.items.length; i++) {
      expect(plan.items[i]?.index).toBe(i);
      expect(plan.items[i]?.event).toBe(log.events[i]);
    }
  });

  it('записи идут подряд и без разрывов, а сумма даёт длину боя', () => {
    let cursor = 0;
    for (const item of plan.items) {
      expect(item.startMs).toBe(cursor);
      expect(item.holdMs).toBeGreaterThan(0);
      cursor += item.holdMs;
    }
    expect(plan.totalMs).toBe(cursor);
  });

  it('событие без анимации роняет раскладку, а не показывается молча', () => {
    // Диверсия: убрать удар из animations.json. Молчаливый ноль означал
    // бы, что удар есть в логе и не существует на экране.
    const crippled = {
      ...animations,
      events: Object.fromEntries(
        Object.entries(animations.events).filter(([kind]) => kind !== 'attack'),
      ),
    } as AnimationSpec;

    expect(() => schedule(log, crippled)).toThrow(/attack/);
  });
});

describe('сколько показано к моменту времени', () => {
  it('на границах события — ровно столько, сколько закончилось', () => {
    const first = plan.items[0];
    const second = plan.items[1];
    if (first === undefined || second === undefined) throw new Error('лог слишком короток');

    expect(shownCount(plan, 0)).toBe(0);
    expect(shownCount(plan, first.holdMs - 1)).toBe(0);
    expect(shownCount(plan, first.holdMs)).toBe(1);
    expect(shownCount(plan, first.holdMs + second.holdMs)).toBe(2);
    expect(shownCount(plan, plan.totalMs)).toBe(plan.items.length);
  });

  it('не зависит от того, идём мы вперёд или назад', () => {
    // Свойство, ради которого функция чистая: перемотка назад обязана
    // давать ровно то же, что перемотка вперёд. Накопительный счётчик
    // этого не даёт, и расхождение накапливалось бы до конца боя.
    const times: number[] = [];
    for (let t = 0; t <= plan.totalMs; t += 37) times.push(t);
    times.push(plan.totalMs);

    const forward = times.map((t) => shownCount(plan, t));
    const backward = [...times].reverse().map((t) => shownCount(plan, t));
    expect(backward.reverse()).toEqual(forward);

    // И оно монотонно: показанное не убывает со временем.
    for (let i = 1; i < forward.length; i++) {
      expect(forward[i]).toBeGreaterThanOrEqual(forward[i - 1] ?? 0);
    }
    // Проверка, что выборка вообще что-то поймала: иначе равенство
    // двух пустых списков прошло бы точно так же.
    expect(forward.at(-1)).toBe(plan.items.length);
    expect(new Set(forward).size).toBeGreaterThan(10);
  });

  it('перемотка по строке журнала попадает в начало события', () => {
    for (const index of [0, 5, 40, log.events.length - 1]) {
      const at = timeOfIndex(plan, index);
      expect(shownCount(plan, at)).toBe(index);
    }
  });
});

describe('плоский список примитивов', () => {
  it('содержит все шаги всех событий', () => {
    let expected = 0;
    for (const event of log.events) expected += animations.events[event.t]?.steps.length ?? 0;
    expect(steps).toHaveLength(expected);
    expect(steps.length).toBeGreaterThan(log.events.length);
  });

  it('отсортирован по времени', () => {
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]?.atMs).toBeGreaterThanOrEqual(steps[i - 1]?.atMs ?? 0);
    }
  });

  it('курсор по времени совпадает с прямым перебором', () => {
    // Двоичный поиск существует ради чистоты, а не ради скорости —
    // значит обязан совпадать с наивным перебором всюду, включая
    // границы, где события начинаются в один и тот же момент.
    for (let t = 0; t <= plan.totalMs; t += 53) {
      const naive = steps.filter((step) => step.atMs <= t).length;
      expect(stepCursorAt(steps, t)).toBe(naive);
    }
  });

  it('шаг с задержкой стоит позже начала своего события', () => {
    // Задержка — единственная причина, по которой список нужно
    // сортировать. Если её нигде нет, сортировка не проверена.
    const delayed = steps.filter((step) => step.step.delayMs > 0);
    expect(delayed.length).toBeGreaterThan(0);
    for (const step of delayed) {
      const own = plan.items[step.index];
      expect(step.atMs).toBe((own?.startMs ?? 0) + step.step.delayMs);
    }
  });
});
