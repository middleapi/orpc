import { defineConfig } from 'oxlint'

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: true,
  },
  ignorePatterns: [
    '.agents/skills/**',
    '.claude/skills/**',
    // type-aware rules require strictNullChecks, which this fixture turns off on purpose
    'packages/typescript-openapi/tests/fixtures/loose/**',
  ],
  categories: {
    correctness: 'error',
    suspicious: 'error',
  },
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import'],
  rules: {
    'typescript/no-unsafe-type-assertion': 'off',
    'no-underscore-dangle': 'off',
    // fixing it would change public types
    'typescript/no-generated-empty-object-type': 'off',
    // its fixes break type checking on generic code
    'typescript/no-unnecessary-type-assertion': 'off',
    'typescript/unbound-method': 'off',
    'no-shadow': 'off',

    'eqeqeq': 'error',
    'guard-for-in': 'error',
    'no-prototype-builtins': 'error',
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-var': 'error',
    'prefer-const': 'error',
    'typescript/no-import-type-side-effects': 'error',
    'unicorn/prefer-node-protocol': 'error',
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
        message: 'AbortSignal is not a global in every runtime, read it only behind a typeof guard',
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
            group: ['@openapi-spec/types', '@openapi-spec/types/*', '@standard-schema/spec'],
            message: 'Please import from @orpc/* instead',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.test-d.ts',
        'playgrounds/**',
        'apps/content/**',
      ],
      rules: {
        'no-unused-vars': 'off',
        'no-restricted-properties': 'off',
        'no-restricted-globals': 'off',
        'no-console': 'off',
        'no-shadow': 'off',
        'unicorn/consistent-function-scoping': 'off',
        'import/no-unassigned-import': 'off',
        // intentional in test fixtures
        'require-yield': 'off',
        'no-unsafe-optional-chaining': 'off',
        'typescript/await-thenable': 'off',
      },
    },
  ],
})
