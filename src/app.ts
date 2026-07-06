import { Hono } from 'hono'
import type { Context } from 'hono'
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
  buildAuthAttemptBucketKey,
  extractClientAddress,
  isAccountLocked,
  loginDefensePolicy,
} from './domain/login-defense'
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
import { decryptTotpSecret, encryptTotpSecret } from './domain/totp-secret'
import { generateTotpSecret, totpPolicy, verifyTotpCode } from './domain/totp'
import { getDatabaseHealth } from './infra/db-health'
import { resolveRuntimeEnvironment } from './infra/environment'
import { buildServerConfig } from './protocol/config'
import {
  createCipher,
  listCiphersByUser,
  permanentlyDeleteCipher,
  restoreCipher,
  softDeleteCipher,
  updateCipher,
} from './repositories/cipher-repository'
import type { CipherRecord } from './repositories/cipher-repository'
import {
  createFolder,
  deleteFolder,
  folderBelongsToUser,
  listFoldersByUser,
  updateFolder,
} from './repositories/folder-repository'
import type { FolderRecord } from './repositories/folder-repository'
import {
  buildDeviceId,
  createPasswordGrantSession,
  findAuthFailureBucket,
  findAuthUserByEmail,
  findAuthUserById,
  findRefreshTokenSessionByHash,
  invalidateRefreshTokenSession,
  recordAuthAttempt,
  recordFailedAuthBucket,
  recordFailedLogin,
  resetAuthFailureBucket,
  resetLoginDefenseState,
  revokeDeviceSession,
  rotateRefreshToken,
} from './repositories/auth-repository'
import type { AuthUserRecord } from './repositories/auth-repository'
import {
  consumeTotpChallenge,
  createTotpChallenge,
  enableTotpSetup,
  findActiveTotpChallengeByHash,
  findTotpSetupByUserId,
  recordAcceptedTotpStep,
  upsertPendingTotpSetup,
} from './repositories/totp-repository'
import { createBootstrapUser } from './repositories/user-repository'

type Variables = {
  requestId: string
}

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>

type AuthenticatedVaultRequest =
  | {
      ok: true
      user: AuthUserRecord
      deviceIdentifier: string
      tokenIssuedAt: number
      authMethod: 'password' | 'refresh' | null
    }
  | {
      ok: false
      response: Response
    }

const serviceDescription =
  'A minimal, API-only encrypted vault sync server for Cloudflare Workers, built with Hono, D1, and R2.'

const upstreamClientHeaderPrefix = ['Bit', 'warden'].join('')
const accessTokenTtlSeconds = 3600
const refreshTokenTtlSeconds = 60 * 60 * 24 * 30
const totpChallengeTtlSeconds = 5 * 60
const recentPasswordAuthTtlSeconds = 5 * 60

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

function buildHealthResponse(requestIdValue: string, environment?: string) {
  return {
    status: 'ok',
    service: 'honowarden',
    version: '0.0.0-alpha',
    environment: resolveRuntimeEnvironment(environment),
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
  return c.json(buildHealthResponse(c.get('requestId'), c.env?.HONOWARDEN_ENV))
})

