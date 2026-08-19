import { signInInputSchema, signUpInputSchema, fieldErrorKeys } from '@extramundum/shared';
import { ZodError } from 'zod';

import { api, ApiClientError } from '../api.ts';
import { t } from '../i18n.ts';
import { el, clear } from '../dom.ts';

type Mode = 'signIn' | 'signUp';

/**
 * Экран входа и регистрации.
 *
 * Валидация идёт теми же схемами, что и на сервере (@extramundum/shared):
 * клиентская проверка нужна только чтобы не гонять заведомо кривой запрос
 * по сети. Настоящая проверка — на сервере, и она не отключается.
 */
export function renderAuth(root: HTMLElement, onSignedIn: () => void): void {
  let mode: Mode = 'signIn';
  let busy = false;
  let formError: string | null = null;
  let fieldErrors: Record<string, string> = {};

  const values = { email: '', password: '', username: '' };

  function field(name: 'email' | 'password' | 'username', type: string): HTMLElement {
    const input = el('input', {
      class: 'field__input',
      type,
      id: `field-${name}`,
      value: values[name],
      autocomplete:
        name === 'email' ? 'email' : name === 'password' ? 'current-password' : 'nickname',
    }) as HTMLInputElement;

    input.addEventListener('input', () => {
      values[name] = input.value;
      if (fieldErrors[name]) {
        delete fieldErrors[name];
        draw();
      }
    });

    const error = fieldErrors[name];

    return el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: `field-${name}` }, [t(`auth.field.${name}`)]),
      input,
      error !== undefined
        ? el('p', { class: 'field__error', role: 'alert' }, [t(error)])
        : el('p', { class: 'field__hint' }, [
            name === 'password'
              ? t('auth.hint.password')
              : name === 'username'
                ? t('auth.hint.username')
                : '',
          ]),
    ]);
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (busy) return;

    fieldErrors = {};
    formError = null;

    try {
      if (mode === 'signUp') {
        const input = signUpInputSchema.parse(values);
        busy = true;
        draw();
        await api.register(input);
      } else {
        const input = signInInputSchema.parse({ email: values.email, password: values.password });
        busy = true;
        draw();
        await api.signIn(input);
      }
      onSignedIn();
      return;
    } catch (err) {
      if (err instanceof ZodError) {
        fieldErrors = fieldErrorKeys(err);
      } else if (err instanceof ApiClientError) {
        fieldErrors = err.fields;
        // Better Auth отвечает 401 на неверную пару почта/пароль.
        // Общую ошибку показываем только если ни одно поле не подсвечено:
        // иначе «Такое имя уже занято» дублируется под полем и над кнопкой.
        if (err.status === 401 && mode === 'signIn') {
          formError = 'error.credentials.invalid';
        } else if (Object.keys(fieldErrors).length === 0) {
          formError = err.messageKey;
        }
      } else {
        formError = 'error.internal';
      }
    } finally {
      busy = false;
      draw();
    }
  }

  function draw(): void {
    clear(root);

    const form = el('form', { class: 'card', novalidate: 'true' }, [
      el('h1', { class: 'card__title' }, [t(`auth.${mode}.title`)]),

      field('email', 'email'),
      ...(mode === 'signUp' ? [field('username', 'text')] : []),
      field('password', 'password'),

      formError !== null
        ? el('p', { class: 'form__error', role: 'alert' }, [t(formError)])
        : el('span', {}, []),

      el('button', { class: 'button', type: 'submit', ...(busy ? { disabled: 'true' } : {}) }, [
        busy ? t('auth.busy') : t(mode === 'signIn' ? 'auth.action.signIn' : 'auth.action.signUp'),
      ]),

      el(
        'button',
        { class: 'button button--link', type: 'button' },
        [t(mode === 'signIn' ? 'auth.switch.toSignUp' : 'auth.switch.toSignIn')],
        {
          click: () => {
            mode = mode === 'signIn' ? 'signUp' : 'signIn';
            fieldErrors = {};
            formError = null;
            draw();
          },
        },
      ),
    ]);

    form.addEventListener('submit', (event) => void submit(event));
    root.append(el('main', { class: 'screen screen--auth' }, [form]));
  }

  draw();
}
