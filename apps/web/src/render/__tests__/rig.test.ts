import { RIGS } from '@extramundum/data';
import { RIG_SHAPES, RIG_SLOTS, rigSpecSchema, type RigSpec } from '@extramundum/shared';
import { describe, expect, it } from 'vitest';
import { Mesh, PointLight } from 'three';

import { MaterialCache } from '../materials.js';
import { buildRig, GeometryCache } from '../rig.js';

/**
 * Риг из декларативной спецификации. GDD §3.4.
 *
 * «Новый монстр или шлем = запись в данных, не правка кода.» Утверждение
 * проверяемое: меняем ЧИСЛО в спецификации и смотрим, изменилась ли
 * геометрия. Без такой проверки «данные, а не код» — это намерение,
 * а не свойство.
 */

const build = (spec: RigSpec) => {
  const materials = new MaterialCache();
  const geometries = new GeometryCache();
  return { rig: buildRig(spec, materials, geometries), materials, geometries };
};

/** Минимальная спецификация: корень, тело, надетый шлем. */
const testSpec = (bodyHeight: number): RigSpec =>
  rigSpecSchema.parse({
    id: 'test',
    nodes: [
      { name: 'root', parent: null, offset: [0, 0, 0], size: [0, 0, 0], color: 'ink' },
      { name: 'body', parent: 'root', offset: [0, 1, 0], size: [1, bodyHeight, 1], color: 'bone' },
      {
        name: 'hat',
        parent: 'body',
        offset: [0, 0.6, 0],
        size: [0.5, 0.2, 0.5],
        color: 'ash',
        slot: 'helmet',
      },
    ],
  });

describe('сборка рига из данных', () => {
  it('правка ЧИСЛА в спецификации меняет геометрию, кода никто не трогал', () => {
    const short = build(testSpec(1)).rig.nodes.get('body');
    const tall = build(testSpec(3)).rig.nodes.get('body');

    expect(short).toBeInstanceOf(Mesh);
    expect(tall).toBeInstanceOf(Mesh);

    const height = (node: unknown) =>
      ((node as Mesh).geometry as unknown as { parameters: { height: number } }).parameters.height;

    expect(height(short)).toBe(1);
    expect(height(tall)).toBe(3);
    // И это РАЗНЫЕ числа — иначе проверка выше прошла бы и при
    // захардкоженной геометрии, игнорирующей спецификацию.
    expect(height(tall)).not.toBe(height(short));
  });

  it('иерархия строится по полю parent, а не по порядку в файле', () => {
    const { rig } = build(testSpec(1));
    const body = rig.nodes.get('body');
    const hat = rig.nodes.get('hat');

    // Узел с parent: null подвешивается к группе рига, остальные —
    // к узлу, названному в данных. Группа и корневой узел спецификации —
    // разные объекты: группу двигает сцена, узел принадлежит данным.
    expect(hat?.parent).toBe(body);
    expect(body?.parent).toBe(rig.nodes.get('root'));
    expect(rig.nodes.get('root')?.parent).toBe(rig.root);
  });

  it('узел нулевого размера — точка привязки, а не невидимый меш', () => {
    const { rig } = build(testSpec(1));
    expect(rig.nodes.get('root')).not.toBeInstanceOf(Mesh);
    expect(rig.nodes.get('body')).toBeInstanceOf(Mesh);
  });

  it('неизвестный родитель — ошибка данных, а не рука из земли', () => {
    const broken = rigSpecSchema.parse({
      id: 'broken',
      nodes: [
        { name: 'root', parent: null, offset: [0, 0, 0], size: [0, 0, 0], color: 'ink' },
        { name: 'arm', parent: 'nope', offset: [0, 0, 0], size: [1, 1, 1], color: 'bone' },
      ],
    });
    expect(() => build(broken)).toThrow(/неизвестного родителя/);
  });

  it('неизвестный цвет — ошибка данных, а не тихий фиолетовый', () => {
    const broken = rigSpecSchema.parse({
      id: 'broken',
      nodes: [
        { name: 'root', parent: null, offset: [0, 0, 0], size: [1, 1, 1], color: 'нетТакогоЦвета' },
      ],
    });
    expect(() => build(broken)).toThrow(/нет цвета/);
  });
});

describe('восемь слотов экипировки', () => {
  it('все восемь из GDD §5.3 присутствуют на риге бойца', () => {
    const { rig } = build(RIGS.humanoid);
    const missing = RIG_SLOTS.filter((slot) => !rig.slots.has(slot));
    expect(missing, 'слот из контракта не виден на риге').toEqual([]);
  });

  it('каждый слот даёт настоящий меш, а не пустой узел', () => {
    const { rig } = build(RIGS.humanoid);
    for (const slot of RIG_SLOTS) {
      const meshes = rig.slots.get(slot) ?? [];
      expect(meshes.length, `слот ${slot} пуст`).toBeGreaterThan(0);
      for (const mesh of meshes) expect(mesh).toBeInstanceOf(Mesh);
    }
  });

  it('парные слоты дают два меша: наручи и сапоги надеваются на обе стороны', () => {
    const { rig } = build(RIGS.humanoid);
    expect(rig.slots.get('bracers')).toHaveLength(2);
    expect(rig.slots.get('boots')).toHaveLength(2);
    expect(rig.slots.get('helmet')).toHaveLength(1);
  });
});

