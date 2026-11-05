import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const OS_MESSAGE = 'Detecção de SO só no composition-root e em src-tauri.';
const NETWORK_MESSAGE = 'Acesso externo pertence à infrastructure, atrás de uma porta.';

const OS_DETECTION = [
  { object: 'navigator', property: 'platform', message: OS_MESSAGE },
  { object: 'navigator', property: 'userAgent', message: OS_MESSAGE },
  { object: 'navigator', property: 'userAgentData', message: OS_MESSAGE },
  { object: 'process', property: 'platform', message: OS_MESSAGE },
];

const GLOBAL_ROOTS = '/^(window|globalThis|self)$/';
const OS_PROPERTIES = '/^(platform|userAgent|userAgentData)$/';
const NETWORK_NAMES = '/^(fetch|XMLHttpRequest|WebSocket)$/';

const OS_SYNTAX = [
  {
    selector: `MemberExpression[object.property.name='navigator'][property.name=${OS_PROPERTIES}]`,
    message: OS_MESSAGE,
  },
  {
    selector: `MemberExpression[object.property.name='navigator'][property.value=${OS_PROPERTIES}]`,
    message: OS_MESSAGE,
  },
  { selector: `MemberExpression[object.name='navigator'][property.value=${OS_PROPERTIES}]`, message: OS_MESSAGE },
  { selector: `MemberExpression[object.name='process'][property.value='platform']`, message: OS_MESSAGE },
  { selector: `MemberExpression[object.object.name=${GLOBAL_ROOTS}][object.property.name='process'][property.name='platform']`, message: OS_MESSAGE },
  { selector: `VariableDeclarator[init.name='navigator'][id.type='ObjectPattern']`, message: OS_MESSAGE },
  { selector: `VariableDeclarator[init.name='process'][id.type='ObjectPattern']`, message: OS_MESSAGE },
];

const NETWORK_SYNTAX = [
  { selector: `MemberExpression[object.name=${GLOBAL_ROOTS}][property.name=${NETWORK_NAMES}]`, message: NETWORK_MESSAGE },
  { selector: `MemberExpression[object.name=${GLOBAL_ROOTS}][property.value=${NETWORK_NAMES}]`, message: NETWORK_MESSAGE },
  { selector: `VariableDeclarator[init.name=${GLOBAL_ROOTS}][id.type='ObjectPattern']`, message: NETWORK_MESSAGE },
];

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket'].map((name) => ({ name, message: NETWORK_MESSAGE }));

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
      'no-restricted-syntax': ['error', ...OS_SYNTAX, ...NETWORK_SYNTAX],
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
            { group: ['@angular/common/http', '@angular/common/http/**'], message: 'ui não faz HTTP: use um caso de uso (regra 4).' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/*.ts'],
    rules: { 'no-restricted-properties': 'off', 'no-restricted-globals': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-syntax': ['error', ...OS_SYNTAX],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@tauri-apps/plugin-os', '@tauri-apps/plugin-os/**'], message: OS_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'src/**/testing/**/*.ts', 'tools/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
