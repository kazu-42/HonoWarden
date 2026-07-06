import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'

import type { Bindings } from './bindings'
import { getDatabaseHealth } from './infra/db-health'
import { buildServerConfig } from './protocol/config'

type Variables = {
  requestId: string
}

const serviceDescription =
  'A minimal, API-only encrypted vault sync server for Cloudflare Workers, built with Hono, D1, and R2.'

const upstreamClientHeaderPrefix = ['Bit', 'warden'].join('')

const defaultCorsHeaders = [
  'Accept',
  'Authorization',
  `${upstreamClientHeaderPrefix}-Client-Name`,
  `${upstreamClientHeaderPrefix}-Client-Version`,
  `${upstreamClientHeaderPrefix}-Package-Type`,
  'Content-Type',
  'Device-Identifier',
  'Device-Name',
  'Device-Type',
  'Is-Prerelease',
  'X-Device-Identifier',
  'X-Device-Name',
  'X-Request-Email',
  'X-Request-Id',
]

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (!origin) {
        return ''
      }

      const requestOrigin = new URL(c.req.url).origin
      if (origin === requestOrigin || isExtensionOrigin(origin)) {
        return origin
      }

      return ''
    },
    allowHeaders: defaultCorsHeaders,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 86400,
    credentials: true,
  }),
)

app.use('*', secureHeaders())
app.use('*', requestId())
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Request-Id', c.get('requestId'))
})

function isExtensionOrigin(origin: string): boolean {
  return (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://') ||
    origin.startsWith('safari-web-extension://')
  )
}

function buildHealthResponse(requestIdValue: string) {
  return {
    status: 'ok',
    service: 'honowarden',
    version: '0.0.0-alpha',
    requestId: requestIdValue,
  }
}

app.get('/', (c) => {
  return c.json({
    name: 'HonoWarden',
    description: serviceDescription,
    status: 'pre-alpha',
    links: {
      config: '/api/config',
      health: '/health',
    },
    requestId: c.get('requestId'),
  })
})

app.get('/health', (c) => {
  return c.json(buildHealthResponse(c.get('requestId')))
})

app.get('/healthz', (c) => {
  return c.json(buildHealthResponse(c.get('requestId')))
})

app.get('/health/db', async (c) => {
  const health = await getDatabaseHealth(c.env.DB)

  if (!health.ok) {
    return c.json(
      {
        status: 'error',
        service: 'honowarden',
        database: health,
        requestId: c.get('requestId'),
      },
      503,
    )
  }

  return c.json({
    status: 'ok',
    service: 'honowarden',
    database: {
      schemaVersion: health.schemaVersion,
      requiredTables: health.requiredTables,
    },
    requestId: c.get('requestId'),
  })
})

app.get('/api/config', (c) => {
  const origin = new URL(c.req.url).origin

  return c.json(buildServerConfig(origin))
})

app.get('/config', (c) => {
  const origin = new URL(c.req.url).origin

  return c.json(buildServerConfig(origin))
})

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'not_found',
        message: 'The requested resource was not found.',
      },
      requestId: c.get('requestId'),
    },
    404,
  )
})

export default app
