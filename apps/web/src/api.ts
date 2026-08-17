import {
  API_ROUTES,
  apiErrorSchema,
  meResponseSchema,
  type ApiError,
  type MeResponse,
  type SignInInput,
  type SignUpInput,
} from '@bruteforce/shared';

/**
 * Типизированный клиент API.
 *
 * Чего здесь принципиально НЕТ и не будет: строки подключения к БД,
 * SQL, боевого движка. Клиент умеет ровно одно — сходить по HTTP
 * и разобрать ответ. Всё, что меняет состояние игрока, решает сервер
 * (инвариант 1).
 */
const BASE_URL: string = import.meta.env['VITE_API_URL'] ?? 'http://localhost:8787';

/** Ошибка, у которой есть ключ локали. Именно её показывает UI. */
export class ApiClientError extends Error {
  readonly messageKey: string;
  readonly fields: Record<string, string>;
  readonly status: number;

  constructor(messageKey: string, status: number, fields: Record<string, string> = {}) {
    super(messageKey);
    this.name = 'ApiClientError';
    this.messageKey = messageKey;
    this.status = status;
    this.fields = fields;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      // Сессия живёт в httpOnly-куке: без credentials её не отправить.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new ApiClientError('error.network', 0);
  }

  const text = await response.text();
  const body: unknown = text === '' ? null : JSON.parse(text);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { error }: ApiError = parsed.data;
      throw new ApiClientError(error.messageKey, response.status, error.fields ?? {});
    }
    // Ответ не в нашем конверте — например, ошибка самого Better Auth.
    throw new ApiClientError('error.internal', response.status);
  }

  return body;
}

export const api = {
  async register(input: SignUpInput): Promise<void> {
    await request('/auth/register', { method: 'POST', body: JSON.stringify(input) });
  },

  async signIn(input: SignInInput): Promise<void> {
    await request(`${API_ROUTES.auth}/sign-in/email`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async signOut(): Promise<void> {
    await request(`${API_ROUTES.auth}/sign-out`, { method: 'POST', body: '{}' });
  },

  /** Профиль текущего игрока. null — сессии нет. */
  async me(): Promise<MeResponse | null> {
    try {
      return meResponseSchema.parse(await request(API_ROUTES.me));
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) return null;
      throw err;
    }
  },
};