app.get('/healthz', (c) => {
  return c.json(buildHealthResponse(c.get('requestId'), c.env?.HONOWARDEN_ENV))
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
        authMethod: 'refresh',
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
    const issuedAt = Math.floor(Date.now() / 1000)
    const now = new Date(issuedAt * 1000).toISOString()
    const ipBucketKey = await buildAuthAttemptBucketKey(
      'ip',
      extractClientAddress(c.req.raw.headers),
    )
    const accountBucketKey = await buildAuthAttemptBucketKey(
      'account',
      grantDecision.grant.usernameNormalized,
    )
    const ipBucket = await findAuthFailureBucket(c.env.DB, ipBucketKey)
    const accountBucket = await findAuthFailureBucket(
      c.env.DB,
      accountBucketKey,
    )

    if (
      isAccountLocked({
        lockedUntil: ipBucket?.lockedUntil ?? null,
        now,
      })
    ) {
      c.header('Retry-After', String(loginDefensePolicy.ipRetryAfterSeconds))

      return c.json(tokenErrorResponse(invalidGrantError()), 429)
    }

    const rejectAfterFailedAttempt = (ipLockedUntil: string | null) => {
      if (
        isAccountLocked({
          lockedUntil: ipLockedUntil,
          now,
        })
      ) {
        c.header('Retry-After', String(loginDefensePolicy.ipRetryAfterSeconds))

        return c.json(tokenErrorResponse(invalidGrantError()), 429)
      }

      return c.json(tokenErrorResponse(invalidGrantError()), 400)
    }

    const recordFailedAttempt = async (options: { accountBucket: boolean }) => {
      await recordAuthAttempt(c.env.DB, {
        id: crypto.randomUUID(),
        bucketKey: ipBucketKey,
        subjectKey: accountBucketKey,
        successful: false,
        occurredAt: now,
      })

      const ipFailureBucket = await recordFailedAuthBucket(c.env.DB, {
        bucketKey: ipBucketKey,
        failureLimit: loginDefensePolicy.ipFailureLimit,
        failureWindowSeconds: loginDefensePolicy.ipFailureWindowSeconds,
        lockoutSeconds: loginDefensePolicy.ipRetryAfterSeconds,
        now,
      })
      const accountFailureBucket = options.accountBucket
        ? await recordFailedAuthBucket(c.env.DB, {
            bucketKey: accountBucketKey,
            failureLimit: loginDefensePolicy.accountFailureLimit,
            failureWindowSeconds:
              loginDefensePolicy.accountFailureWindowSeconds,
            lockoutSeconds: loginDefensePolicy.accountLockoutSeconds,
            now,
          })
        : null

      return {
        accountFailureBucket,
        ipFailureBucket,
      }
    }
    if (
      isAccountLocked({
        lockedUntil: accountBucket?.lockedUntil ?? null,
        now,
      })
    ) {
      const failure = await recordFailedAttempt({ accountBucket: false })

      return rejectAfterFailedAttempt(failure.ipFailureBucket.lockedUntil)
    }

    const user = await findAuthUserByEmail(
      c.env.DB,
      grantDecision.grant.usernameNormalized,
    )

    if (!user || user.disabledAt) {
      const failure = await recordFailedAttempt({ accountBucket: true })

      return rejectAfterFailedAttempt(failure.ipFailureBucket.lockedUntil)
    }

    const recordAccountFailure = async () => {
      const failure = await recordFailedAttempt({ accountBucket: true })
      const accountFailureBucket = failure.accountFailureBucket

      if (!accountFailureBucket) {
        throw new Error('Account failure bucket was not recorded.')
      }

      await recordFailedLogin(c.env.DB, {
        userId: user.id,
        failedCount: accountFailureBucket.failedCount,
        failedAt: accountFailureBucket.updatedAt,
        lockedUntil: accountFailureBucket.lockedUntil,
      })

      return rejectAfterFailedAttempt(failure.ipFailureBucket.lockedUntil)
    }

    if (
      isAccountLocked({
        lockedUntil: user.loginLockedUntil,
        now,
      })
    ) {
      const failure = await recordFailedAttempt({ accountBucket: false })

      return rejectAfterFailedAttempt(failure.ipFailureBucket.lockedUntil)
    }

    if (
      !verifyPresentedPasswordHash(
        user.masterPasswordHash,
        grantDecision.grant.password,
      )
    ) {
      return recordAccountFailure()
    }

    if (user.totpEnabled) {
      const totpSecret = c.env?.HONOWARDEN_TOTP_SECRET
      if (!totpSecret || !user.totpEncryptedSecret) {
        return c.json(
          apiError(
            c.get('requestId'),
            'server_misconfigured',
            'TOTP login is not configured.',
          ),
          503,
        )
      }

      if (
        !grantDecision.grant.twoFactorToken &&
        !grantDecision.grant.twoFactorCode
      ) {
        const challengeToken = await issueTotpChallenge(c.env.DB, {
          tokenSecret,
          userId: user.id,
          deviceIdentifier: device.identifier,
          issuedAt,
          now,
        })

        return c.json(totpChallengeResponse(challengeToken), 400)
      }

      if (
        !isTotpProvider(grantDecision.grant.twoFactorProvider) ||
        !grantDecision.grant.twoFactorToken ||
        !grantDecision.grant.twoFactorCode
      ) {
        return recordAccountFailure()
      }

      const challengeHash = await hashTotpChallengeToken(
        tokenSecret,
        grantDecision.grant.twoFactorToken,
      )
      const challenge = await findActiveTotpChallengeByHash(
        c.env.DB,
        challengeHash,
        now,
      )

      if (
        !challenge ||
        challenge.userId !== user.id ||
        challenge.deviceIdentifier !== device.identifier
      ) {
        return recordAccountFailure()
      }

      const challengeConsumed = await consumeTotpChallenge(c.env.DB, {
        challengeId: challenge.id,
        consumedAt: now,
      })

      if (!challengeConsumed) {
        return recordAccountFailure()
      }

      const secretBase32 = await decryptTotpSecret(
        totpSecret,
        user.totpEncryptedSecret,
      )

      if (!secretBase32) {
        return c.json(
          apiError(
            c.get('requestId'),
            'server_misconfigured',
            'TOTP login is not configured.',
          ),
          503,
        )
      }

      const verification = await verifyTotpCode({
        secretBase32,
        code: grantDecision.grant.twoFactorCode,
        nowUnixSeconds: issuedAt,
        lastAcceptedStep: user.totpLastAcceptedStep,
      })

      if (!verification.ok) {
        return recordAccountFailure()
      }

      const stepRecorded = await recordAcceptedTotpStep(c.env.DB, {
        userId: user.id,
        acceptedStep: verification.timeStep,
        now,
      })

      if (!stepRecorded) {
        return recordAccountFailure()
      }
    }

    const expiresAt = issuedAt + accessTokenTtlSeconds
    const refreshToken = generateRefreshToken()
    const refreshTokenHash = await hashRefreshToken(tokenSecret, refreshToken)

    await resetLoginDefenseState(c.env.DB, {
      userId: user.id,
      resetAt: now,
    })
    await resetAuthFailureBucket(c.env.DB, accountBucketKey)
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
      authMethod: 'password',
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
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const [folders, ciphers] = await Promise.all([
      listFoldersByUser(c.env.DB, auth.user.id),
      listCiphersByUser(c.env.DB, auth.user.id),
    ])

    return c.json(buildSyncResponse(auth.user, folders, ciphers))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Vault sync failed.',
      ),
      503,
    )
  }
})

