import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'binaries/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
  prettierConfig,
)
