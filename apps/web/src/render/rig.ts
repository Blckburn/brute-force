import { paletteColor } from '@extramundum/data';
import type { RigShape, RigSlot, RigSpec } from '@extramundum/shared';
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Object3D,
  PointLight,
} from 'three';

import type { MaterialCache } from './materials.js';

/**
 * Сборка тела из декларативной спецификации. GDD §3.4.
 *
 * «Тело собирается по JSON-описанию, а не хардкодом в `buildRig`. Новый
 * монстр или шлем = запись в данных, не правка кода.» Здесь нет ни одного
 * имени узла, ни одного размера и ни одного цвета: всё приходит из
 * `packages/data/rigs/*.json`.
 *
 * Проверяется это тестом, который меняет ЧИСЛО в тестовой спецификации
 * и убеждается, что геометрия изменилась. Утверждение «код не содержит
 * констант» иначе пришлось бы принимать на веру.
 */

export type FlickerSource = {
  readonly light: PointLight;
  /** Базовая интенсивность, от которой считается мерцание. */
  readonly base: number;
  /** Амплитуда, доля базовой интенсивности. */
  readonly amount: number;
  /** Сдвиг фазы, чтобы два факела не мерцали в такт. */
  readonly phase: number;
};

export type BuiltRig = {
  readonly root: Group;
  /** Узлы по имени — для адресного обращения без обхода сцены. */
  readonly nodes: ReadonlyMap<string, Object3D>;
  /** Меши экипировки по слоту. Слот может дать несколько мешей: наручи парные. */
  readonly slots: ReadonlyMap<RigSlot, readonly Mesh[]>;
  /** Источники света, которым нужно мерцание. Явный список вместо обхода. */
  readonly flickerables: readonly FlickerSource[];
  /** Узлы городского происхождения — им разрешены зарезервированные цвета. */
  readonly cityNodes: ReadonlySet<Object3D>;
};

/**
 * Кэш геометрий по размеру коробки.
 *
 * Та же мысль, что у материалов: две коробки одного размера — одна
 * геометрия. Без кэша сборка двух бойцов давала бы полсотни одинаковых
 * буферов, и каждый занимал бы свою память на GPU.
 */
export class GeometryCache {
  /** Ключ — «форма:ширина:высота:глубина». Одна геометрия на габарит. */
  private readonly bySize = new Map<string, BufferGeometry>();

  get size(): number {
    return this.bySize.size;
  }

  get(w: number, h: number, d: number, shape: RigShape = 'box'): BufferGeometry {
    const key = `${shape}:${w}:${h}:${d}`;
    const existing = this.bySize.get(key);
    if (existing !== undefined) return existing;

    const geometry =
      shape === 'box'
        ? new BoxGeometry(w, h, d)
        : shape === 'pyramid'
          ? pyramid(w, h, d)
          : gable(w, h, d);
    this.bySize.set(key, geometry);
    return geometry;
  }

  dispose(): void {
    for (const geometry of this.bySize.values()) geometry.dispose();
    this.bySize.clear();
  }
}

/**
 * Четырёхскатная пирамида с прямоугольным основанием.
 *
 * Собирается вручную, а не из `ConeGeometry`: у конуса основание —
 * вписанный многоугольник, то есть при четырёх сегментах квадрат,
 * повёрнутый на 45°, и задать разные ширину и глубину нечем. Башне
 * города нужен ровно прямоугольник основания.
 */
function pyramid(w: number, h: number, d: number): BufferGeometry {
  const [x, y, z] = [w / 2, h / 2, d / 2];
  const apex = [0, y, 0];
  const base = [
    [-x, -y, z],
    [x, -y, z],
    [x, -y, -z],
    [-x, -y, -z],
  ];
  const tris: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = base[i] as number[];
    const b = base[(i + 1) % 4] as number[];
    tris.push(...a, ...b, ...apex);
  }
  // Дно: две треугольные грани. Снизу его не видно, но без них
  // силуэт сбоку проваливается.
  tris.push(...(base[0] as number[]), ...(base[2] as number[]), ...(base[1] as number[]));
  tris.push(...(base[0] as number[]), ...(base[3] as number[]), ...(base[2] as number[]));
  return fromTriangles(tris);
}