app.post('/identity/accounts/totp/setup', async (c) => {
  const auth = await authenticateRecentPasswordRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const totpSecret = c.env?.HONOWARDEN_TOTP_SECRET
  if (!totpSecret) {
    return c.json(
      apiError(
        c.get('requestId'),
        'server_misconfigured',
        'TOTP setup is not configured.',
      ),
      503,
    )
  }

  const secret = generateTotpSecret()
  const now = new Date().toISOString()

  try {
    await upsertPendingTotpSetup(c.env.DB, {
      userId: auth.user.id,
      encryptedSecret: await encryptTotpSecret(totpSecret, secret),
      now,
    })

    return c.json({
      object: 'totpSetup',
      secret,
      uri: buildTotpUri(auth.user.emailNormalized, secret),
      enabled: false,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'TOTP setup failed.',
      ),
      503,
    )
  }
})

app.post('/identity/accounts/totp/setup/verify', async (c) => {
  const auth = await authenticateRecentPasswordRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const totpSecret = c.env?.HONOWARDEN_TOTP_SECRET
  if (!totpSecret) {
    return c.json(
      apiError(
        c.get('requestId'),
        'server_misconfigured',
        'TOTP setup is not configured.',
      ),
      503,
    )
  }

  const request = parseTotpVerifyRequestBody(await readJsonBody(c.req.raw))
  if (!request.ok) {
    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'TOTP code is required.'),
      400,
    )
  }

  const verifiedAt = new Date()
  const verifiedAtIso = verifiedAt.toISOString()

  try {
    const setup = await findTotpSetupByUserId(c.env.DB, auth.user.id)
    if (!setup) {
      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP setup not found.',
        ),
        400,
      )
    }

    const secretBase32 = await decryptTotpSecret(
      totpSecret,
      setup.encryptedSecret,
    )
    if (!secretBase32) {
      return c.json(
        apiError(
          c.get('requestId'),
          'server_misconfigured',
          'TOTP setup is not configured.',
        ),
        503,
      )
    }

    const verification = await verifyTotpCode({
      secretBase32,
      code: request.code,
      nowUnixSeconds: Math.floor(verifiedAt.getTime() / 1000),
      lastAcceptedStep: setup.lastAcceptedStep,
    })

    if (!verification.ok) {
      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP code is invalid.',
        ),
        400,
      )
    }

    const stepRecorded = await recordAcceptedTotpStep(c.env.DB, {
      userId: auth.user.id,
      acceptedStep: verification.timeStep,
      now: verifiedAtIso,
    })
    const enabled = stepRecorded
      ? await enableTotpSetup(c.env.DB, {
          userId: auth.user.id,
          verifiedAt: verifiedAtIso,
        })
      : false

    if (!enabled) {
      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP code is invalid.',
        ),
        400,
      )
    }

    return c.json({
      object: 'totp',
      enabled: true,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'TOTP setup failed.',
      ),
      503,
    )
  }
})

