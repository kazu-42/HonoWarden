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
import {
  generateRefreshToken,
  hashRefreshToken,
  invalidGrantError,
  parsePasswordGrantForm,
  parseRefreshTokenGrantForm,
  signAccessToken,
  tokenErrorResponse,
  tokenRequestError,
  verifyAccessToken,
  verifyPresentedPasswordHash,
} from './domain/tokens'
import { getDatabaseHealth } from './infra/db-health'
import { buildServerConfig } from './protocol/config'
import {
  createPasswordGrantSession,
  findAuthUserByEmail,
  findAuthUserById,
  findRefreshTokenSessionByHash,
  invalidateRefreshTokenSession,
  rotateRefreshToken,
} from './repositories/auth-repository'
import type { AuthUserRecord } from './repositories/auth-repository'
import { createBootstrapUser } from './repositories/user-repository'

type Variables = {
  requestId: string
}

const serviceDescription =
  'A minimal, API-only encrypted vault sync server for Cloudflare Workers, built with Hono, D1, and R2.'

const upstreamClientHeaderPrefix = ['Bit', 'warden'].join('')
const accessTokenTtlSeconds = 3600
const refreshTokenTtlSeconds = 60 * 60 * 24 * 30

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

app.post('/identity/connect/token', async (c) => {
  const tokenSecret = c.env?.HONOWARDEN_TOKEN_SECRET
  if (!tokenSecret) {
    return c.json(
      {
        error: {
          code: 'server_misconfigured',
          message: 'Token exchange is not configured.',
        },
        requestId: c.get('requestId'),
      },
      503,
    )
  }

  const form = await readFormBody(c.req.raw)

  if (form.get('grant_type') === 'refresh_token') {
    const grantDecision = parseRefreshTokenGrantForm(form)
    if (!grantDecision.ok) {
      return c.json(
        tokenErrorResponse(grantDecision.error),
        grantDecision.status,
      )
    }

    try {
      const refreshTokenHash = await hashRefreshToken(
        tokenSecret,
        grantDecision.grant.refreshToken,
      )
      const session = await findRefreshTokenSessionByHash(
        c.env.DB,
        refreshTokenHash,
      )

      if (!session) {
        return c.json(tokenErrorResponse(invalidGrantError()), 400)
      }

      const issuedAt = Math.floor(Date.now() / 1000)
      const now = new Date(issuedAt * 1000).toISOString()

      if (session.tokenRevokedAt) {
        await invalidateRefreshTokenSession(
          c.env.DB,
          session.userId,
          session.deviceId,
          now,
        )

        return c.json(tokenErrorResponse(invalidGrantError()), 400)
      }

      if (
        session.user.disabledAt ||
        session.deviceRevokedAt ||
        Date.parse(session.tokenExpiresAt) <= issuedAt * 1000
      ) {
        return c.json(tokenErrorResponse(invalidGrantError()), 400)
      }

      const nextRefreshToken = generateRefreshToken()
      const nextRefreshTokenHash = await hashRefreshToken(
        tokenSecret,
        nextRefreshToken,
      )
      const rotation = await rotateRefreshToken(c.env.DB, {
        currentTokenId: session.tokenId,
        userId: session.userId,
        deviceId: session.deviceId,
        deviceIdentifier: session.deviceIdentifier,
        deviceName: null,
        deviceType: null,
        nextRefreshTokenId: crypto.randomUUID(),
        nextRefreshTokenHash,
        nextRefreshTokenExpiresAt: new Date(
          (issuedAt + refreshTokenTtlSeconds) * 1000,
        ).toISOString(),
        now,
      })

      if (rotation.status === 'reuse_detected') {
        return c.json(tokenErrorResponse(invalidGrantError()), 400)
      }

      const accessToken = await signAccessToken(tokenSecret, {
        sub: session.user.id,
        email: session.user.emailNormalized,
        device: session.deviceIdentifier,
        securityStamp: session.user.securityStamp,
        iat: issuedAt,
        exp: issuedAt + accessTokenTtlSeconds,
      })

      return c.json(
        buildTokenResponse(session.user, accessToken, nextRefreshToken),
      )
    } catch {
      return c.json(
        {
          error: {
            code: 'database_unavailable',
            message: 'Token exchange failed.',
          },
          requestId: c.get('requestId'),
        },
        503,
      )
    }
  }

  const grantDecision = parsePasswordGrantForm(form)
  if (!grantDecision.ok) {
    return c.json(tokenErrorResponse(grantDecision.error), grantDecision.status)
  }

  const device = readDeviceInfo(c.req.raw.headers)
  if (!device) {
    const error = tokenRequestError(
      'invalid_request',
      'Device information is required.',
    )

    return c.json(tokenErrorResponse(error.error), error.status)
  }

  try {
    const user = await findAuthUserByEmail(
      c.env.DB,
      grantDecision.grant.usernameNormalized,
    )

    if (
      !user ||
      user.disabledAt ||
      !verifyPresentedPasswordHash(
        user.masterPasswordHash,
        grantDecision.grant.password,
      )
    ) {
      return c.json(tokenErrorResponse(invalidGrantError()), 400)
    }

    const issuedAt = Math.floor(Date.now() / 1000)
    const expiresAt = issuedAt + accessTokenTtlSeconds
    const refreshToken = generateRefreshToken()
    const refreshTokenHash = await hashRefreshToken(tokenSecret, refreshToken)
    const now = new Date(issuedAt * 1000).toISOString()

    await createPasswordGrantSession(c.env.DB, {
      userId: user.id,
      deviceIdentifier: device.identifier,
      deviceName: device.name,
      deviceType: device.type,
      refreshTokenId: crypto.randomUUID(),
      refreshTokenHash,
      refreshTokenExpiresAt: new Date(
        (issuedAt + refreshTokenTtlSeconds) * 1000,
      ).toISOString(),
      now,
    })

    const accessToken = await signAccessToken(tokenSecret, {
      sub: user.id,
      email: user.emailNormalized,
      device: device.identifier,
      securityStamp: user.securityStamp,
      iat: issuedAt,
      exp: expiresAt,
    })

    return c.json(buildTokenResponse(user, accessToken, refreshToken))
  } catch {
    return c.json(
      {
        error: {
          code: 'database_unavailable',
          message: 'Token exchange failed.',
        },
        requestId: c.get('requestId'),
      },
      503,
    )
  }
})

