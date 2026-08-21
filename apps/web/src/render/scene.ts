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
import { buildRig, GeometryCache, type BuiltRig } from './rig.js';

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
const FIGHTER_X = 1.9;

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
  scene.fog = new Fog(horizon, 26, 78);

  // ── свет. Три источника на всю сцену, а не по одному на объект.
  //    Lambert дорожает с каждым источником, а бюджет мобильный.
  // Слабый общий свет: мир снаружи стены не освещён по-доброму, и почти
  // всё, что видно, видно от жаровен. ART-BIBLE §2: много чёрного, тень —
  // не серый градиент, а чёрное пятно.
  const ambient = new AmbientLight(paletteColor('parchment'), 0.3);
  scene.add(ambient);

  // Низкое холодное солнце: мир снаружи стены не освещён по-доброму.
  const sun = new DirectionalLight(paletteColor('bone'), 0.62);
  sun.position.set(-6, 9, 4);
  scene.add(sun);

  // ── арена и бойцы
  const arena = buildRig(RIGS.arena, materials, geometries);
  scene.add(arena.root);
  loop.registerFlicker(arena.flickerables);

  const left = buildRig(RIGS.humanoid, materials, geometries);
  left.root.position.set(-FIGHTER_X, 0, 0);
  left.root.rotation.y = Math.PI / 2;
  scene.add(left.root);

  const right = buildRig(RIGS.humanoid, materials, geometries);
  right.root.position.set(FIGHTER_X, 0, 0);
  right.root.rotation.y = -Math.PI / 2;
  scene.add(right.root);

  // ── Мунда. Далеко, выше линии взгляда, недосягаемая.
  //
  //    Посадка подобрана так, чтобы тёмный холм ушёл под линию горизонта,
  //    а над ней осталась только чистая часть. Иначе холм, доведённый
  //    туманом до чернильного, читается плитой, а не землёй, и спорит
  //    с силуэтом за внимание.
  const munda = buildRig(RIGS.munda, materials, geometries);
  munda.root.position.set(0, 1.1, -54);
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

  // На узком экране горизонтальный угол обзора сужается вместе
  // с соотношением сторон: та же камера, что на десктопе, обрезала бы
  // бойцов по краям, а Мунда заняла бы полэкрана. Поэтому в портрете
  // угол шире, камера ближе и смотрит ниже — кадр держит бойцов,
  // а не пустую землю под ними.
  camera.fov = narrow ? 54 : 42;
  camera.position.set(0, narrow ? 3.0 : 2.9, narrow ? 10.4 : 8.4);
  camera.lookAt(0, narrow ? 1.4 : 1.2, narrow ? -1.8 : 0);
  camera.updateProjectionMatrix();
}