app.post('/api/devices/:id/revoke', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const targetDeviceId = decodePathParam(c.req.param('id')).trim()
  if (!targetDeviceId) {
    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'Device ID is required.'),
      400,
    )
  }

  const currentDeviceId = buildDeviceId(auth.user.id, auth.deviceIdentifier)
  if (targetDeviceId === currentDeviceId) {
    return c.json(
      apiError(
        c.get('requestId'),
        'current_device_revoke_forbidden',
        'The current device cannot be revoked by this route.',
      ),
      400,
    )
  }

  const revokedAt = new Date().toISOString()

  try {
    const result = await revokeDeviceSession(c.env.DB, {
      userId: auth.user.id,
      deviceId: targetDeviceId,
      revokedAt,
    })

    if (result.status === 'not_found') {
      return c.json(
        apiError(
          c.get('requestId'),
          'device_not_found',
          'Device was not found.',
        ),
        404,
      )
    }

    return c.json({
      object: 'deviceRevoke',
      id: result.deviceId,
      revokedDate: result.revokedAt,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Device revoke failed.',
      ),
      503,
    )
  }
})

app.post('/api/folders', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const folderRequest = parseFolderRequestBody(await readJsonBody(c.req.raw))
  if (!folderRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Folder name is required.',
      ),
      400,
    )
  }

  const revisionDate = new Date().toISOString()

  try {
    const folder = await createFolder(c.env.DB, {
      id: crypto.randomUUID(),
      userId: auth.user.id,
      name: folderRequest.name,
      revisionDate,
    })

    return c.json(buildFolderResponse(folder), 201)
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Folder create failed.',
      ),
      503,
    )
  }
})

app.put('/api/folders/:id', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const folderRequest = parseFolderUpdateRequestBody(
    await readJsonBody(c.req.raw),
  )
  if (!folderRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Folder name and revision date are required.',
      ),
      400,
    )
  }

  const revisionDate = new Date().toISOString()

  try {
    const folder = await updateFolder(c.env.DB, {
      id: c.req.param('id'),
      userId: auth.user.id,
      name: folderRequest.name,
      expectedRevisionDate: folderRequest.revisionDate,
      revisionDate,
    })

    if (folder.status === 'not_found') {
      return c.json(
        apiError(
          c.get('requestId'),
          'folder_not_found',
          'Folder was not found.',
        ),
        404,
      )
    }

    if (folder.status === 'conflict') {
      return c.json(revisionConflictError(c.get('requestId')), 409)
    }

    return c.json(buildFolderResponse(folder.folder))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Folder update failed.',
      ),
      503,
    )
  }
})

app.delete('/api/folders/:id', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const revisionDate = new Date().toISOString()

  try {
    const result = await deleteFolder(c.env.DB, {
      id: c.req.param('id'),
      userId: auth.user.id,
      revisionDate,
    })

    if (result.status === 'not_found') {
      return c.json(
        apiError(
          c.get('requestId'),
          'folder_not_found',
          'Folder was not found.',
        ),
        404,
      )
    }

    return c.json({
      object: 'folderDeletion',
      id: result.id,
      revisionDate: result.revisionDate,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Folder delete failed.',
      ),
      503,
    )
  }
})

