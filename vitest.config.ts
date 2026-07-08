import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    maxWorkers: 2,
    testTimeout: 30_000,
  },
})
