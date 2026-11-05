import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const OS_MESSAGE = 'OS detection only in the composition root and in src-tauri.';
const NETWORK_MESSAGE = 'External access belongs to infrastructure, behind a port.';

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
  {
    selector: `VariableDeclarator[init.name='navigator'] > ObjectPattern > Property[key.name=${OS_PROPERTIES}]`,
    message: OS_MESSAGE,
  },
  {
    selector: `VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name='platform']`,
    message: OS_MESSAGE,
  },
];

const NETWORK_SYNTAX = [
  { selector: `MemberExpression[object.name=${GLOBAL_ROOTS}][property.name=${NETWORK_NAMES}]`, message: NETWORK_MESSAGE },
  { selector: `MemberExpression[object.name=${GLOBAL_ROOTS}][property.value=${NETWORK_NAMES}]`, message: NETWORK_MESSAGE },
  {
    selector: `VariableDeclarator[init.name=${GLOBAL_ROOTS}] > ObjectPattern > Property[key.name=${NETWORK_NAMES}]`,
    message: NETWORK_MESSAGE,
  },
  {
    selector: `VariableDeclarator[init.name=${GLOBAL_ROOTS}] > ObjectPattern > Property[key.value=${NETWORK_NAMES}]`,
    message: NETWORK_MESSAGE,
  },
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
              message: 'domain imports nothing from outside domain itself (rule 1).',
            },
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { types: ['domain', 'application'] } } },
              message: 'application imports only domain and its own ports (rule 2).',
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: { to: { element: { types: ['domain', 'application', 'infrastructure'] } } },
              message: 'infrastructure depends only on domain and application.',
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
        { patterns: [{ regex: '^[^.]', message: 'domain is pure TypeScript: no external dependencies (rule 1).' }] },
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
            { group: ['@angular/*', '@angular/**'], message: 'application does not know Angular (rule 2).' },
            { group: ['@tauri-apps/*', '@tauri-apps/**'], message: 'application does not know Tauri (rule 2).' },
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
            { group: ['@tauri-apps/*', '@tauri-apps/**'], message: 'ui does not call Tauri plugins or invoke (rule 4).' },
            { group: ['@angular/common/http', '@angular/common/http/**'], message: 'ui does not make HTTP calls: use a use case (rule 4).' },
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
