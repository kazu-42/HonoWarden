import { Hono } from 'hono'

import type { Bindings } from './bindings'

const serviceDescription =
  'A minimal, API-only Bitwarden-compatible server for Cloudflare Workers, built with Hono, D1, and R2.'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.json({
    name: 'HonoWarden',
    description: serviceDescription,
    status: 'pre-alpha',
    links: {
      health: '/healthz',
    },
  })
})

app.get('/healthz', (c) => {
  return c.json({
    status: 'ok',
    service: 'honowarden',
  })
})

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'not_found',
        message: 'The requested resource was not found.',
      },
    },
    404,
  )
})

export default app