/** Двускатная крыша: треугольная призма, конёк вдоль оси Z. */
function gable(w: number, h: number, d: number): BufferGeometry {
  const [x, y, z] = [w / 2, h / 2, d / 2];
  const tris: number[] = [];
  const push = (...points: number[][]) => {
    for (const p of points) tris.push(...p);
  };
  // Два ската.
  push([-x, -y, z], [0, y, z], [0, y, -z]);
  push([-x, -y, z], [0, y, -z], [-x, -y, -z]);
  push([x, -y, -z], [0, y, -z], [0, y, z]);
  push([x, -y, -z], [0, y, z], [x, -y, z]);
  // Два фронтона.
  push([-x, -y, z], [x, -y, z], [0, y, z]);
  push([x, -y, -z], [-x, -y, -z], [0, y, -z]);
  // Дно.
  push([-x, -y, -z], [x, -y, -z], [x, -y, z]);
  push([-x, -y, -z], [x, -y, z], [-x, -y, z]);
  return fromTriangles(tris);
}

function fromTriangles(positions: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  // Нормали нужны Lambert; у городских материалов света нет, но одна
  // и та же геометрия может достаться и обычному узлу.
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Подмена цветов при сборке: ключ палитры -> ключ палитры.
 *
 * Нужна затем, чтобы два бойца из ОДНОЙ спецификации отличались друг
 * от друга. Заводить вторую спецификацию ради другого цвета плаща
 * значило бы копировать двадцать пять узлов ради двух строк, а копия
 * через месяц расходится с оригиналом.
 *
 * Подменяется только КЛЮЧ, а не цвет: подставить сюда произвольный hex
 * нельзя, и палитра остаётся единственным источником цвета.
 */
export type ColorOverrides = ReadonlyMap<string, string>;

export function buildRig(
  spec: RigSpec,
  materials: MaterialCache,
  geometries: GeometryCache,
  overrides?: ColorOverrides,
): BuiltRig {
  const nodes = new Map<string, Object3D>();
  const slots = new Map<RigSlot, Mesh[]>();
  const flickerables: FlickerSource[] = [];
  const cityNodes = new Set<Object3D>();
  const root = new Group();
  root.name = spec.id;

  for (const node of spec.nodes) {
    const [w, h, d] = node.size;
    const isMesh = w > 0 && h > 0 && d > 0;

    // Узел нулевого размера — точка привязки, а не невидимая коробка.
    // Невидимый меш всё равно стоил бы обхода и места в сцене.
    // Вид материала — из данных: узел городского происхождения получает
    // чистую заливку без света и тумана (ART-BIBLE §3 и §5).
    const colorKey = overrides?.get(node.color) ?? node.color;
    const object: Object3D = isMesh
      ? new Mesh(
          geometries.get(w, h, d, node.shape),
          materials.get(paletteColor(colorKey), node.origin === 'city' ? 'city' : 'world'),
        )
      : new Object3D();

    object.name = node.name;
    object.position.set(...node.offset);

    const parent = node.parent === null ? root : nodes.get(node.parent);
    if (parent === undefined) {
      // Порядок узлов в файле — часть контракта: родитель обязан быть
      // объявлен раньше ребёнка. Ошибка данных, а не повод молча
      // подвесить узел к корню и получить руку, растущую из земли.
      throw new Error(
        `риг «${spec.id}»: узел «${node.name}» ссылается на неизвестного родителя «${node.parent}»`,
      );
    }
    parent.add(object);
    nodes.set(node.name, object);

    if (node.origin === 'city') cityNodes.add(object);

    if (node.slot !== undefined && object instanceof Mesh) {
      const list = slots.get(node.slot) ?? [];
      list.push(object);
      slots.set(node.slot, list);
    }

    if (node.light !== undefined) {
      const light = new PointLight(
        paletteColor(node.light.color),
        node.light.intensity,
        node.light.distance,
      );
      object.add(light);
      flickerables.push({
        light,
        base: node.light.intensity,
        amount: node.light.flicker,
        // Фаза выводится из имени узла, а не из random(): сцена обязана
        // выглядеть одинаково при каждом запуске, как и бой при том же сиде.
        phase: hashPhase(node.name),
      });
    }
  }

  return { root, nodes, slots, flickerables, cityNodes };
}

/** Детерминированная фаза из имени: ноль обращений к random(). */
function hashPhase(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ((hash % 1000) / 1000) * Math.PI * 2;
}
