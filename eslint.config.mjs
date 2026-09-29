import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Single flat config for the whole monorepo: `packages/core`, `packages/web`, the
 * Playwright suite in `e2e/` and the root config files.
 *
 * Deliberately non-type-aware (no `projectService`), so `npm run lint` stays a fast
 * static pass that needs no per-folder `tsconfig`. TypeScript already runs separately
 * in strict mode, so the two tools do not overlap. Swapping `recommended` for
 * `recommendedTypeChecked` is the one-line change that adds promise-safety rules.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/core/.cache/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Browser code: the runtime engine, the React app and their tests.
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Node code: the dictionary build script, the Playwright suite, tool configs.
  {
    files: ['packages/*/scripts/**/*.ts', 'e2e/**/*.ts', 'packages/*/*.config.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Honour the `_name` convention for parameters that exist only to satisfy an
      // interface signature, e.g. Playwright's `onBegin(_config)`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' },
      ],
    },
  },

  {
    // Scoped to the React package on purpose: `eslint-plugin-react-hooks` flags
    // Playwright's fixture callback, which is also called `use`, in `e2e/`.
    files: ['packages/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    files: ['packages/web/src/hooks/usePinyinDuck.ts'],
    rules: {
      // Loading a remote dictionary is a real external-system sync. Status and error
      // are reset to their initial values in the effect body because they must go
      // back to 'loading' whenever `dictionaryUrl` changes, not only on mount, so
      // those writes are load-bearing rather than a redundant state update.
      // The rule stays on everywhere else, where it is still useful -- it is what
      // flagged the genuinely redundant setState in Editor.tsx.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
);
