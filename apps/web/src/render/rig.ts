import { paletteColor } from '@extramundum/data';
import type { RigSlot, RigSpec } from '@extramundum/shared';
import { BoxGeometry, Group, Mesh, Object3D, PointLight } from 'three';

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
  private readonly bySize = new Map<string, BoxGeometry>();

  get size(): number {
    return this.bySize.size;
  }

  get(w: number, h: number, d: number): BoxGeometry {
    const key = `${w}:${h}:${d}`;
    const existing = this.bySize.get(key);
    if (existing !== undefined) return existing;
    const geometry = new BoxGeometry(w, h, d);
    this.bySize.set(key, geometry);
    return geometry;
  }

  dispose(): void {
    for (const geometry of this.bySize.values()) geometry.dispose();
    this.bySize.clear();
  }
}

export function buildRig(
  spec: RigSpec,
  materials: MaterialCache,
  geometries: GeometryCache,
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
    const object: Object3D = isMesh
      ? new Mesh(
          geometries.get(w, h, d),
          materials.get(paletteColor(node.color), node.origin === 'city' ? 'city' : 'world'),
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
