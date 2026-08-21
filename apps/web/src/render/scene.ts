import { paletteColor, RIGS } from '@extramundum/data';
import {
  AmbientLight,
  DirectionalLight,
  Fog,
  PerspectiveCamera,
  Scene,
  type Object3D,
} from 'three';

import { FrameLoop } from './frame.js';
import { MaterialCache } from './materials.js';
import { buildRig, GeometryCache, type BuiltRig, type ColorOverrides } from './rig.js';

/**
 * Сцена боя. ART-BIBLE §2–3, GDD §3.4.
 *
 * Приглушённые тона, много чёрного, ни одного насыщенного цвета —
 * яркая палитра v1.0 отменена вместе с прежним направлением.
 * Единственное светлое пятно в кадре — силуэт Мунды на горизонте:
 * по ART-BIBLE §5 это единственное место в игре, нарисованное чисто.
 *
 * Сцена собирается ОДИН раз. Всё, что должно меняться дальше, попадает
 * в явные списки `FrameLoop`, а не ищется обходом (§13, пункт 20).
 */

/** Где стоят бойцы. Метры, ось X — вдоль арены. */
const FIGHTER_X = 1.75;

/**
 * Сдвиг бойцов к зрителю от центра площадки.
 *
 * Стоять ровно посередине правильно геометрически и плохо в кадре:
 * между нижним краем экрана и бойцами остаётся половина пола, пустая
 * и ничем не занятая. Особенно заметно в портрете, где вертикали много.
 */
const FIGHTER_Z = 1.15;

/**
 * Чем второй боец отличается от первого.
 *
 * Подмена ключей палитры, а не вторая спецификация. Оба должны хорошо
 * читаться на тёмном фоне, поэтому различаются не «светлый и тёмный»,
 * а тоном: у первого выбеленная ткань и оловянная броня, у второго
 * охра и пепел.
 */
const SECOND_FIGHTER: ColorOverrides = new Map([
  ['parchment', 'ochre'],
  ['tin', 'ash'],
]);

export type BattleScene = {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly loop: FrameLoop;
  readonly materials: MaterialCache;
  readonly geometries: GeometryCache;
  readonly fighters: readonly [BuiltRig, BuiltRig];
  readonly arena: BuiltRig;
  readonly munda: BuiltRig;
  /** Узлы, которым разрешены зарезервированные цвета (ART-BIBLE §3). */
  readonly cityNodes: ReadonlySet<Object3D>;
  dispose(): void;
};

export function createBattleScene(aspect = 16 / 9): BattleScene {
  const materials = new MaterialCache();
  const geometries = new GeometryCache();
  const loop = new FrameLoop();

  const scene = new Scene();

  // Туман съедает дальний план и оставляет читаемым силуэт. Цвет тот же,
  // что у фона: иначе на горизонте появляется полоса.
  const horizon = paletteColor('ink');
  // Дальняя граница уведена за арену: при близкой границе земля обрывается
  // резкой полосой, за которой чернота, и между этой полосой и городом
  // остаётся провал. С дальней границей земля уходит в горизонт плавно.
  scene.fog = new Fog(horizon, 24, 130);

  // ── свет. Три источника на всю сцену, а не по одному на объект.
  //    Lambert дорожает с каждым источником, а бюджет мобильный.
  // Слабый общий свет: мир снаружи стены не освещён по-доброму, и почти
  // всё, что видно, видно от жаровен. ART-BIBLE §2: много чёрного, тень —
  // не серый градиент, а чёрное пятно.
  const ambient = new AmbientLight(paletteColor('parchment'), 0.36);
  scene.add(ambient);

  // Низкое холодное солнце: мир снаружи стены не освещён по-доброму.
  const sun = new DirectionalLight(paletteColor('bone'), 0.62);
  sun.position.set(-6, 9, 4);
  scene.add(sun);

  // Подсветка со стороны камеры. Без неё передние грани бойцов уходят
  // в тень целиком, и боец читается чёрным пятном на чёрном фоне —
  // а это единственный объект, на который игрок смотрит весь бой.
  // Направленный источник дешевле точечного и не зависит от расстояния.
  const fill = new DirectionalLight(paletteColor('parchment'), 0.68);
  fill.position.set(2, 4, 12);
  scene.add(fill);

  // ── арена и бойцы
  const arena = buildRig(RIGS.arena, materials, geometries);
  scene.add(arena.root);
  loop.registerFlicker(arena.flickerables);

  const left = buildRig(RIGS.humanoid, materials, geometries);
  left.root.position.set(-FIGHTER_X, 0, FIGHTER_Z);
  left.root.rotation.y = Math.PI / 2;
  scene.add(left.root);

  const right = buildRig(RIGS.humanoid, materials, geometries, SECOND_FIGHTER);
  right.root.position.set(FIGHTER_X, 0, FIGHTER_Z);
  right.root.rotation.y = -Math.PI / 2;
  scene.add(right.root);

  // ── Мунда. Далеко, выше линии взгляда, недосягаемая.
  //
  //    Дальше и мельче, чем хочется: Мунда обязана быть светлее всего
  //    в кадре, но смотреть игрок должен на бойцов. Расстояние —
  //    единственный честный способ уменьшить её, не трогая палитру:
  //    приглушать сам цвет значило бы спорить с ART-BIBLE §5.
  const munda = buildRig(RIGS.munda, materials, geometries);
  munda.root.position.set(0, 0.9, -96);
  scene.add(munda.root);

  const camera = new PerspectiveCamera(42, aspect, 0.1, 200);
  frameCamera(camera, aspect);

  const cityNodes = new Set<Object3D>([...munda.cityNodes]);

  return {
    scene,
    camera,
    loop,
    materials,
    geometries,
    fighters: [left, right],
    arena,
    munda,
    cityNodes,
    dispose() {
      materials.dispose();
      geometries.dispose();
    },
  };
}

/**
 * Положение камеры под соотношение сторон.
 *
 * Мобильный экран узкий и высокий: та же камера, что на десктопе,
 * обрезала бы бойцов по краям. Поэтому на узком экране камера отходит
 * дальше — лейаут проектируется от 380 px вверх (GDD §10), и кадр тоже.
 */
export function frameCamera(camera: PerspectiveCamera, aspect: number): void {
  const narrow = aspect < 1;
  camera.aspect = aspect;

  // Портрет — не «тот же кадр, только выше». Горизонтальный габарит
  // здесь вынуждает камеру отойти: чтобы оба бойца влезли по ширине,
  // нужно расстояние, а на этом расстоянии по вертикали видно втрое
  // больше, чем нужно. Поэтому в портрете шире угол, ниже камера
  // и СИЛЬНЕЕ наклон вниз: горизонт уходит вверх, и освободившуюся
  // вертикаль занимает пол арены, а не пустое небо и пустая земля.
  camera.fov = narrow ? 54 : 42;
  camera.position.set(0, narrow ? 2.9 : 2.9, narrow ? 9.4 : 8.4);
  camera.lookAt(0, narrow ? 0.55 : 1.2, narrow ? -2.8 : 0);
  camera.updateProjectionMatrix();
}