describe('формы из спецификации', () => {
  /** Коробка, пирамида и двускатная крыша при одинаковом габарите. */
  const shaped = (shape: (typeof RIG_SHAPES)[number]) =>
    build(
      rigSpecSchema.parse({
        id: `shape-${shape}`,
        nodes: [
          { name: 'n', parent: null, offset: [0, 0, 0], size: [2, 3, 4], color: 'bone', shape },
        ],
      }),
    ).rig.nodes.get('n') as Mesh;

  const vertexCount = (mesh: Mesh) =>
    (mesh.geometry.getAttribute('position') as { count: number }).count;

  const bounds = (mesh: Mesh) => {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  };

  it('форма берётся из данных: три формы дают три разные геометрии', () => {
    // Сравниваются САМИ ВЕРШИНЫ, а не их число: у коробки и двускатной
    // крыши вершин поровну (по 24), и счётчик объявил бы их одинаковыми.
    const shapeOf = (shape: (typeof RIG_SHAPES)[number]) => {
      const attribute = shaped(shape).geometry.getAttribute('position') as {
        array: ArrayLike<number>;
      };
      return Array.from(attribute.array)
        .map((v) => v.toFixed(3))
        .join(',');
    };

    const distinct = new Set(RIG_SHAPES.map(shapeOf));
    expect(distinct.size, 'поле shape читается, но ни на что не влияет').toBe(RIG_SHAPES.length);
  });

  it('каждая форма укладывается в заявленный габарит', () => {
    // Пирамида и крыша заданы вручную, а не примитивом three: у конуса
    // основание — вписанный многоугольник, и прямоугольное основание им
    // не задать. Значит габарит надо проверять, а не предполагать.
    for (const shape of RIG_SHAPES) {
      const [w, h, d] = bounds(shaped(shape));
      expect(w, `${shape}: ширина`).toBeCloseTo(2, 5);
      expect(h, `${shape}: высота`).toBeCloseTo(3, 5);
      expect(d, `${shape}: глубина`).toBeCloseTo(4, 5);
    }
  });

  it('умолчание — коробка: стиль проекта не требует записи в данных', () => {
    const withoutShape = build(
      rigSpecSchema.parse({
        id: 'default',
        nodes: [{ name: 'n', parent: null, offset: [0, 0, 0], size: [2, 3, 4], color: 'bone' }],
      }),
    ).rig.nodes.get('n') as Mesh;

    expect(vertexCount(withoutShape)).toBe(vertexCount(shaped('box')));
  });

  it('кэш геометрий различает формы одного габарита', () => {
    const geometries = new GeometryCache();
    const box = geometries.get(1, 1, 1, 'box');
    const pyramid = geometries.get(1, 1, 1, 'pyramid');

    expect(pyramid).not.toBe(box);
    expect(geometries.get(1, 1, 1, 'pyramid')).toBe(pyramid);
    expect(geometries.size).toBe(2);
  });

  it('город построен формами, а не одними коробками', () => {
    // Прямоугольные башни одинаковой ширины с плоскими верхушками
    // читаются современным мегаполисом — так и вышло на первом
    // скриншоте M2a. Раннесредневековый город держится на силуэте.
    const shapes = new Set(RIGS.munda.nodes.flatMap((node) => (node.shape ? [node.shape] : [])));
    expect(shapes.has('pyramid'), 'нет островерхих башен').toBe(true);
    expect(shapes.has('gable'), 'нет скатных крыш').toBe(true);

    // И высоты разные: ряд одинаковых башен — тот же мегаполис.
    const heights = RIGS.munda.nodes
      .filter((n) => n.name.startsWith('tower'))
      .map((n) => n.size[1]);
    expect(heights.length).toBeGreaterThan(2);
    expect(new Set(heights).size, 'все башни одной высоты').toBeGreaterThan(2);
  });
});

describe('подмена цветов при сборке', () => {
  it('два бойца из одной спецификации отличаются цветом', () => {
    const materials = new MaterialCache();
    const geometries = new GeometryCache();

    const plain = buildRig(RIGS.humanoid, materials, geometries);
    const swapped = buildRig(
      RIGS.humanoid,
      materials,
      geometries,
      new Map([['parchment', 'ochre']]),
    );

    const hex = (rig: typeof plain, node: string) =>
      (
        (rig.nodes.get(node) as Mesh).material as { color: { getHexString(): string } }
      ).color.getHexString();

    expect(hex(swapped, 'torso')).not.toBe(hex(plain, 'torso'));
    // Не задетые подменой узлы остались прежними — иначе это не подмена,
    // а перекраска всего рига.
    expect(hex(swapped, 'head')).toBe(hex(plain, 'head'));
  });

  it('подменяется КЛЮЧ палитры, а не произвольный цвет', () => {
    const materials = new MaterialCache();
    const geometries = new GeometryCache();
    expect(() =>
      buildRig(RIGS.humanoid, materials, geometries, new Map([['parchment', '#ff00ff']])),
    ).toThrow(/нет цвета/);
  });
});

describe('свет из спецификации', () => {
  it('узел со светом даёт PointLight и попадает в реестр мерцающих', () => {
    const { rig } = build(RIGS.arena);
    expect(rig.flickerables.length).toBeGreaterThan(0);
    for (const source of rig.flickerables) {
      expect(source.light).toBeInstanceOf(PointLight);
      expect(source.base).toBeGreaterThan(0);
    }
  });

  it('фазы мерцания различны и детерминированы', () => {
    const first = build(RIGS.arena).rig.flickerables.map((f) => f.phase);
    const second = build(RIGS.arena).rig.flickerables.map((f) => f.phase);

    // Детерминированы: сцена обязана выглядеть одинаково при каждом
    // запуске, как и бой при том же сиде. Ноль обращений к random().
    expect(second).toEqual(first);
    // И различны: одинаковые фазы дали бы два факела, мигающих в такт,
    // то есть пульсирующую лампу вместо огня.
    expect(new Set(first).size).toBe(first.length);
  });
});
