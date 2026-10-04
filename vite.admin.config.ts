import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('./admin', import.meta.url)),
  base: '/admin/',
  build: {
    outDir: fileURLToPath(new URL('./dist/admin', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  worker: { format: 'es' },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787' },
      '/identity': { target: 'http://127.0.0.1:8787' },
    },
  },
})
