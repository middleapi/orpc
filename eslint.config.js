import antfu from '@antfu/eslint-config'

export default antfu({
  react: true,
  formatters: true,
}, {
  rules: {
    'ts/consistent-type-definitions': 'off',
    'react-refresh/only-export-components': 'off',
    'react/prefer-destructuring-assignment': 'off',
    'react/no-context-provider': 'off',
  },
}, {
  files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test-d.ts', '**/*.test-d.tsx', 'apps/content/examples/**', 'playgrounds/**'],
  rules: {
    'unused-imports/no-unused-vars': 'off',
    'antfu/no-top-level-await': 'off',
    'react-hooks/rules-of-hooks': 'off',
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
  },
})
