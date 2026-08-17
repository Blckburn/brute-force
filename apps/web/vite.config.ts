import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/**
 * Инвариант 3: @bruteforce/sim не попадает в браузерный бандл.
 *
 * Здесь стоит третий рубеж защиты (первый — правило ESLint, второй —
 * отсутствие sim в зависимостях apps/web): если движок всё-таки окажется
 * в графе импортов, сборка падает прямо здесь, с внятным сообщением.
 * Четвёртый рубеж — scripts/check-bundle.mjs, который смотрит уже
 * на собранные файлы.
 */
function forbidSimImport() {
  return {
    name: 'bruteforce:forbid-sim-import',
    resolveId(source: string, importer: string | undefined) {
      if (source === '@bruteforce/sim' || source.startsWith('@bruteforce/sim/')) {
        throw new Error(
          `Инвариант 3 нарушен: ${importer ?? 'клиент'} импортирует ${source}.\n` +
            'Боевой движок исполняется только на сервере (GDD §2.1).\n' +
            'Превью шансов победы получают эндпоинтом POST /simulate/preview.',
        );
      }
      return null;
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [forbidSimImport()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
