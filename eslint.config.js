import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'coverage',
      'dist',
      'node_modules',
      '.wrangler',
      'test/.tmp',
      'worker-configuration.d.ts',
    ],
  },
  {
    languageOptions: {
      globals: {
        console: 'readonly',
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
)
