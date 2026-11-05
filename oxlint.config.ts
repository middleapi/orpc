import { defineConfig } from 'oxlint'

export default defineConfig({
  ignorePatterns: ['.agents/**', '.claude/**'],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  categories: {
    suspicious: 'error',
  },
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import'],
  rules: {
    'typescript/no-unsafe-type-assertion': 'off',
    'no-underscore-dangle': 'off',

    // conflict with patterns oRPC uses on purpose
    'no-shadow': 'off',
    'typescript/consistent-return': 'off',
    'typescript/no-generated-empty-object-type': 'off', // `{}` is the empty context/meta
    'typescript/no-unnecessary-type-parameters': 'off', // public generics that only drive inference
    'typescript/no-extraneous-class': 'off', // NestJS modules
    'typescript/no-unnecessary-type-assertion': 'off', // false positives on generic casts
    'typescript/unbound-method': 'off', // `next`, `on*` options are declared as methods but never use `this`
    'typescript/require-array-sort-compare': 'off',
    'unicorn/consistent-function-scoping': 'off',
    'unicorn/no-array-sort': 'off', // `toSorted`/`toReversed` are ES2023, packages target ES2022
    'unicorn/no-array-reverse': 'off',
    'unicorn/prefer-add-event-listener': 'off', // Bun's RedisClient only has `on*` properties
    'import/no-named-as-default': 'off',
    'import/no-unassigned-import': 'off',

    'eqeqeq': ['error', 'smart'],
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      },
    ],
    'guard-for-in': 'error',
    'no-prototype-builtins': 'error',
    'no-eval': 'error',
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-var': 'error',
    'prefer-const': 'error',
    'typescript/no-import-type-side-effects': 'error',
    'unicorn/prefer-node-protocol': 'error',
    'no-restricted-properties': [
      'error',
      {
        object: 'JSON',
        property: 'stringify',
        message: 'JSON.stringify can return undefined, use stringifyJSON instead',
      },
      {
        property: 'bytes',
        message:
          'Request/Blob/Response/... .bytes is not widely supported, use readAsBuffer instead',
      },
      {
        object: 'AbortSignal',
        property: 'any',
        message: 'Use anyAbortSignal instead',
      },
      {
        property: 'throwIfAborted',
        message:
          "React Native's AbortSignal polyfill has no throwIfAborted, use throwIfAborted from @orpc/shared instead",
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['/@openapi-spec/types', '/@standard-schema/spec', '/compression'],
            message: 'Please import from @orpc/* instead',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['packages/*/src/**'],
      rules: {
        'no-restricted-globals': [
          'error',
          {
            name: 'global',
            message: 'Use `globalThis` instead.',
          },
          {
            name: 'self',
            message: 'Use `globalThis` instead.',
          },
          {
            name: 'AbortSignal',
            message:
              'AbortSignal is not a global in every runtime, read it only behind a typeof guard',
          },
          {
            name: 'encodeURIComponent',
            message:
              'encodeURIComponent throws on lone surrogates, use safeEncodeURIComponent from @orpc/shared instead',
          },
          {
            name: 'decodeURIComponent',
            message:
              'decodeURIComponent throws on malformed input, use safeDecodeURIComponent from @orpc/shared instead',
          },
        ],
      },
    },
    {
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.test-d.ts',
        '**/tests/**',
        'tests/**',
        'benches/**',
        'apps/content/**',
        'playgrounds/**',
        'skills/**',
      ],
      rules: {
        'no-unused-vars': 'off',
        'no-restricted-properties': 'off',
        'no-restricted-globals': 'off',
        'no-console': 'off',
        'typescript/no-floating-promises': 'off',
        'typescript/await-thenable': 'off',
        'typescript/no-misused-spread': 'off',
        'typescript/restrict-template-expressions': 'off',
        'typescript/no-implied-eval': 'off',
        'require-yield': 'off',
        'no-unsafe-optional-chaining': 'off',
        'unicorn/no-thenable': 'off',
        'unicorn/no-array-fill-with-reference-type': 'off',
        // type tests spell out conversions and defaults on purpose
        'typescript/no-unnecessary-type-arguments': 'off',
        'typescript/no-unnecessary-type-conversion': 'off',
        'typescript/no-unnecessary-boolean-literal-compare': 'off',
        'typescript/no-unnecessary-template-expression': 'off',
      },
    },
    {
      files: ['scripts/**', 'apps/content/scripts/**'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['apps/content/**', 'playgrounds/**', 'skills/**'],
      rules: {
        'no-restricted-imports': 'off',
        'no-var': 'off',
      },
    },
  ],
})
