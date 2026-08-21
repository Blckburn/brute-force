import { RIGS } from '@extramundum/data';
import { RIG_SLOTS, rigSpecSchema, type RigSpec } from '@extramundum/shared';
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
