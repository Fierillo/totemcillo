import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'shots', '.previews', '.vercel', 'node_modules', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Moderate guards: warnings (listed by `pnpm lint`) so they push towards smaller pieces without blocking.
      complexity: ['warn', 25],
      'max-len': ['warn', { code: 220, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreUrls: true, ignoreComments: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      '@typescript-eslint/no-explicit-any': 'warn', // a few typed-JSON boundaries (server, tests); listed, not blocking,
    },
  },
  { files: ['tests/**'], rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-non-null-assertion': 'off' } },
);