app.get('/api/sync', async (c) => {
  const tokenSecret = c.env?.HONOWARDEN_TOKEN_SECRET
  if (!tokenSecret) {
    return c.json(
      {
        error: {
          code: 'server_misconfigured',
          message: 'Vault sync is not configured.',
        },
        requestId: c.get('requestId'),
      },
      503,
    )
  }

  const accessToken = readBearerToken(c.req.header('Authorization'))
  if (!accessToken) {
    return c.json(
      syncAuthError(
        c.get('requestId'),
        'missing_token',
        'Bearer authorization is required.',
      ),
      401,
    )
  }

  const verification = await verifyAccessToken(tokenSecret, accessToken)
  if (!verification.ok) {
    return c.json(
      syncAuthError(
        c.get('requestId'),
        'invalid_token',
        'The access token is invalid.',
      ),
      401,
    )
  }

  try {
    const user = await findAuthUserById(c.env.DB, verification.claims.sub)

    if (
      !user ||
      user.disabledAt ||
      user.securityStamp !== verification.claims.securityStamp
    ) {
      return c.json(
        syncAuthError(
          c.get('requestId'),
          'invalid_token',
          'The access token is invalid.',
        ),
        401,
      )
    }

    return c.json(buildEmptySyncResponse(user))
  } catch {
    return c.json(
      {
        error: {
          code: 'database_unavailable',
          message: 'Vault sync failed.',
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

function buildTokenResponse(
  user: AuthUserRecord,
  accessToken: string,
  refreshToken: string,
) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: accessTokenTtlSeconds,
    Key: user.userKey,
    PrivateKey: user.privateKey,
    Kdf: user.kdfAlgorithm === 'pbkdf2-sha256' ? 0 : 0,
    KdfIterations: user.kdfIterations,
    KdfMemory: user.kdfMemory,
    KdfParallelism: user.kdfParallelism,
    AccountKeys: null,
    ForcePasswordReset: false,
    TwoFactorToken: null,
    MasterPasswordPolicy: null,
    UserDecryptionOptions: null,
    KeyConnectorUrl: null,
  }
}

function buildEmptySyncResponse(user: AuthUserRecord) {
  return {
    object: 'sync',
    Profile: {
      Id: user.id,
      Name: user.displayName ?? user.emailNormalized,
      Email: user.emailNormalized,
      EmailVerified: true,
      Premium: false,
      PremiumFromOrganization: false,
      Culture: 'en-US',
      TwoFactorEnabled: false,
      Key: user.userKey,
      AccountKeys: null,
      AvatarColor: '#3366cc',
      CreationDate: user.createdAt,
      PrivateKey: user.privateKey,
      SecurityStamp: user.securityStamp,
      ForcePasswordReset: false,
      UsesKeyConnector: false,
      VerifyDevices: false,
      Organizations: [],
      OrganizationsNew: [],
      Providers: [],
      ProviderOrganizations: [],
    },
    Folders: [],
    Collections: [],
    Ciphers: [],
    Domains: {
      EquivalentDomains: [],
      GlobalEquivalentDomains: [],
    },
    Policies: [],
    PoliciesNew: [],
    Sends: [],
    UserDecryption: null,
  }
}

function syncAuthError(
  requestIdValue: string,
  code: 'invalid_token' | 'missing_token',
  message: string,
) {
  return {
    error: {
      code,
      message,
    },
    requestId: requestIdValue,
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

async function readFormBody(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(await request.text())
}

function readBearerToken(authorization: string | undefined): string | null {
  const [scheme, token, extra] = (authorization ?? '').trim().split(/\s+/)

  if (scheme !== 'Bearer' || !token || extra) {
    return null
  }

  return token
}

function readDeviceInfo(headers: Headers): {
  identifier: string
  name: string | null
  type: number | null
} | null {
  const identifier = (
    headers.get('Device-Identifier') ??
    headers.get('X-Device-Identifier') ??
    ''
  ).trim()

  if (!identifier) {
    return null
  }

  const rawType = (headers.get('Device-Type') ?? '').trim()
  const type = rawType ? Number.parseInt(rawType, 10) : null

  return {
    identifier,
    name:
      headers.get('Device-Name')?.trim() ||
      headers.get('X-Device-Name')?.trim() ||
      null,
    type: Number.isFinite(type) ? type : null,
  }
}

export default app
