import antfu from '@antfu/eslint-config'
import pluginBan from 'eslint-plugin-ban'

export default antfu({
  formatters: true,
  ignores: ['packages/hey-api/tests/client/**'],
  rules: {
    'pnpm/yaml-enforce-settings': 'off',
    'yaml/sort-keys': 'off',
  },
}, {
  plugins: { ban: pluginBan },
  rules: {
    'ts/consistent-type-definitions': 'off',
    'ts/method-signature-style': ['off'],
    'ban/ban': [
      'error',
      {
        name: ['JSON', 'stringify'],
        message: 'JSON.stringify can return undefined, use stringifyJSON instead',
      },
      {
        name: ['*', 'bytes'],
        message: 'Request/Blob/Response/... .bytes is not widely supported, use readAsBuffer instead',
      },
      {
        name: 'decodeURIComponent',
        message: 'decodeURIComponent can throw an error, use tryDecodeURIComponent instead',
      },
    ],
    'no-restricted-imports': ['error', {
      patterns: [{
        group: [
          '/json-schema-typed',
          '/openapi-types',
          '/@standard-schema/spec',
          '/compression',
        ],
        message: 'Please import from @orpc/* instead',
      }],
      paths: [
        {
          name: '@opentelemetry/api',
          allowImportNames: [
            'AttributeValue',
            'Context',
            'ContextAPI',
            'Exception',
            'PropagationAPI',
            'Span',
            'SpanOptions',
            'SpanStatusCode',
            'TraceAPI',
            'Tracer',
          ],
          message: 'Require explicit runtime import from @orpc/opentelemetry',
        },
      ],
    }],
    'pnpm/json-enforce-catalog': 'off',
  },
}, {
  files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test-d.ts', '**/*.test-d.tsx', 'apps/content/shared/**', 'playgrounds/**', 'packages/*/playground/**'],
  rules: {
    'unused-imports/no-unused-vars': 'off',
    'antfu/no-top-level-await': 'off',
    'no-alert': 'off',
    'ban/ban': 'off',
  },
}, {
  files: [
    'apps/content/shared/**',
    'apps/content/blog/**',
    'apps/content/docs/**',
    'apps/content/examples/**',
    'apps/content/learn-and-contribute/**',
    'playgrounds/**',
    'packages/*/playground/**',
  ],
  rules: {
    'no-restricted-imports': 'off',
    'no-console': 'off',
    'perfectionist/sort-imports': 'off',
    'import/first': 'off',
    'ban/ban': 'off',
    'no-var': 'off',
    'vars-on-top': 'off',
    'unicorn/prefer-type-error': 'off',
    'antfu/no-import-node-modules-by-path': 'off',
    'no-restricted-globals': 'off',
  },
}, {
  files: ['apps/content/examples/**'],
  rules: {
    'import/first': 'off',
  },
}, {
  files: ['playgrounds/**'],
  rules: {
    'no-alert': 'off',
    'eslint-comments/no-unlimited-disable': 'off',
    'node/prefer-global/process': 'off',
  },
}, {
  files: ['playgrounds/nest/**'],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'off',
  },
})
