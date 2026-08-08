import { configDefaults, defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./test/support/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    maxWorkers: 2,
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, '.workflow/**', 'test/.tmp/**'],
  },
})
