/**
 * Пути API в одном месте. Клиент не пишет строки URL руками —
 * иначе опечатка находится в рантайме, а не при компиляции.
 */
export const API_ROUTES = {
  health: '/health',
  me: '/me',
  auth: '/api/auth',
  battleStart: '/battle/start',
  simulatePreview: '/simulate/preview',
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];
