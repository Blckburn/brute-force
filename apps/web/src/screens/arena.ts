import type { BattleEvent, BattleStartResponse } from '@extramundum/shared';

import { api, ApiClientError } from '../api.ts';
import { stateAt } from '../battle/state.ts';
import { clear, el } from '../dom.ts';
import { t } from '../i18n.ts';
import { renderHud } from '../ui/hud.ts';
import { renderJournal } from '../ui/journal.ts';

/**
 * Арена: воспроизведение боевого лога. GDD §3.2, §10, M2b.
 *
 * Экран НЕ СЧИТАЕТ БОЙ. Он просит сервер провести бой, получает готовый
 * лог и показывает его. Ни одного броска, ни одной формулы урона здесь
 * нет и быть не может: движок в браузер не попадает (инвариант 3),
 * а состояние игрока читается сервером из БД (инвариант 1).
 *
 * **three.js грузится динамическим импортом.** Бюджет GDD §3.4 требует
 * первый кадр поселения быстрее двух секунд на 4G, а движок рендера —
 * самая тяжёлая часть клиента. Игрок, который открыл деревню и не пошёл
 * в бой, не должен его качать вовсе.
 */

/**
 * Хеш экипировки. GDD §6.4: клиент присылает его, чтобы сервер мог
 * заметить рассинхрон.
 *
 * Предметов не существует до M3, поэтому набор пуст, а хеш пустого
 * набора — нули. Считать здесь что-то настоящее нечего: сверять хеш
 * будет с чем, когда появится экипировка, и тогда же он начнёт
 * вычисляться. Заглушка честнее выдуманной суммы.
 */
const EMPTY_LOADOUT_HASH = '0'.repeat(64);

