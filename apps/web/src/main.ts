import { api } from './api.ts';
import { clear, el } from './dom.ts';
import { getLocale, setLocale, t } from './i18n.ts';
import { renderAuth } from './screens/auth.ts';
import { renderVillage } from './screens/village.ts';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('#app не найден');

setLocale(getLocale());
document.title = t('app.title');

/**
 * Маршрутизации в M0 нет: состояний ровно два — есть сессия или нет.
 * Источник правды о том, кто вошёл, — сервер (GET /me), а не localStorage.
 * Клиент не хранит и не может подделать признак «я залогинен».
 */
async function route(): Promise<void> {
  clear(root!);
  root!.append(
    el('main', { class: 'screen' }, [el('p', { class: 'loading' }, [t('app.loading')])]),
  );

  const me = await api.me();

  if (me === null) {
    renderAuth(root!, () => void route());
  } else {
    renderVillage(root!, me.player, () => void route());
  }
}

void route();