app.post('/api/ciphers', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const cipherRequest = parseCipherCreateRequestBody(
    await readJsonBody(c.req.raw),
  )
  if (!cipherRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Cipher payload is invalid.',
      ),
      400,
    )
  }

  const now = new Date().toISOString()

  try {
    if (cipherRequest.cipher.folderId) {
      const folderExists = await folderBelongsToUser(c.env.DB, {
        folderId: cipherRequest.cipher.folderId,
        userId: auth.user.id,
      })

      if (!folderExists) {
        return c.json(
          apiError(
            c.get('requestId'),
            'cipher_folder_not_found',
            'Cipher folder was not found.',
          ),
          404,
        )
      }
    }

    const cipher = await createCipher(c.env.DB, {
      id: crypto.randomUUID(),
      userId: auth.user.id,
      folderId: cipherRequest.cipher.folderId,
      type: cipherRequest.cipher.type,
      favorite: cipherRequest.cipher.favorite,
      encryptedJson: cipherRequest.cipher.encryptedJson,
      revisionDate: now,
      createdAt: now,
    })

    return c.json(buildCipherResponse(cipher), 201)
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Cipher create failed.',
      ),
      503,
    )
  }
})

app.put('/api/ciphers/:id', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const cipherRequest = parseCipherUpdateRequestBody(
    await readJsonBody(c.req.raw),
  )
  if (!cipherRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Cipher payload is invalid.',
      ),
      400,
    )
  }

  const now = new Date().toISOString()

  try {
    if (cipherRequest.cipher.folderId) {
      const folderExists = await folderBelongsToUser(c.env.DB, {
        folderId: cipherRequest.cipher.folderId,
        userId: auth.user.id,
      })

      if (!folderExists) {
        return c.json(
          apiError(
            c.get('requestId'),
            'cipher_folder_not_found',
            'Cipher folder was not found.',
          ),
          404,
        )
      }
    }

    const cipher = await updateCipher(c.env.DB, {
      id: c.req.param('id'),
      userId: auth.user.id,
      folderId: cipherRequest.cipher.folderId,
      type: cipherRequest.cipher.type,
      favorite: cipherRequest.cipher.favorite,
      encryptedJson: cipherRequest.cipher.encryptedJson,
      expectedRevisionDate: cipherRequest.cipher.revisionDate,
      revisionDate: now,
      createdAt: now,
    })

    if (cipher.status === 'not_found') {
      return c.json(cipherNotFoundError(c.get('requestId')), 404)
    }

    if (cipher.status === 'conflict') {
      return c.json(revisionConflictError(c.get('requestId')), 409)
    }

    return c.json(buildCipherResponse(cipher.cipher))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Cipher update failed.',
      ),
      503,
    )
  }
})

app.delete('/api/ciphers/:id', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const now = new Date().toISOString()

  try {
    const result = await softDeleteCipher(c.env.DB, {
      id: c.req.param('id'),
      userId: auth.user.id,
      deletedAt: now,
    })

    if (result.status === 'not_found') {
      return c.json(cipherNotFoundError(c.get('requestId')), 404)
    }

    return c.json({
      object: 'cipher',
      id: result.id,
      revisionDate: result.revisionDate,
      deletedDate: result.deletedAt,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Cipher delete failed.',
      ),
      503,
    )
  }
})

app.put('/api/ciphers/:id/restore', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const now = new Date().toISOString()

  try {
    const result = await restoreCipher(c.env.DB, {
      id: c.req.param('id'),
      userId: auth.user.id,
      revisionDate: now,
    })

    if (result.status === 'not_found') {
      return c.json(cipherNotFoundError(c.get('requestId')), 404)
    }

    return c.json({
      object: 'cipher',
      id: result.id,
      revisionDate: result.revisionDate,
      deletedDate: null,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Cipher restore failed.',
      ),
      503,
    )
  }
})

