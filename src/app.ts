import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'

import type { Bindings } from './bindings'
import {
  buildBootstrapUserRecord,
  isBootstrapEnabled,
  resolveBootstrapAccount,
  verifyBootstrapToken,
} from './domain/bootstrap'
import { resolvePrelogin } from './domain/prelogin'
import { getDatabaseHealth } from './infra/db-health'
import { buildServerConfig } from './protocol/config'
import { createBootstrapUser } from './repositories/user-repository'

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

app.post('/identity/accounts/prelogin', async (c) => {
  const body = await readJsonBody(c.req.raw)
  const decision = resolvePrelogin(body, c.env?.HONOWARDEN_ALLOWED_EMAILS)

  if (!decision.ok) {
    return c.json(
      {
        error: decision.error,
        requestId: c.get('requestId'),
      },
      decision.status,
    )
  }

  return c.json(decision.response)
})

app.post('/api/accounts/register', (c) => {
  return c.json(
    {
      error: {
        code: 'registration_disabled',
        message: 'Public registration is disabled.',
      },
      requestId: c.get('requestId'),
    },
    403,
  )
})

app.post('/identity/accounts/register', (c) => {
  return c.json(
    {
      error: {
        code: 'registration_disabled',
        message: 'Public registration is disabled.',
      },
      requestId: c.get('requestId'),
    },
    403,
  )
})

app.post('/api/accounts/bootstrap', async (c) => {
  if (!isBootstrapEnabled(c.env?.HONOWARDEN_BOOTSTRAP_ENABLED)) {
    return c.json(
      {
        error: {
          code: 'bootstrap_disabled',
          message: 'Account bootstrap is disabled.',
        },
        requestId: c.get('requestId'),
      },
      403,
    )
  }

  if (
    !verifyBootstrapToken(
      c.env?.HONOWARDEN_BOOTSTRAP_TOKEN,
      c.req.header('X-HonoWarden-Bootstrap-Token'),
    )
  ) {
    return c.json(
      {
        error: {
          code: 'bootstrap_forbidden',
          message: 'Account bootstrap is not authorized.',
        },
        requestId: c.get('requestId'),
      },
      403,
    )
  }

  const body = await readJsonBody(c.req.raw)
  const decision = resolveBootstrapAccount(
    body,
    c.env?.HONOWARDEN_ALLOWED_EMAILS,
  )

  if (!decision.ok) {
    return c.json(
      {
        error: decision.error,
        requestId: c.get('requestId'),
      },
      decision.status,
    )
  }

  const now = new Date().toISOString()
  const user = buildBootstrapUserRecord(decision.payload, {
    id: crypto.randomUUID(),
    revisionDate: now,
    securityStamp: crypto.randomUUID(),
  })

  try {
    const result = await createBootstrapUser(c.env.DB, user)

    if (result.status === 'duplicate') {
      return c.json(
        {
          error: {
            code: 'account_exists',
            message: 'An account already exists for this email.',
          },
          requestId: c.get('requestId'),
        },
        409,
      )
    }

    return c.json(
      {
        object: 'user',
        id: result.userId,
        email: user.emailNormalized,
        requestId: c.get('requestId'),
      },
      201,
    )
  } catch {
    return c.json(
      {
        error: {
          code: 'database_unavailable',
          message: 'Account bootstrap failed.',
        },
        requestId: c.get('requestId'),
      },
      503,
    )
  }
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

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export default app
