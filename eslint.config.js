// Flat ESLint config — correctness gate, not a style enforcer.
//
// Runs as part of `npm run build`, so Vercel refuses to deploy on a
// violation. The rules that matter here are the ones that catch real
// shipped bugs: `no-undef` (the 2026-07 typeBadge crash was an undefined
// identifier a refactor left behind) and `no-unused-vars` (dead imports
// that hide missing wiring). Stylistic churn is deliberately out of scope.

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'functions/node_modules/**'] },

  // Browser app code.
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Intentional patterns in this codebase — don't fight them.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Node: build scripts, functions, tests.
  {
    files: ['scripts/**/*.{js,mjs}', 'functions/src/**/*.js', 'functions/test/**/*.js', 'tests/**/*.mjs', 'eslint.config.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
