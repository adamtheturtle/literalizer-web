import eslint from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/highlighter.js'],
  },
  eslint.configs.recommended,
  {
    files: ['*.config.js', 'dist/**/*.js', 'src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
      },
      sourceType: 'module',
    },
  },
];