app.delete('/api/ciphers/:id/delete', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const now = new Date().toISOString()

  try {
    const result = await permanentlyDeleteCipher(c.env.DB, {
      id: c.req.param('id'),
      userId: auth.user.id,
      revisionDate: now,
    })

    if (result.status === 'not_found') {
      return c.json(cipherNotFoundError(c.get('requestId')), 404)
    }

    return c.json({
      object: 'cipherDeletion',
      id: result.id,
      revisionDate: result.revisionDate,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Cipher delete failed.',
      ),
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

async function issueTotpChallenge(
  database: Pick<D1Database, 'prepare'>,
  input: {
    tokenSecret: string
    userId: string
    deviceIdentifier: string
    issuedAt: number
    now: string
  },
): Promise<string> {
  const challengeToken = generateRefreshToken()

  await createTotpChallenge(database, {
    id: crypto.randomUUID(),
    userId: input.userId,
    challengeHash: await hashTotpChallengeToken(
      input.tokenSecret,
      challengeToken,
    ),
    deviceIdentifier: input.deviceIdentifier,
    expiresAt: new Date(
      (input.issuedAt + totpChallengeTtlSeconds) * 1000,
    ).toISOString(),
    createdAt: input.now,
  })

  return challengeToken
}

async function hashTotpChallengeToken(
  tokenSecret: string,
  challengeToken: string,
): Promise<string> {
  return hashRefreshToken(tokenSecret, `totp:${challengeToken}`)
}

function totpChallengeResponse(challengeToken: string) {
  return {
    ...tokenErrorResponse({
      error: 'invalid_grant',
      errorModel: {
        Message: 'TOTP verification is required.',
        Object: 'error',
      },
    }),
    TwoFactorToken: challengeToken,
    TwoFactorProviders: [
      {
        type: 'totp',
      },
    ],
  }
}

function isTotpProvider(provider: string | null): boolean {
  return (
    provider === null ||
    provider === '0' ||
    provider === 'totp' ||
    provider === 'authenticator'
  )
}

function buildTotpUri(emailNormalized: string, secret: string): string {
  const label = encodeURIComponent(`HonoWarden:${emailNormalized}`)
  const params = new URLSearchParams({
    secret,
    issuer: 'HonoWarden',
    algorithm: 'SHA1',
    digits: String(totpPolicy.digits),
    period: String(totpPolicy.periodSeconds),
  })

  return `otpauth://totp/${label}?${params.toString()}`
}

function buildSyncResponse(
  user: AuthUserRecord,
  folders: readonly FolderRecord[] = [],
  ciphers: readonly CipherRecord[] = [],
) {
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
      TwoFactorEnabled: user.totpEnabled,
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
    Folders: folders.map(buildFolderResponse),
    Collections: [],
    Ciphers: ciphers.map(buildCipherResponse),
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

function buildCipherResponse(cipher: CipherRecord) {
  return {
    ...parseStoredCipherPayload(cipher.encryptedJson),
    object: 'cipher',
    id: cipher.id,
    organizationId: null,
    folderId: cipher.folderId,
    type: cipher.type,
    favorite: cipher.favorite,
    revisionDate: cipher.revisionDate,
    creationDate: cipher.createdAt,
    deletedDate: null,
  }
}

function buildFolderResponse(folder: FolderRecord) {
  return {
    object: 'folder',
    id: folder.id,
    name: folder.name,
    revisionDate: folder.revisionDate,
  }
}

function apiError(
  requestIdValue: string,
  code:
    | 'cipher_folder_not_found'
    | 'cipher_not_found'
    | 'current_device_revoke_forbidden'
    | 'database_unavailable'
    | 'device_not_found'
    | 'folder_not_found'
    | 'invalid_request'
    | 'invalid_token'
    | 'missing_token'
    | 'reauth_required'
    | 'revision_conflict'
    | 'server_misconfigured',
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

function cipherNotFoundError(requestIdValue: string) {
  return apiError(requestIdValue, 'cipher_not_found', 'Cipher was not found.')
}

function revisionConflictError(requestIdValue: string) {
  return apiError(
    requestIdValue,
    'revision_conflict',
    'The resource was modified by another client.',
  )
}

async function authenticateVaultRequest(
  c: AppContext,
): Promise<AuthenticatedVaultRequest> {
  const tokenSecret = c.env?.HONOWARDEN_TOKEN_SECRET
  if (!tokenSecret) {
    return {
      ok: false,
      response: c.json(
        apiError(
          c.get('requestId'),
          'server_misconfigured',
          'Vault sync is not configured.',
        ),
        503,
      ),
    }
  }

  const accessToken = readBearerToken(c.req.header('Authorization'))
  if (!accessToken) {
    return {
      ok: false,
      response: c.json(
        apiError(
          c.get('requestId'),
          'missing_token',
          'Bearer authorization is required.',
        ),
        401,
      ),
    }
  }

  const verification = await verifyAccessToken(tokenSecret, accessToken)
  if (!verification.ok) {
    return {
      ok: false,
      response: c.json(
        apiError(
          c.get('requestId'),
          'invalid_token',
          'The access token is invalid.',
        ),
        401,
      ),
    }
  }

  try {
    const user = await findAuthUserById(c.env.DB, verification.claims.sub)

    if (
      !user ||
      user.disabledAt ||
      user.securityStamp !== verification.claims.securityStamp
    ) {
      return {
        ok: false,
        response: c.json(
          apiError(
            c.get('requestId'),
            'invalid_token',
            'The access token is invalid.',
          ),
          401,
        ),
      }
    }

    return {
      ok: true,
      user,
      deviceIdentifier: verification.claims.device,
      tokenIssuedAt: verification.claims.iat,
      authMethod: verification.claims.authMethod ?? null,
    }
  } catch {
    return {
      ok: false,
      response: c.json(
        apiError(
          c.get('requestId'),
          'database_unavailable',
          'Vault request failed.',
        ),
        503,
      ),
    }
  }
}

async function authenticateRecentPasswordRequest(
  c: AppContext,
): Promise<AuthenticatedVaultRequest> {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const tokenAgeSeconds = nowSeconds - auth.tokenIssuedAt
  const recentPasswordAuth =
    auth.authMethod === 'password' &&
    tokenAgeSeconds >= 0 &&
    tokenAgeSeconds <= recentPasswordAuthTtlSeconds

  if (!recentPasswordAuth) {
    return {
      ok: false,
      response: c.json(
        apiError(
          c.get('requestId'),
          'reauth_required',
          'Recent password authentication is required.',
        ),
        401,
      ),
    }
  }

  return auth
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

function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseTotpVerifyRequestBody(
  body: unknown,
): { ok: true; code: string } | { ok: false } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false }
  }

  const payload = body as Record<string, unknown>
  const code =
    parseRequiredString(payload.code) ??
    parseRequiredString(payload.totpCode) ??
    parseRequiredString(payload.twoFactorCode)

  return code ? { ok: true, code } : { ok: false }
}

function parseFolderRequestBody(
  body: unknown,
): { ok: true; name: string } | { ok: false } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false }
  }

  const name = (body as Record<string, unknown>).name
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false }
  }

  return {
    ok: true,
    name,
  }
}

