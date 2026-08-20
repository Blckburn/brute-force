/**
 * Детерминированный генератор. GDD §3.1: xorshift128+, сериализуемое
 * состояние.
 *
 * Почему свой, а не встроенный: `Math.random()` невоспроизводим, и один
 * его вызов в движке превращает бой в неповторимый — а на воспроизводимости
 * держится всё остальное. Реплей по ссылке, разбор жалобы на баланс,
 * регрессионный тест «этот сид давал такой лог» — ничего из этого
 * не работает, если результат нельзя получить дважды.
 *
 * Состояние сериализуемо намеренно: бой можно остановить, сохранить
 * и продолжить, получив тот же результат.
 */

/** Состояние генератора. Два 64-битных слова, разложенные на пары по 32. */
export type RngState = {
  readonly s0hi: number;
  readonly s0lo: number;
  readonly s1hi: number;
  readonly s1lo: number;
};

export type Rng = {
  /** Равномерно в [0, 1). */
  next(): number;
  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number;
  /** Бросок с вероятностью p. p ≤ 0 — всегда false, p ≥ 1 — всегда true. */
  chance(p: number): boolean;
  /** Снимок состояния: сериализуем, восстанавливается в `rngFromState`. */
  state(): RngState;
};

/* Арифметика 64-бит на парах 32-битных чисел: BigInt здесь был бы
   в разы медленнее, а прогонов в матрице винрейтов десятки тысяч. */

function add64(ahi: number, alo: number, bhi: number, blo: number): [number, number] {
  const lo = (alo >>> 0) + (blo >>> 0);
  const carry = lo > 0xffffffff ? 1 : 0;
  return [(ahi + bhi + carry) >>> 0, lo >>> 0];
}

function xor64(ahi: number, alo: number, bhi: number, blo: number): [number, number] {
  return [(ahi ^ bhi) >>> 0, (alo ^ blo) >>> 0];
}

function shl64(hi: number, lo: number, n: number): [number, number] {
  if (n === 0) return [hi >>> 0, lo >>> 0];
  if (n >= 32) return [(lo << (n - 32)) >>> 0, 0];
  return [((hi << n) | (lo >>> (32 - n))) >>> 0, (lo << n) >>> 0];
}

function shr64(hi: number, lo: number, n: number): [number, number] {
  if (n === 0) return [hi >>> 0, lo >>> 0];
  if (n >= 32) return [0, hi >>> (n - 32)];
  return [hi >>> n, ((lo >>> n) | (hi << (32 - n))) >>> 0];
}

/**
 * Сид строкой → четыре слова состояния. Хеш FNV-1a с разными
 * начальными значениями: нужен не криптостойкий, а такой, где близкие
 * строки дают непохожие состояния.
 */
export function seedToState(seed: string): RngState {
  const words: number[] = [];

  for (let i = 0; i < 4; i++) {
    let h = (2166136261 + i * 0x9e3779b9) >>> 0;
    for (let j = 0; j < seed.length; j++) {
      h ^= seed.charCodeAt(j);
      h = Math.imul(h, 16777619) >>> 0;
    }
    // Финальное перемешивание: без него короткие сиды дают близкие слова.
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    words.push(h >>> 0);
  }

  const state: RngState = {
    s0hi: words[0] ?? 1,
    s0lo: words[1] ?? 2,
    s1hi: words[2] ?? 3,
    s1lo: words[3] ?? 4,
  };

  // Нулевое состояние — вырожденный случай xorshift: выдаёт только нули.
  if (state.s0hi === 0 && state.s0lo === 0 && state.s1hi === 0 && state.s1lo === 0) {
    return { s0hi: 0x9e3779b9, s0lo: 0x243f6a88, s1hi: 0xb7e15162, s1lo: 0x85a308d3 };
  }
  return state;
}

export function rngFromState(initial: RngState): Rng {
  let s0hi = initial.s0hi >>> 0;
  let s0lo = initial.s0lo >>> 0;
  let s1hi = initial.s1hi >>> 0;
  let s1lo = initial.s1lo >>> 0;

  /** Один шаг xorshift128+. Возвращает 53 значащих бита как [0, 1). */
  function next(): number {
    let xhi = s0hi;
    let xlo = s0lo;
    const yhi = s1hi;
    const ylo = s1lo;

    s0hi = yhi;
    s0lo = ylo;

    let [thi, tlo] = shl64(xhi, xlo, 23);
    [xhi, xlo] = xor64(xhi, xlo, thi, tlo);

    [thi, tlo] = shr64(xhi, xlo, 17);
    [xhi, xlo] = xor64(xhi, xlo, thi, tlo);

    [thi, tlo] = shr64(yhi, ylo, 26);
    [xhi, xlo] = xor64(xhi, xlo, thi, tlo);
    [xhi, xlo] = xor64(xhi, xlo, yhi, ylo);

    s1hi = xhi;
    s1lo = xlo;

    const [rhi, rlo] = add64(s0hi, s0lo, s1hi, s1lo);

    // 53 бита: старшие 21 из hi и все 32 из lo. Ровно столько несёт double.
    return ((rhi >>> 11) * 0x100000000 + (rlo >>> 0)) / 0x20000000000000;
  }

  return {
    next,
    int(min: number, max: number): number {
      if (max <= min) return min;
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p: number): boolean {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return next() < p;
    },
    state(): RngState {
      return { s0hi, s0lo, s1hi, s1lo };
    },
  };
}

/** Генератор из сида-строки. Единственный вход случайности в движок. */
export function rngFromSeed(seed: string): Rng {
  const rng = rngFromState(seedToState(seed));
  // Прогрев: первые значения xorshift слабо перемешаны, и близкие сиды
  // давали бы похожие первые броски — то есть похожее начало боя.
  for (let i = 0; i < 16; i++) rng.next();
  return rng;
}
