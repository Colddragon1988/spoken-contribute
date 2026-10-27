import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const noHtmlInjection = [
  'error',
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'Nur textContent/DOM-API benutzen (CSP, XSS).' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Nur DOM-API benutzen.' },
  { selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value='style']", message: 'style-Attribut verstößt gegen die CSP; element.style benutzen.' },
];

export default defineConfig([
  globalIgnores(['dist/', 'dist-dev/', 'release/', 'coverage/', 'test-results/', 'playwright-report/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'shared bleibt ohne Electron.' }],
        patterns: [{ group: ['node:*', '../core/*', '../main/*', '../preload/*', '../renderer/*'], message: 'shared importiert nur shared.' }],
      }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'Der Kern läuft ohne Electron (testbar ohne Fenster).' }],
        patterns: [{ group: ['**/main/*', '**/preload/*', '**/renderer/*'], message: 'Der Kern kennt main/preload/renderer nicht.' }],
      }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/upload/fetchTransport.ts'],
    rules: { 'no-restricted-globals': ['error', { name: 'fetch', message: 'Netz nur über HttpTransport.' }] },
  },
  {
    files: ['src/renderer/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'Der Renderer spricht nur über window.spoken.' }],
        patterns: [{ group: ['node:*', '**/core/*', '**/core/**', '**/main/*', '**/preload/*'], message: 'Der Renderer spricht nur über window.spoken.' }],
      }],
      'no-restricted-syntax': noHtmlInjection,
    },
  },
]);