function parseFolderUpdateRequestBody(
  body: unknown,
): { ok: true; name: string; revisionDate: string } | { ok: false } {
  const folderRequest = parseFolderRequestBody(body)
  if (!folderRequest.ok) {
    return { ok: false }
  }

  const revisionDate = parseRequiredString(
    (body as Record<string, unknown>).revisionDate,
  )
  if (!revisionDate) {
    return { ok: false }
  }

  return {
    ok: true,
    name: folderRequest.name,
    revisionDate,
  }
}

function parseCipherCreateRequestBody(body: unknown):
  | {
      ok: true
      cipher: {
        encryptedJson: string
        favorite: boolean
        folderId: string | null
        type: 1 | 2
      }
    }
  | { ok: false } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false }
  }

  const payload = body as Record<string, unknown>
  if (payload.type !== 1 && payload.type !== 2) {
    return { ok: false }
  }

  const folderId = parseOptionalId(payload.folderId)
  if (folderId === undefined) {
    return { ok: false }
  }

  return {
    ok: true,
    cipher: {
      encryptedJson: JSON.stringify(payload),
      favorite:
        typeof payload.favorite === 'boolean' ? payload.favorite : false,
      folderId,
      type: payload.type,
    },
  }
}

function parseCipherUpdateRequestBody(body: unknown):
  | {
      ok: true
      cipher: {
        encryptedJson: string
        favorite: boolean
        folderId: string | null
        revisionDate: string
        type: 1 | 2
      }
    }
  | { ok: false } {
  const cipherRequest = parseCipherCreateRequestBody(body)
  if (!cipherRequest.ok) {
    return { ok: false }
  }

  const revisionDate = parseRequiredString(
    (body as Record<string, unknown>).revisionDate,
  )
  if (!revisionDate) {
    return { ok: false }
  }

  return {
    ok: true,
    cipher: {
      ...cipherRequest.cipher,
      revisionDate,
    },
  }
}

function parseRequiredString(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  return value
}

function parseOptionalId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  return value
}

function parseStoredCipherPayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown

    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }

  return {}
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
