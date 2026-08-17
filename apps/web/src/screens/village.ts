import type { PlayerProfile } from '@bruteforce/shared';

import { api } from '../api.ts';
import { clear, el } from '../dom.ts';
import { t } from '../i18n.ts';

/**
 * Заглушка деревни — граница этапа M0.
 *
 * Показывает то, что сервер прочитал из БД по сессии, и ничего больше.
 * Кузнец, лавка, инвентарь и вход в рейд — это M3 (GDD §10).
 */
export function renderVillage(
  root: HTMLElement,
  player: PlayerProfile,
  onSignedOut: () => void,
): void {
  clear(root);

  const stat = (labelKey: string, value: number) =>
    el('div', { class: 'stat' }, [
      el('span', { class: 'stat__label' }, [t(labelKey)]),
      el('span', { class: 'stat__value' }, [String(value)]),
    ]);

  const signOut = el('button', { class: 'button button--ghost', type: 'button' }, [
    t('auth.action.signOut'),
  ]);
  signOut.addEventListener('click', () => {
    void api.signOut().then(onSignedOut, onSignedOut);
  });

  root.append(
    el('main', { class: 'screen screen--village' }, [
      el('header', { class: 'village__header' }, [
        el('h1', { class: 'village__title' }, [t('village.title')]),
        signOut,
      ]),

      // Имя приходит из БД и вставляется текстовым узлом, не разметкой.
      el('p', { class: 'village__greeting' }, [
        t('village.greeting', { username: player.username }),
      ]),

      el('div', { class: 'stats' }, [
        stat('village.stat.level', player.level),
        stat('village.stat.xp', player.xp),
        stat('village.stat.gold', player.gold),
        stat('village.stat.elo', player.elo),
      ]),

      el('p', { class: 'village__stub' }, [t('village.stub')]),
    ]),
  );
}
