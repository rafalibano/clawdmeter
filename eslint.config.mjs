import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const OS_DETECTION = [
  { object: 'navigator', property: 'platform', message: 'Detecção de SO só no composition-root e em src-tauri.' },
  { object: 'navigator', property: 'userAgent', message: 'Detecção de SO só no composition-root e em src-tauri.' },
  { object: 'navigator', property: 'userAgentData', message: 'Detecção de SO só no composition-root e em src-tauri.' },
];

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket'].map((name) => ({
  name,
  message: 'Acesso externo pertence à infrastructure, atrás de uma porta.',
}));

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.angular/**', 'src-tauri/**', 'out-tsc/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain' },
        { type: 'application', pattern: 'src/application' },
        { type: 'infrastructure', pattern: 'src/infrastructure' },
        { type: 'ui', pattern: 'src/ui' },
      ],
      'boundaries/files': [{ pattern: 'src/*.ts', category: 'composition' }],
      'import/resolver': { node: { extensions: ['.ts', '.js', '.mjs'] } },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'domain' } },
              allow: { to: { element: { type: 'domain' } } },
              message: 'domain não importa nada de fora do próprio domain (regra 1).',
            },
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { types: ['domain', 'application'] } } },
              message: 'application importa só domain e as próprias portas (regra 2).',
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: { to: { element: { types: ['domain', 'application', 'infrastructure'] } } },
              message: 'infrastructure só depende de domain e application.',
            },
            {
              from: { element: { type: 'ui' } },
              allow: { to: { element: { types: ['domain', 'application', 'ui'] } } },
              message: 'ui nunca importa infrastructure (regras 3 e 4).',
            },
            {
              from: { file: { categories: 'composition' } },
              allow: {
                to: [
                  { element: { types: ['domain', 'application', 'infrastructure', 'ui'] } },
                  { file: { categories: 'composition' } },
                ],
              },
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...NETWORK_GLOBALS],
      'no-restricted-properties': ['error', ...OS_DETECTION],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^[^.]', message: 'domain é TypeScript puro: sem dependências externas (regra 1).' }] },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@angular/*', '@angular/**'], message: 'application não conhece Angular (regra 2).' },
            { group: ['@tauri-apps/*', '@tauri-apps/**'], message: 'application não conhece Tauri (regra 2).' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@tauri-apps/*', '@tauri-apps/**'], message: 'ui não chama plugin nem invoke do Tauri (regra 4).' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/*.ts'],
    rules: { 'no-restricted-properties': 'off', 'no-restricted-globals': 'off' },
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['**/*.spec.ts', 'src/**/testing/**/*.ts', 'tools/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
