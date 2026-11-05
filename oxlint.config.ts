import { defineConfig } from 'oxlint'

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: true,
  },
  ignorePatterns: [
    '.agents/**',
    '.claude/**',
    '**/worker-configuration.d.ts',
    'apps/content/sponsors/slots.ts',
    'apps/content/sponsors/sponsors.ts',
  ],
  categories: {
    correctness: 'error',
    suspicious: 'error',
  },
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import'],
  rules: {
    'typescript/no-unsafe-type-assertion': 'off',
    'no-underscore-dangle': 'off',
    'typescript/unbound-method': 'off',
    'typescript/no-base-to-string': 'off',
    // fixing these would change public types
    'typescript/no-generated-empty-object-type': 'off',
    'typescript/no-unnecessary-type-parameters': 'off',
    'typescript/no-redundant-type-constituents': 'off',
    // its fixes break type checking on generic code
    'typescript/no-unnecessary-type-assertion': 'off',
    'no-shadow': 'off',
    'unicorn/consistent-function-scoping': 'off',
    'import/no-named-as-default': 'off',
    'import/no-unassigned-import': 'off',
    'unicorn/prefer-add-event-listener': 'off',
    'typescript/consistent-return': 'off',
    'no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],

    'eqeqeq': ['error', 'smart'],
    'guard-for-in': 'error',
    'no-prototype-builtins': 'error',
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
        object: 'AbortSignal',
        property: 'any',
        message: 'Use anyAbortSignal instead',
      },
      {
        property: 'bytes',
        message:
          'Request/Blob/Response/... .bytes is not widely supported, use readAsBuffer instead',
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
            group: [
              '@openapi-spec/types',
              '@openapi-spec/types/*',
              '@standard-schema/spec',
              'compression',
            ],
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
        // packages target ES2022
        'unicorn/no-array-sort': 'off',
        'unicorn/no-array-reverse': 'off',
      },
    },
    {
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.test-d.ts',
        'tests/**',
        'packages/*/tests/**',
        'packages/*/src/**/__tests__/**',
        'benches/**',
        'apps/content/**',
        'playgrounds/**',
        'skills/**',
      ],
      rules: {
        'no-unused-vars': 'off',
        'no-restricted-properties': 'off',
        'no-restricted-globals': 'off',
        'no-restricted-imports': 'off',
        'no-console': 'off',
        'no-thenable': 'off',
        'no-useless-constructor': 'off',
        'no-unsafe-optional-chaining': 'off',
        'require-yield': 'off',
        'typescript/await-thenable': 'off',
        'typescript/no-extraneous-class': 'off',
        'typescript/no-floating-promises': 'off',
        'typescript/no-implied-eval': 'off',
        'typescript/no-misused-spread': 'off',
        'typescript/no-unnecessary-type-arguments': 'off',
        'typescript/no-unnecessary-type-conversion': 'off',
        'typescript/require-array-sort-compare': 'off',
        'typescript/restrict-template-expressions': 'off',
      },
    },
    {
      files: ['scripts/**'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
})
