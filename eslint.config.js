import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts', '.localdb/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // Инвариант 2: packages/sim — чистая функция.
  // Ноль зависимостей, ноль I/O, никакого Math.random() и Date.now().
  // ─────────────────────────────────────────────────────────────────
  {
    files: ['packages/sim/**/*.ts'],
    ignores: ['packages/sim/**/__tests__/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'packages/sim не делает I/O (инвариант 2).' },
        { name: 'performance', message: 'packages/sim не обращается ко времени (инвариант 2).' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Источник случайности в sim — только сид из аргумента (инвариант 2).',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'packages/sim не обращается ко времени (инвариант 2).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'crypto'],
              message: 'packages/sim не делает I/O (инвариант 2).',
            },
            {
              group: ['@bruteforce/*'],
              message: 'packages/sim не зависит ни от чего (инвариант 2).',
            },
          ],
        },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // Инвариант 3: движок не попадает в браузерный бандл.
  // Первая линия обороны — здесь, вторая — scripts/check-bundle.mjs.
  // ─────────────────────────────────────────────────────────────────
  {
    files: ['apps/web/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bruteforce/sim', '@bruteforce/sim/*', '**/packages/sim/**'],
              message:
                'Инвариант 3: боевой движок живёт только на сервере. Превью — через POST /simulate/preview.',
            },
          ],
        },
      ],
    },
  },

  // Тесты: там нужны и node:fs, и обращения ко времени.
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },

  // Скрипты и конфиги сборки исполняются в Node.
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}', '**/*.config.{js,ts}'],
    rules: {
      'no-undef': 'off',
    },
  },

  prettier,
);