export function renderArena(root: HTMLElement, onBack: () => void): void {
  clear(root);

  const canvas = el('canvas', { class: 'arena__canvas' }) as HTMLCanvasElement;
  const overlay = el('div', { class: 'arena__overlay' });
  const readout = el('p', { class: 'arena__readout' }, [t('arena.loading')]);
  const controls = el('div', { class: 'arena__controls' });
  const journalHost = el('div', { class: 'arena__journal' });

  const back = el('button', { class: 'button button--ghost', type: 'button' }, [t('action.back')]);

  root.append(
    el('main', { class: 'screen screen--arena' }, [
      el('div', { class: 'arena__stage' }, [canvas, overlay]),
      controls,
      journalHost,
      el('div', { class: 'arena__bar' }, [readout, back]),
    ]),
  );

  let stop: (() => void) | null = null;
  back.addEventListener('click', () => {
    stop?.();
    onBack();
  });

  void (async () => {
    let battle: BattleStartResponse;
    try {
      battle = await api.startBattle({
        zone: 'wastes',
        difficulty: 'normal',
        loadoutHash: EMPTY_LOADOUT_HASH,
      });
    } catch (err) {
      const key = err instanceof ApiClientError ? err.messageKey : 'error.internal';
      readout.textContent = t(key);
      return;
    }

    if (!canvas.isConnected) return;

    const [{ mountBattleScene }, { BattlePlayer }] = await Promise.all([
      import('../render/index.ts'),
      import('../battle/player.ts'),
    ]);
    if (!canvas.isConnected) return;

    const mounted = mountBattleScene(canvas);
    const player = new BattlePlayer({
      scene: mounted.scene,
      log: battle.log,
      numberText: (event) => numberText(event),
    });

    overlay.append(player.numbers.element);

    const hud = renderHud(battle.maxHp);
    overlay.append(hud.element);

    const journal = renderJournal(battle.log, (index) => {
      player.setPaused(true);
      player.seekToEvent(index);
      syncControls();
    });
    journalHost.append(journal.element);

    mounted.setResizeHook((width, height) => player.resize(width, height));
    mounted.setFrameHook((dt) => player.advance(dt));

    /* ── органы управления. Скорости берутся ИЗ ДАННЫХ (animations.json),
       а не из литералов здесь: набор скоростей — это дизайн, а не код. */
    const playPause = el('button', { class: 'button button--small', type: 'button' });
    playPause.addEventListener('click', () => {
      player.setPaused(!player.paused);
      syncControls();
    });

    const restart = el('button', { class: 'button button--small', type: 'button' }, [
      t('battle.control.restart'),
    ]);
    restart.addEventListener('click', () => {
      player.seek(0);
      player.setPaused(false);
      syncControls();
    });

    const scrub = el('input', {
      class: 'arena__scrub',
      type: 'range',
      min: '0',
      max: String(Math.round(player.totalMs)),
      step: '10',
      value: '0',
      'aria-label': t('battle.control.scrub'),
    }) as HTMLInputElement;
    scrub.addEventListener('input', () => {
      player.setPaused(true);
      player.seek(Number(scrub.value));
      syncControls();
    });

    const speedButtons: HTMLButtonElement[] = [];
    const { animations } = await import('@extramundum/data');
    for (const speed of animations.speeds) {
      const button = el('button', { class: 'button button--small', type: 'button' }, [
        speed === 0 ? t('battle.control.instant') : t('battle.control.speed', { speed }),
      ]) as HTMLButtonElement;
      button.addEventListener('click', () => {
        player.setSpeed(speed);
        if (speed === 0) player.setPaused(true);
        syncControls();
      });
      speedButtons.push(button);
    }

    controls.append(playPause, restart, ...speedButtons, scrub);

    function syncControls(): void {
      playPause.textContent = player.paused ? t('battle.control.play') : t('battle.control.pause');
      scrub.value = String(Math.round(player.clockMs));
      for (let i = 0; i < speedButtons.length; i++) {
        const button = speedButtons[i];
        const speed = animations.speeds[i];
        if (button === undefined || speed === undefined) continue;
        button.classList.toggle('button--active', speed !== 0 && player.speed === speed);
      }
    }

    /* ── перерисовка по изменению показанного, а не по кадру.
       HUD и журнал меняются несколько раз в секунду; трогать их
       шестьдесят раз в секунду значило бы делать работу впустую. */
    const refresh = (): void => {
      const state = stateAt(battle.log, player.shownCount, battle.maxHp);
      hud.update(state);
      journal.reveal(player.shownCount);
      scrub.value = String(Math.round(player.clockMs));

      // Живое число вызовов отрисовки — от самого рендера, ВО ВРЕМЯ БОЯ.
      // Замер покоя доказывал бы только то, что покой дёшев.
      const budget = mounted.measure();
      readout.textContent = t('arena.budget', {
        draws: String(mounted.drawCalls() || budget.meshes),
        materials: String(budget.materials),
        triangles: String(Math.round(budget.triangles)),
      });
    };
    player.onChange(refresh);
    refresh();
    syncControls();

    // Итог боя и признак «наград нет» — от сервера, а не выведены здесь.
    const outcome =
      battle.outcome.winner === null
        ? t('battle.outcome.unfinished')
        : battle.outcome.winner === 0
          ? t('battle.outcome.win')
          : t('battle.outcome.loss');
    const summary = el('p', { class: 'arena__summary' }, [
      outcome,
      ...(battle.provisional
        ? [el('span', { class: 'arena__note' }, [t('battle.provisional')])]
        : []),
    ]);
    journalHost.prepend(summary);

    stop = () => {
      mounted.setFrameHook(null);
      mounted.setResizeHook(null);
      player.dispose();
      mounted.stop();
    };
  })();
}

/**
 * Текст всплывающего числа. Инвариант 6: строки — из словаря, а числа —
 * ИЗ ЛОГА. Клиент не складывает и не выводит ни одной величины.
 *
 * `null` означает «числу здесь не место»: событие без величины не должно
 * рисовать пустой прямоугольник над головой.
 */
function numberText(event: BattleEvent): string | null {
  switch (event.t) {
    case 'damage':
      return t('battle.damage', { amount: event.amount });
    case 'dodge':
      return t('battle.dodge.short');
    case 'block':
      return t('battle.block.amount', { amount: event.mitigated });
    case 'status_tick':
      return event.amount === undefined ? null : t('battle.damage', { amount: event.amount });
    default:
      return null;
  }
}
