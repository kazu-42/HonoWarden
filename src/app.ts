import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'

import type { Bindings } from './bindings'
import {
  buildAuditEvent,
  isAuditLoggingEnabled,
  serializeAuditEvent,
} from './domain/audit'
import type { AuditEventName, AuditEventOutcome } from './domain/audit'
import {
  buildBootstrapUserRecord,
  isBootstrapEnabled,
  resolveBootstrapAccount,
  verifyBootstrapToken,
} from './domain/bootstrap'
import { normalizeEmail, resolvePrelogin } from './domain/prelogin'
import {
  buildAuthAttemptBucketKey,
  extractClientAddress,
  isAccountLocked,
  loginDefensePolicy,
} from './domain/login-defense'
import {
  buildRequestQuotaBucketKey,
  isGlobalRequestQuotaEnabled,
  isRequestQuotaExceeded,
  requestQuotaLimitForScope,
  requestQuotaPolicy,
  resolveRequestQuotaScope,
} from './domain/request-quota'
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
import type {
  AccessTokenSigningKey,
  AccessTokenSigner,
  AccessTokenVerifier,
} from './domain/tokens'
import { decryptTotpSecret, encryptTotpSecret } from './domain/totp-secret'
import { generateTotpSecret, totpPolicy, verifyTotpCode } from './domain/totp'
import { getDatabaseHealth } from './infra/db-health'
import { resolveRuntimeEnvironment } from './infra/environment'
import { buildServerConfig } from './protocol/config'
import {
  createCipherAttachment,
  deleteCipherAttachment,
  findCipherAttachment,
  listCipherAttachmentsByUser,
} from './repositories/attachment-repository'
import { persistAuditEvent } from './repositories/audit-event-repository'
import type { CipherAttachmentRecord } from './repositories/attachment-repository'
import {
  createCipher,
  findCipherById,
  listCiphersByUser,
  listCiphersByUserPage,
  permanentlyDeleteCipher,
  restoreCipher,
  softDeleteCipher,
  updateCipher,
} from './repositories/cipher-repository'
import type { CipherRecord } from './repositories/cipher-repository'
import {
  createFolder,
  deleteFolder,
  findFolderById,
  folderBelongsToUser,
  listFoldersByUser,
  listFoldersByUserPage,
  updateFolder,
} from './repositories/folder-repository'
import type { FolderRecord } from './repositories/folder-repository'
import {
  buildDeviceId,
  createPasswordGrantSession,
  findAuthFailureBucket,
  findAuthUserByEmail,
  findAuthUserById,
  findDeviceByIdentifier,
  findRefreshTokenSessionByHash,
  invalidateRefreshTokenSession,
  listDevicesByUser,
  knownActiveDeviceExists,
  recordAuthAttempt,
  recordFailedAuthBucket,
  recordFailedLogin,
  revokeOtherDeviceSessions,
  resetAuthFailureBucket,
  resetLoginDefenseState,
  revokeDeviceSession,
  rotateRefreshToken,
  updateDeviceKeys,
  updateDeviceMetadata,
} from './repositories/auth-repository'
import { recordRequestQuotaHit } from './repositories/request-quota-repository'
import type {
  AuthUserRecord,
  DeviceRecord,
} from './repositories/auth-repository'
import {
  consumeTotpChallenge,
  createTotpChallenge,
  disableTotpSetup,
  enableTotpSetup,
  findActiveTotpChallengeByHash,
  findTotpSetupByUserId,
  promotePendingTotpChange,
  recordAcceptedTotpStep,
  startPendingTotpChange,
  upsertPendingTotpSetup,
} from './repositories/totp-repository'
import { cleanupTransientAuthData } from './maintenance/retention-cleanup'
import {
  createBootstrapUser,
  getAccountRevisionDate,
  updateAccountProfile,
} from './repositories/user-repository'
import { serviceVersion } from './version'

type Variables = {
  requestId: string
}

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>

type ListResourceType = 'folder' | 'cipher'

type ListCursor = {
  revisionDate: string
  id: string
}

type ListPagination = {
  limit: number
  cursor: ListCursor | null
}

type AuditInput = {
  name: AuditEventName
  outcome: AuditEventOutcome
  actor?: {
    userId?: string | undefined
    deviceIdentifier?: string | undefined
  }
  target?: {
    type:
      | 'account'
      | 'attachment'
      | 'backup'
      | 'cipher'
      | 'device'
      | 'folder'
      | 'session'
    id?: string | undefined
  }
  context?: Record<string, string | number | boolean | null>
}

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

type AccessTokenRuntimeConfig =
  | {
      ok: true
      refreshTokenSecret: string
      signer: AccessTokenSigner
      verifier: AccessTokenVerifier
    }
  | {
      ok: false
    }

const serviceDescription =
  'A minimal, API-only encrypted vault sync server for Cloudflare Workers, built with Hono, D1, and R2.'

const upstreamClientHeaderPrefix = ['Bit', 'warden'].join('')
const accessTokenTtlSeconds = 3600
const refreshTokenTtlSeconds = 60 * 60 * 24 * 30
const totpChallengeTtlSeconds = 5 * 60
const recentPasswordAuthTtlSeconds = 5 * 60
const defaultListPageSize = 100
const maxListPageSize = 500

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
app.use('*', async (c, next) => {
  if (
    !isGlobalRequestQuotaEnabled(c.env?.HONOWARDEN_GLOBAL_REQUEST_QUOTA) ||
    isRequestQuotaBypass(c)
  ) {
    await next()
    return
  }

  const now = new Date().toISOString()
  const scope = resolveRequestQuotaScope(c.req.raw.headers)
  const bucketKey = await buildRequestQuotaBucketKey(
    scope,
    extractClientAddress(c.req.raw.headers),
  )

  try {
    const bucket = await recordRequestQuotaHit(c.env.DB, {
      bucketKey,
      scope,
      limit: requestQuotaLimitForScope(scope),
      windowSeconds: requestQuotaPolicy.windowSeconds,
      blockSeconds: requestQuotaPolicy.blockSeconds,
      now,
    })

    if (isRequestQuotaExceeded(bucket, now)) {
      c.header('Retry-After', String(requestQuotaPolicy.blockSeconds))

      return c.json(
        apiError(c.get('requestId'), 'rate_limited', 'Request quota exceeded.'),
        429,
      )
    }
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Request quota check failed.',
      ),
      503,
    )
  }

  await next()
})

function isExtensionOrigin(origin: string): boolean {
  return (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://') ||
    origin.startsWith('safari-web-extension://')
  )
}

function isRequestQuotaBypass(c: AppContext): boolean {
  if (c.req.method === 'OPTIONS') {
    return true
  }

  const pathname = new URL(c.req.url).pathname

  return pathname === '/health' || pathname === '/healthz'
}

async function emitAuditEvent(c: AppContext, input: AuditInput): Promise<void> {
  if (!isAuditLoggingEnabled(c.env?.HONOWARDEN_AUDIT_LOGS)) {
    return
  }

  const event = buildAuditEvent({
    ...input,
    requestId: c.get('requestId'),
    occurredAt: new Date().toISOString(),
  })

  console.info(serializeAuditEvent(event))

  await persistAuditEvent(c.env.DB, event)
}

async function emitTotpChangeAuditEvent(
  c: AppContext,
  auth: Extract<AuthenticatedVaultRequest, { ok: true }>,
  outcome: AuditEventOutcome,
  stage: 'start' | 'verify',
  context: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await emitAuditEvent(c, {
    name: 'totp.change',
    outcome,
    actor: {
      userId: auth.user.id,
      deviceIdentifier: auth.deviceIdentifier,
    },
    target: {
      type: 'account',
      id: auth.user.id,
    },
    context: {
      stage,
      ...context,
    },
  })
}

async function emitBackupExportAuditEvent(
  c: AppContext,
  auth: Extract<AuthenticatedVaultRequest, { ok: true }>,
  outcome: AuditEventOutcome,
  context: Record<string, string | number | boolean | null>,
): Promise<void> {
  await emitAuditEvent(c, {
    name: 'backup.export',
    outcome,
    actor: {
      userId: auth.user.id,
      deviceIdentifier: auth.deviceIdentifier,
    },
    target: {
      type: 'backup',
      id: auth.user.id,
    },
    context,
  })
}

async function emitVaultMutationAuditEvent(
  c: AppContext,
  auth: Extract<AuthenticatedVaultRequest, { ok: true }>,
  input: {
    name: AuditEventName
    outcome: AuditEventOutcome
    target: {
      type: 'attachment' | 'cipher' | 'folder'
      id?: string
    }
    context: Record<string, string | number | boolean | null>
  },
): Promise<void> {
  await emitAuditEvent(c, {
    name: input.name,
    outcome: input.outcome,
    actor: {
      userId: auth.user.id,
      deviceIdentifier: auth.deviceIdentifier,
    },
    target: input.target,
    context: input.context,
  })
}

function buildHealthResponse(requestIdValue: string, environment?: string) {
  return {
    status: 'ok',
    service: 'honowarden',
    version: serviceVersion,
    environment: resolveRuntimeEnvironment(environment),
    requestId: requestIdValue,
  }
}

app.get('/', (c) => {
  return c.json({
    name: 'HonoWarden',
    description: serviceDescription,
    status: 'pre-alpha',
    version: serviceVersion,
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

async function handlePrelogin(c: AppContext) {
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
}

app.post('/identity/accounts/prelogin', handlePrelogin)

app.post('/identity/accounts/prelogin/password', handlePrelogin)

app.get('/api/devices/knowndevice', async (c) => {
  const request = parseKnownDeviceRequest(c)
  if (!request.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Known-device headers are required.',
      ),
      400,
    )
  }

  try {
    const known = await knownActiveDeviceExists(c.env.DB, {
      emailNormalized: request.emailNormalized,
      identifier: request.identifier,
    })

    return c.json(known)
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Known-device lookup failed.',
      ),
      503,
    )
  }
})

app.get('/api/accounts/revision-date', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const revisionDate =
      (await getAccountRevisionDate(c.env.DB, auth.user.id)) ??
      auth.user.revisionDate

    return c.json(revisionDate)
  } catch {
    return c.json(
      {
        error: {
          code: 'database_unavailable',
          message: 'Account revision lookup failed.',
        },
        requestId: c.get('requestId'),
      },
      503,
    )
  }
})

app.get('/api/accounts/profile', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  return c.json(buildAccountProfileResponse(auth.user))
})
app.put('/api/accounts/profile', handleAccountProfileUpdate)
app.post('/api/accounts/profile', handleAccountProfileUpdate)

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

app.all('/api/organizations', unsupportedAlphaFeature)
app.all('/api/organizations/*', unsupportedAlphaFeature)
app.all('/api/sends', unsupportedAlphaFeature)
app.all('/api/sends/*', unsupportedAlphaFeature)
app.get('/api/collections', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  return c.json(buildEmptyListResponse())
})

app.get('/api/collections/:id', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  return c.json(
    apiError(
      c.get('requestId'),
      'collection_not_found',
      'Collection was not found.',
    ),
    404,
  )
})

app.all('/api/collections', unsupportedAlphaFeature)
app.all('/api/collections/*', unsupportedAlphaFeature)
app.all('/api/emergency-access', unsupportedAlphaFeature)
app.all('/api/emergency-access/*', unsupportedAlphaFeature)
app.all('/api/attachments', unsupportedAlphaFeature)
app.all('/api/attachments/*', unsupportedAlphaFeature)
app.post('/api/ciphers/:id/attachment', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const cipherId = c.req.param('id')
  if (!cipherId) {
    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'Cipher id is required.'),
      400,
    )
  }

  const upload = await parseAttachmentUploadRequest(c.req.raw)
  if (!upload.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Attachment payload is invalid.',
      ),
      400,
    )
  }

  const now = new Date().toISOString()
  const attachmentId = crypto.randomUUID()
  const objectKey = buildAttachmentObjectKey()

  try {
    const cipher = await findCipherById(c.env.DB, {
      id: cipherId,
      userId: auth.user.id,
    })

    if (!cipher || cipher.deletedAt) {
      return c.json(cipherNotFoundError(c.get('requestId')), 404)
    }

    await c.env.VAULT_OBJECTS.put(objectKey, upload.body, {
      httpMetadata: {
        contentType: upload.contentType,
      },
    })

    const attachment = await (async () => {
      try {
        return await createCipherAttachment(c.env.DB, {
          id: attachmentId,
          userId: auth.user.id,
          cipherId,
          objectKey,
          fileName: upload.fileName,
          attachmentKey: upload.attachmentKey,
          size: upload.size,
          contentType: upload.contentType,
          revisionDate: now,
          createdAt: now,
          updatedAt: now,
        })
      } catch {
        await c.env.VAULT_OBJECTS.delete(objectKey)
        throw new Error('attachment metadata create failed')
      }
    })()

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'attachment.create',
      outcome: 'success',
      target: {
        type: 'attachment',
        id: attachment.id,
      },
      context: {
        resultStatus: 'created',
        cipherId,
        size: attachment.size,
      },
    })

    return c.json(buildAttachmentResponse(attachment), 201)
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'storage_unavailable',
        'Attachment upload failed.',
      ),
      503,
    )
  }
})
app.get('/api/ciphers/:id/attachment/:attachmentId', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const attachment = await findCipherAttachment(c.env.DB, {
      id: c.req.param('attachmentId'),
      cipherId: c.req.param('id'),
      userId: auth.user.id,
    })

    if (!attachment) {
      return c.json(attachmentNotFoundError(c.get('requestId')), 404)
    }

    const object = await c.env.VAULT_OBJECTS.get(attachment.objectKey)
    if (!object?.body) {
      return c.json(
        apiError(
          c.get('requestId'),
          'storage_unavailable',
          'Attachment object was not found.',
        ),
        503,
      )
    }

    const headers = new Headers({
      'Content-Type': attachment.contentType ?? 'application/octet-stream',
      'X-HonoWarden-Attachment-Id': attachment.id,
    })

    return new Response(object.body, {
      status: 200,
      headers,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'storage_unavailable',
        'Attachment download failed.',
      ),
      503,
    )
  }
})
app.delete('/api/ciphers/:id/attachment/:attachmentId', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const cipherId = c.req.param('id')
  const attachmentId = c.req.param('attachmentId')

  try {
    const attachment = await findCipherAttachment(c.env.DB, {
      id: attachmentId,
      cipherId,
      userId: auth.user.id,
    })

    if (!attachment) {
      return c.json(attachmentNotFoundError(c.get('requestId')), 404)
    }

    await c.env.VAULT_OBJECTS.delete(attachment.objectKey)
    const result = await deleteCipherAttachment(c.env.DB, {
      id: attachmentId,
      cipherId,
      userId: auth.user.id,
    })

    if (result.status === 'not_found') {
      return c.json(attachmentNotFoundError(c.get('requestId')), 404)
    }

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'attachment.delete',
      outcome: 'success',
      target: {
        type: 'attachment',
        id: attachment.id,
      },
      context: {
        resultStatus: 'deleted',
        cipherId,
      },
    })

    return c.json({
      object: 'attachmentDeletion',
      id: attachment.id,
      cipherId: attachment.cipherId,
      revisionDate: new Date().toISOString(),
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'storage_unavailable',
        'Attachment delete failed.',
      ),
      503,
    )
  }
})
app.all('/api/ciphers/:id/attachment', unsupportedAlphaFeature)
app.all('/api/ciphers/:id/attachment/*', unsupportedAlphaFeature)
app.put('/api/devices/:id', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const deviceId = decodePathParam(c.req.param('id')).trim()
  if (!deviceId) {
    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'Device ID is required.'),
      400,
    )
  }

  const deviceRequest = parseDeviceMetadataUpdateRequestBody(
    await readJsonBody(c.req.raw),
  )
  if (!deviceRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Device payload is invalid.',
      ),
      400,
    )
  }

  try {
    const result = await updateDeviceMetadata(c.env.DB, {
      userId: auth.user.id,
      deviceId,
      name: deviceRequest.name,
      type: deviceRequest.type,
      updatedAt: new Date().toISOString(),
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

    return c.json(buildDeviceResponse(result.device))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Device update failed.',
      ),
      503,
    )
  }
})
app.patch('/api/devices/:id', unsupportedAlphaFeature)
app.put('/api/devices/:id/keys', handleDeviceKeysUpdate)
app.post('/api/devices/:id/keys', handleDeviceKeysUpdate)
app.patch('/api/devices/:id/keys', handleDeviceKeysUpdate)
app.put('/api/devices/:id/trust', handleDeviceKeysUpdate)
app.patch('/api/devices/:id/trust', handleDeviceKeysUpdate)

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

    await emitAuditEvent(c, {
      name: 'admin.bootstrap',
      outcome: 'success',
      target: {
        type: 'account',
        id: result.userId,
      },
    })

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
  const accessTokenConfig = resolveAccessTokenRuntimeConfig(c.env)
  if (!accessTokenConfig.ok) {
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
  const tokenSecret = accessTokenConfig.refreshTokenSecret

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
        await emitAuditEvent(c, {
          name: 'auth.refresh_reuse',
          outcome: 'failure',
          actor: {
            userId: session.userId,
            deviceIdentifier: session.deviceIdentifier,
          },
          target: {
            type: 'session',
            id: session.tokenId,
          },
          context: {
            reason: 'reuse_detected',
          },
        })

        return c.json(tokenErrorResponse(invalidGrantError()), 400)
      }

      const accessToken = await signAccessToken(accessTokenConfig.signer, {
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

  const device = readDeviceInfo(c.req.raw.headers) ?? grantDecision.grant.device
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
    await cleanupTransientAuthData(c.env.DB, now, {
      auditEvents: isAuditLoggingEnabled(c.env?.HONOWARDEN_AUDIT_LOGS),
    })

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
      await emitAuditEvent(c, {
        name: 'auth.password_grant',
        outcome: 'failure',
        actor: {
          userId: user?.id,
          deviceIdentifier: device.identifier,
        },
        context: {
          reason: user?.disabledAt ? 'user_disabled' : 'invalid_grant',
        },
      })

      const failure = await recordFailedAttempt({ accountBucket: true })

      return rejectAfterFailedAttempt(failure.ipFailureBucket.lockedUntil)
    }

    const recordAccountFailure = async () => {
      await emitAuditEvent(c, {
        name: 'auth.password_grant',
        outcome: 'failure',
        actor: {
          userId: user.id,
          deviceIdentifier: device.identifier,
        },
        context: {
          reason: 'invalid_grant',
        },
      })

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
      return await recordAccountFailure()
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
        return await recordAccountFailure()
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
        return await recordAccountFailure()
      }

      const challengeConsumed = await consumeTotpChallenge(c.env.DB, {
        challengeId: challenge.id,
        consumedAt: now,
      })

      if (!challengeConsumed) {
        return await recordAccountFailure()
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
        return await recordAccountFailure()
      }

      const stepRecorded = await recordAcceptedTotpStep(c.env.DB, {
        userId: user.id,
        acceptedStep: verification.timeStep,
        now,
      })

      if (!stepRecorded) {
        return await recordAccountFailure()
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

    const accessToken = await signAccessToken(accessTokenConfig.signer, {
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
    const [folders, ciphers, attachments] = await Promise.all([
      listFoldersByUser(c.env.DB, auth.user.id),
      listCiphersByUser(c.env.DB, auth.user.id),
      listCipherAttachmentsByUser(c.env.DB, auth.user.id),
    ])

    return c.json(buildSyncResponse(auth.user, folders, ciphers, attachments))
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

app.post('/api/accounts/export', async (c) => {
  const auth = await authenticateRecentPasswordRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const [folders, ciphers, attachments] = await Promise.all([
      listFoldersByUser(c.env.DB, auth.user.id),
      listCiphersByUser(c.env.DB, auth.user.id),
      listCipherAttachmentsByUser(c.env.DB, auth.user.id),
    ])
    const generatedAt = new Date().toISOString()

    await emitBackupExportAuditEvent(c, auth, 'success', {
      folderCount: folders.length,
      cipherCount: ciphers.length,
      attachmentCount: attachments.length,
      rawR2ObjectBodiesIncluded: false,
    })

    c.header('Cache-Control', 'no-store')
    c.header(
      'Content-Disposition',
      `attachment; filename="honowarden-export-${backupExportFilenameTimestamp(
        generatedAt,
      )}.json"`,
    )

    return c.json(
      buildBackupExportResponse({
        user: auth.user,
        folders,
        ciphers,
        attachments,
        generatedAt,
        requestId: c.get('requestId'),
      }),
    )
  } catch {
    await emitBackupExportAuditEvent(c, auth, 'failure', {
      reason: 'database_unavailable',
    })

    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Backup export failed.',
      ),
      503,
    )
  }
})

app.get('/api/policies', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  return c.json(buildEmptyListResponse())
})

app.get('/api/policies/new', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  return c.json(buildEmptyListResponse())
})

app.get('/api/domains', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  return c.json(buildDomainsResponse())
})

app.get('/api/settings/domains', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  return c.json(buildDomainsResponse())
})

app.get('/api/devices', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const devices = await listDevicesByUser(c.env.DB, auth.user.id)

    return c.json(buildDeviceListResponse(devices))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Device list failed.',
      ),
      503,
    )
  }
})

app.get('/api/devices/identifier/:identifier', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const identifier = decodePathParam(c.req.param('identifier')).trim()
  if (!identifier) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Device identifier is required.',
      ),
      400,
    )
  }

  try {
    const device = await findDeviceByIdentifier(c.env.DB, {
      userId: auth.user.id,
      identifier,
    })

    if (!device) {
      return c.json(
        apiError(
          c.get('requestId'),
          'device_not_found',
          'Device was not found.',
        ),
        404,
      )
    }

    return c.json(buildDeviceResponse(device))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Device lookup failed.',
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

  if (auth.user.totpEnabled) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'TOTP is already enabled.',
      ),
      400,
    )
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

app.post('/identity/accounts/totp/disable', async (c) => {
  const auth = await authenticateRecentPasswordRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  if (!auth.user.totpEnabled) {
    await emitAuditEvent(c, {
      name: 'totp.disable',
      outcome: 'failure',
      actor: {
        userId: auth.user.id,
        deviceIdentifier: auth.deviceIdentifier,
      },
      target: {
        type: 'account',
        id: auth.user.id,
      },
      context: {
        reason: 'not_enabled',
      },
    })

    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'TOTP setup not found.'),
      400,
    )
  }

  try {
    const disabled = await disableTotpSetup(c.env.DB, {
      userId: auth.user.id,
    })

    if (!disabled) {
      await emitAuditEvent(c, {
        name: 'totp.disable',
        outcome: 'failure',
        actor: {
          userId: auth.user.id,
          deviceIdentifier: auth.deviceIdentifier,
        },
        target: {
          type: 'account',
          id: auth.user.id,
        },
        context: {
          reason: 'not_found',
        },
      })

      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP setup not found.',
        ),
        400,
      )
    }

    await emitAuditEvent(c, {
      name: 'totp.disable',
      outcome: 'success',
      actor: {
        userId: auth.user.id,
        deviceIdentifier: auth.deviceIdentifier,
      },
      target: {
        type: 'account',
        id: auth.user.id,
      },
      context: {
        enabled: false,
      },
    })

    return c.json({
      object: 'totp',
      enabled: false,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'TOTP disable failed.',
      ),
      503,
    )
  }
})

app.post('/identity/accounts/totp/change', async (c) => {
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
        'TOTP change is not configured.',
      ),
      503,
    )
  }

  const request = parseTotpChangeRequestBody(await readJsonBody(c.req.raw))
  if (!request.ok) {
    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'TOTP code is required.'),
      400,
    )
  }

  if (!auth.user.totpEnabled) {
    await emitTotpChangeAuditEvent(c, auth, 'failure', 'start', {
      reason: 'not_enabled',
    })

    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'TOTP setup not found.'),
      400,
    )
  }

  const now = new Date()
  const nowIso = now.toISOString()

  try {
    const setup = await findTotpSetupByUserId(c.env.DB, auth.user.id)
    if (!setup?.enabled) {
      await emitTotpChangeAuditEvent(c, auth, 'failure', 'start', {
        reason: 'not_found',
      })

      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP setup not found.',
        ),
        400,
      )
    }

    const currentSecretBase32 = await decryptTotpSecret(
      totpSecret,
      setup.encryptedSecret,
    )
    if (!currentSecretBase32) {
      return c.json(
        apiError(
          c.get('requestId'),
          'server_misconfigured',
          'TOTP change is not configured.',
        ),
        503,
      )
    }

    const currentVerification = await verifyTotpCode({
      secretBase32: currentSecretBase32,
      code: request.currentCode,
      nowUnixSeconds: Math.floor(now.getTime() / 1000),
      lastAcceptedStep: setup.lastAcceptedStep,
    })

    if (!currentVerification.ok) {
      await emitTotpChangeAuditEvent(c, auth, 'failure', 'start', {
        reason: 'invalid_current_code',
      })

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
      acceptedStep: currentVerification.timeStep,
      now: nowIso,
    })
    if (!stepRecorded) {
      await emitTotpChangeAuditEvent(c, auth, 'failure', 'start', {
        reason: 'replayed_current_code',
      })

      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP code is invalid.',
        ),
        400,
      )
    }

    const nextSecret = generateTotpSecret()
    const started = await startPendingTotpChange(c.env.DB, {
      userId: auth.user.id,
      encryptedSecret: await encryptTotpSecret(totpSecret, nextSecret),
      now: nowIso,
    })

    if (!started) {
      await emitTotpChangeAuditEvent(c, auth, 'failure', 'start', {
        reason: 'not_found',
      })

      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP setup not found.',
        ),
        400,
      )
    }

    await emitTotpChangeAuditEvent(c, auth, 'success', 'start', {
      enabled: true,
      pendingVerification: true,
    })

    return c.json({
      object: 'totpChange',
      secret: nextSecret,
      uri: buildTotpUri(auth.user.emailNormalized, nextSecret),
      enabled: true,
      pendingVerification: true,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'TOTP change failed.',
      ),
      503,
    )
  }
})

app.post('/identity/accounts/totp/change/verify', async (c) => {
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
        'TOTP change is not configured.',
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
    if (!setup?.enabled || !setup.pendingEncryptedSecret) {
      await emitTotpChangeAuditEvent(c, auth, 'failure', 'verify', {
        reason: 'not_found',
      })

      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP change not found.',
        ),
        400,
      )
    }

    const pendingSecretBase32 = await decryptTotpSecret(
      totpSecret,
      setup.pendingEncryptedSecret,
    )
    if (!pendingSecretBase32) {
      return c.json(
        apiError(
          c.get('requestId'),
          'server_misconfigured',
          'TOTP change is not configured.',
        ),
        503,
      )
    }

    const verification = await verifyTotpCode({
      secretBase32: pendingSecretBase32,
      code: request.code,
      nowUnixSeconds: Math.floor(verifiedAt.getTime() / 1000),
      lastAcceptedStep: null,
    })

    if (!verification.ok) {
      await emitTotpChangeAuditEvent(c, auth, 'failure', 'verify', {
        reason: 'invalid_pending_code',
      })

      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP code is invalid.',
        ),
        400,
      )
    }

    const promoted = await promotePendingTotpChange(c.env.DB, {
      userId: auth.user.id,
      acceptedStep: verification.timeStep,
      verifiedAt: verifiedAtIso,
    })

    if (!promoted) {
      await emitTotpChangeAuditEvent(c, auth, 'failure', 'verify', {
        reason: 'not_found',
      })

      return c.json(
        apiError(
          c.get('requestId'),
          'invalid_request',
          'TOTP change not found.',
        ),
        400,
      )
    }

    await emitTotpChangeAuditEvent(c, auth, 'success', 'verify', {
      enabled: true,
    })

    return c.json({
      object: 'totp',
      enabled: true,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'TOTP change failed.',
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
      await emitAuditEvent(c, {
        name: 'device.revoke',
        outcome: 'failure',
        actor: {
          userId: auth.user.id,
          deviceIdentifier: auth.deviceIdentifier,
        },
        target: {
          type: 'device',
          id: targetDeviceId,
        },
        context: {
          reason: 'not_found',
        },
      })

      return c.json(
        apiError(
          c.get('requestId'),
          'device_not_found',
          'Device was not found.',
        ),
        404,
      )
    }

    await emitAuditEvent(c, {
      name: 'device.revoke',
      outcome: 'success',
      actor: {
        userId: auth.user.id,
        deviceIdentifier: auth.deviceIdentifier,
      },
      target: {
        type: 'device',
        id: result.deviceId,
      },
    })

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

app.post('/api/devices/revoke-all', async (c) => {
  const auth = await authenticateRecentPasswordRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const currentDeviceId = buildDeviceId(auth.user.id, auth.deviceIdentifier)
  const revokedAt = new Date().toISOString()

  try {
    const result = await revokeOtherDeviceSessions(c.env.DB, {
      userId: auth.user.id,
      currentDeviceId,
      revokedAt,
    })

    await emitAuditEvent(c, {
      name: 'session.revoke_all',
      outcome: 'success',
      actor: {
        userId: auth.user.id,
        deviceIdentifier: auth.deviceIdentifier,
      },
      target: {
        type: 'session',
        id: currentDeviceId,
      },
      context: {
        currentSessionRevoked: false,
      },
    })

    return c.json({
      object: 'sessionsRevoke',
      currentDeviceId: result.currentDeviceId,
      currentSessionRevoked: result.currentSessionRevoked,
      revokedDate: result.revokedAt,
      requestId: c.get('requestId'),
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Session revoke failed.',
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
    const folderId = crypto.randomUUID()
    const folder = await createFolder(c.env.DB, {
      id: folderId,
      userId: auth.user.id,
      name: folderRequest.name,
      revisionDate,
    })

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'folder.create',
      outcome: 'success',
      target: {
        type: 'folder',
        id: folder.id,
      },
      context: {
        resultStatus: 'created',
      },
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

app.get('/api/folders', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const pagination = parseListPagination(c, 'folder')
  if (!pagination.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'List pagination is invalid.',
      ),
      400,
    )
  }

  try {
    const page = await listFoldersByUserPage(c.env.DB, {
      userId: auth.user.id,
      ...pagination.value,
    })

    return c.json(
      buildFolderListResponse(
        page.items,
        buildContinuationToken('folder', page),
      ),
    )
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Folder list failed.',
      ),
      503,
    )
  }
})

app.get('/api/folders/:id', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const folder = await findFolderById(c.env.DB, {
      id: c.req.param('id'),
      userId: auth.user.id,
    })

    if (!folder) {
      return c.json(folderNotFoundError(c.get('requestId')), 404)
    }

    return c.json(buildFolderResponse(folder))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Folder lookup failed.',
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

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'folder.update',
      outcome: 'success',
      target: {
        type: 'folder',
        id: folder.folder.id,
      },
      context: {
        resultStatus: 'updated',
      },
    })

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

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'folder.delete',
      outcome: 'success',
      target: {
        type: 'folder',
        id: result.id,
      },
      context: {
        resultStatus: 'deleted',
      },
    })

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

    const cipherId = crypto.randomUUID()
    const cipher = await createCipher(c.env.DB, {
      id: cipherId,
      userId: auth.user.id,
      folderId: cipherRequest.cipher.folderId,
      type: cipherRequest.cipher.type,
      favorite: cipherRequest.cipher.favorite,
      encryptedJson: cipherRequest.cipher.encryptedJson,
      revisionDate: now,
      createdAt: now,
    })

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'cipher.create',
      outcome: 'success',
      target: {
        type: 'cipher',
        id: cipher.id,
      },
      context: {
        resultStatus: 'created',
        cipherType: cipher.type,
        favorite: cipher.favorite,
        hasFolder: cipher.folderId !== null,
      },
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

app.get('/api/ciphers', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const pagination = parseListPagination(c, 'cipher')
  if (!pagination.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'List pagination is invalid.',
      ),
      400,
    )
  }

  try {
    const [page, attachments] = await Promise.all([
      listCiphersByUserPage(c.env.DB, {
        userId: auth.user.id,
        ...pagination.value,
      }),
      listCipherAttachmentsByUser(c.env.DB, auth.user.id),
    ])

    return c.json(
      buildCipherListResponse(
        page.items,
        buildContinuationToken('cipher', page),
        buildAttachmentsByCipherId(attachments),
      ),
    )
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Cipher list failed.',
      ),
      503,
    )
  }
})

app.get('/api/ciphers/:id', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const [cipher, attachments] = await Promise.all([
      findCipherById(c.env.DB, {
        id: c.req.param('id'),
        userId: auth.user.id,
      }),
      listCipherAttachmentsByUser(c.env.DB, auth.user.id),
    ])

    if (!cipher) {
      return c.json(cipherNotFoundError(c.get('requestId')), 404)
    }

    return c.json(
      buildCipherResponse(
        cipher,
        buildAttachmentsByCipherId(attachments).get(cipher.id) ?? [],
      ),
    )
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Cipher lookup failed.',
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

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'cipher.update',
      outcome: 'success',
      target: {
        type: 'cipher',
        id: cipher.cipher.id,
      },
      context: {
        resultStatus: 'updated',
        cipherType: cipher.cipher.type,
        favorite: cipher.cipher.favorite,
        hasFolder: cipher.cipher.folderId !== null,
      },
    })

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

app.put('/api/ciphers/:id/delete', async (c) => {
  return trashCipherById(c)
})

app.delete('/api/ciphers/:id', async (c) => {
  return trashCipherById(c)
})

async function trashCipherById(c: AppContext) {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const cipherId = c.req.param('id')
  if (!cipherId) {
    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'Cipher id is required.'),
      400,
    )
  }

  const now = new Date().toISOString()

  try {
    const result = await softDeleteCipher(c.env.DB, {
      id: cipherId,
      userId: auth.user.id,
      deletedAt: now,
    })

    if (result.status === 'not_found') {
      return c.json(cipherNotFoundError(c.get('requestId')), 404)
    }

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'cipher.delete',
      outcome: 'success',
      target: {
        type: 'cipher',
        id: result.id,
      },
      context: {
        resultStatus: 'deleted',
      },
    })

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
}

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

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'cipher.restore',
      outcome: 'success',
      target: {
        type: 'cipher',
        id: result.id,
      },
      context: {
        resultStatus: 'restored',
      },
    })

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
  return permanentlyDeleteCipherById(c)
})

async function permanentlyDeleteCipherById(c: AppContext) {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const cipherId = c.req.param('id')
  if (!cipherId) {
    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'Cipher id is required.'),
      400,
    )
  }

  const now = new Date().toISOString()

  try {
    const result = await permanentlyDeleteCipher(c.env.DB, {
      id: cipherId,
      userId: auth.user.id,
      revisionDate: now,
    })

    if (result.status === 'not_found') {
      return c.json(cipherNotFoundError(c.get('requestId')), 404)
    }

    await emitVaultMutationAuditEvent(c, auth, {
      name: 'cipher.permanent_delete',
      outcome: 'success',
      target: {
        type: 'cipher',
        id: result.id,
      },
      context: {
        resultStatus: 'permanently_deleted',
      },
    })

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
}

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

function resolveAccessTokenRuntimeConfig(
  env: Bindings | undefined,
): AccessTokenRuntimeConfig {
  const refreshTokenSecret = normalizeSecret(env?.HONOWARDEN_TOKEN_SECRET)
  if (!refreshTokenSecret) {
    return { ok: false }
  }

  const activeKid = normalizeKeyId(env?.HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID)
  const activeSecret = normalizeSecret(
    env?.HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET,
  )
  const previousKeysRaw = normalizeOptionalString(
    env?.HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS,
  )

  if (!activeKid && !activeSecret && !previousKeysRaw) {
    return {
      ok: true,
      refreshTokenSecret,
      signer: refreshTokenSecret,
      verifier: refreshTokenSecret,
    }
  }

  if (!activeKid || !activeSecret) {
    return { ok: false }
  }

  const previousKeys = parsePreviousAccessTokenKeys(previousKeysRaw)
  if (!previousKeys.ok) {
    return { ok: false }
  }

  const activeKey = {
    id: activeKid,
    secret: activeSecret,
  }
  if (hasDuplicateAccessTokenKeyIds(activeKey, previousKeys.keys)) {
    return { ok: false }
  }

  return {
    ok: true,
    refreshTokenSecret,
    signer: activeKey,
    verifier: {
      active: activeKey,
      previous: previousKeys.keys,
      legacySecrets: [refreshTokenSecret],
    },
  }
}

function parsePreviousAccessTokenKeys(
  raw: string | null,
): { ok: true; keys: AccessTokenSigningKey[] } | { ok: false } {
  if (!raw) {
    return { ok: true, keys: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false }
  }

  const keys: AccessTokenSigningKey[] = []
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      return { ok: false }
    }

    const id = normalizeKeyId(entry.kid)
    const secret = normalizeSecret(entry.secret)
    if (!id || !secret) {
      return { ok: false }
    }

    keys.push({ id, secret })
  }

  return { ok: true, keys }
}

function hasDuplicateAccessTokenKeyIds(
  activeKey: AccessTokenSigningKey,
  previousKeys: readonly AccessTokenSigningKey[],
): boolean {
  const seenIds = new Set([activeKey.id])

  for (const key of previousKeys) {
    if (seenIds.has(key.id)) {
      return true
    }
    seenIds.add(key.id)
  }

  return false
}

function normalizeKeyId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeSecret(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function buildTokenResponse(
  user: AuthUserRecord,
  accessToken: string,
  refreshToken: string,
) {
  const accountKeys = buildAccountKeysResponse(user)
  const masterPasswordUnlock = buildMasterPasswordUnlockResponse(user)

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
    AccountKeys: accountKeys,
    ForcePasswordReset: false,
    TwoFactorToken: null,
    MasterPasswordPolicy: null,
    UserDecryptionOptions: masterPasswordUnlock
      ? {
          HasMasterPassword: true,
          MasterPasswordUnlock: masterPasswordUnlock,
        }
      : null,
    KeyConnectorUrl: null,
  }
}

function buildAccountKeysResponse(user: AuthUserRecord) {
  if (!user.publicKey || !user.privateKey) {
    return null
  }

  return {
    publicKeyEncryptionKeyPair: {
      publicKey: user.publicKey,
      wrappedPrivateKey: user.privateKey,
    },
  }
}

function buildMasterPasswordUnlockResponse(user: AuthUserRecord) {
  if (!user.userKey) {
    return null
  }

  return {
    Salt: user.emailNormalized,
    Kdf: {
      KdfType: user.kdfAlgorithm === 'pbkdf2-sha256' ? 0 : 0,
      Iterations: user.kdfIterations,
    },
    MasterKeyEncryptedUserKey: user.userKey,
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
  attachments: readonly CipherAttachmentRecord[] = [],
) {
  const masterPasswordUnlock = buildMasterPasswordUnlockResponse(user)
  const attachmentsByCipherId = buildAttachmentsByCipherId(attachments)

  return {
    object: 'sync',
    Profile: buildProfileResponse(user),
    Folders: folders.map(buildFolderResponse),
    Collections: [],
    Ciphers: ciphers.map((cipher) =>
      buildCipherResponse(cipher, attachmentsByCipherId.get(cipher.id) ?? []),
    ),
    Domains: buildDomainsResponse(),
    Policies: [],
    PoliciesNew: [],
    Sends: [],
    UserDecryption: masterPasswordUnlock
      ? {
          MasterPasswordUnlock: masterPasswordUnlock,
        }
      : null,
  }
}

function buildBackupExportResponse(input: {
  user: AuthUserRecord
  folders: readonly FolderRecord[]
  ciphers: readonly CipherRecord[]
  attachments: readonly CipherAttachmentRecord[]
  generatedAt: string
  requestId: string
}) {
  const attachmentsByCipherId = buildAttachmentsByCipherId(input.attachments)

  return {
    object: 'backupExport',
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    requestId: input.requestId,
    source: {
      service: 'honowarden',
      version: serviceVersion,
    },
    account: buildBackupAccountResponse(input.user),
    folders: input.folders.map(buildFolderResponse),
    ciphers: input.ciphers.map((cipher) =>
      buildCipherResponse(cipher, attachmentsByCipherId.get(cipher.id) ?? []),
    ),
    attachments: input.attachments.map(buildBackupAttachmentResponse),
    collections: [],
    sends: [],
    limits: {
      rawR2ObjectBodies: 'excluded',
      operatorBackupPath: 'pnpm backup:export',
    },
  }
}

function buildBackupAccountResponse(user: AuthUserRecord) {
  return {
    id: user.id,
    email: user.emailNormalized,
    name: user.displayName ?? user.emailNormalized,
    revisionDate: user.revisionDate,
    creationDate: user.createdAt,
    twoFactorEnabled: user.totpEnabled,
    key: user.userKey,
    publicKey: user.publicKey,
    privateKey: user.privateKey,
    kdf: {
      algorithm: user.kdfAlgorithm,
      iterations: user.kdfIterations,
      memory: user.kdfMemory,
      parallelism: user.kdfParallelism,
    },
  }
}

function buildEmptyListResponse() {
  return {
    object: 'list',
    data: [],
    continuationToken: null,
  }
}

function parseListPagination(
  c: AppContext,
  resourceType: ListResourceType,
): { ok: true; value: ListPagination } | { ok: false } {
  const rawPageSize = c.req.query('pageSize') ?? c.req.query('limit')
  const limit = rawPageSize ? parsePageSize(rawPageSize) : defaultListPageSize

  if (!limit) {
    return { ok: false }
  }

  const rawContinuationToken = c.req.query('continuationToken')
  if (!rawContinuationToken) {
    return {
      ok: true,
      value: {
        limit,
        cursor: null,
      },
    }
  }

  const cursor = decodeContinuationToken(rawContinuationToken, resourceType)
  if (!cursor) {
    return { ok: false }
  }

  return {
    ok: true,
    value: {
      limit,
      cursor,
    },
  }
}

function parsePageSize(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null
  }

  const pageSize = Number(value)
  if (!Number.isSafeInteger(pageSize) || pageSize > maxListPageSize) {
    return null
  }

  return pageSize
}

function buildContinuationToken(
  resourceType: ListResourceType,
  page: {
    items: readonly { id: string; revisionDate: string }[]
    hasMore: boolean
  },
): string | null {
  if (!page.hasMore) {
    return null
  }

  const lastItem = page.items.at(-1)
  if (!lastItem) {
    return null
  }

  return encodeBase64UrlUtf8(
    JSON.stringify({
      v: 1,
      type: resourceType,
      revisionDate: lastItem.revisionDate,
      id: lastItem.id,
    }),
  )
}

function decodeContinuationToken(
  value: string,
  resourceType: ListResourceType,
): ListCursor | null {
  const decoded = decodeBase64UrlUtf8(value)
  if (!decoded) {
    return null
  }

  try {
    const token = JSON.parse(decoded) as unknown
    if (!isContinuationToken(token, resourceType)) {
      return null
    }

    return {
      revisionDate: token.revisionDate,
      id: token.id,
    }
  } catch {
    return null
  }
}

function isContinuationToken(
  value: unknown,
  resourceType: ListResourceType,
): value is ListCursor & { v: 1; type: ListResourceType } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const token = value as Record<string, unknown>

  return (
    token.v === 1 &&
    token.type === resourceType &&
    typeof token.revisionDate === 'string' &&
    token.revisionDate.length > 0 &&
    !Number.isNaN(Date.parse(token.revisionDate)) &&
    typeof token.id === 'string' &&
    token.id.length > 0
  )
}

function encodeBase64UrlUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function buildDomainsResponse() {
  return {
    EquivalentDomains: [],
    GlobalEquivalentDomains: [],
  }
}

function buildAccountProfileResponse(user: AuthUserRecord) {
  const masterPasswordUnlock = buildMasterPasswordUnlockResponse(user)

  return {
    object: 'profile',
    ...buildProfileResponse(user),
    UserDecryptionOptions: masterPasswordUnlock
      ? {
          HasMasterPassword: true,
          MasterPasswordUnlock: masterPasswordUnlock,
        }
      : null,
    KeyConnectorUrl: null,
  }
}

function buildProfileResponse(user: AuthUserRecord) {
  return {
    Id: user.id,
    Name: user.displayName ?? user.emailNormalized,
    Email: user.emailNormalized,
    EmailVerified: true,
    Premium: false,
    PremiumFromOrganization: false,
    Culture: 'en-US',
    TwoFactorEnabled: user.totpEnabled,
    Key: user.userKey,
    AccountKeys: buildAccountKeysResponse(user),
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
  }
}

function buildDeviceListResponse(devices: readonly DeviceRecord[]) {
  return {
    object: 'list',
    data: devices.map(buildDeviceResponse),
    continuationToken: null,
  }
}

function buildFolderListResponse(
  folders: readonly FolderRecord[],
  continuationToken: string | null = null,
) {
  return {
    object: 'list',
    data: folders.map(buildFolderResponse),
    continuationToken,
  }
}

function buildCipherListResponse(
  ciphers: readonly CipherRecord[],
  continuationToken: string | null = null,
  attachmentsByCipherId: ReadonlyMap<
    string,
    readonly CipherAttachmentRecord[]
  > = new Map(),
) {
  return {
    object: 'list',
    data: ciphers.map((cipher) =>
      buildCipherResponse(cipher, attachmentsByCipherId.get(cipher.id) ?? []),
    ),
    continuationToken,
  }
}

function buildDeviceResponse(device: DeviceRecord) {
  return {
    object: 'device',
    id: device.id,
    userId: device.userId,
    name: device.name,
    identifier: device.identifier,
    type: device.type,
    creationDate: device.createdAt,
    revisionDate: device.updatedAt,
    isTrusted: isTrustedDevice(device),
    encryptedUserKey: device.encryptedUserKey,
    encryptedPublicKey: device.encryptedPublicKey,
    devicePendingAuthRequest: null,
    lastActivityDate: device.lastSeenAt ?? device.updatedAt,
  }
}

function isTrustedDevice(device: DeviceRecord): boolean {
  return Boolean(
    device.encryptedUserKey &&
    device.encryptedPublicKey &&
    device.encryptedPrivateKey,
  )
}

function buildCipherResponse(
  cipher: CipherRecord,
  attachments: readonly CipherAttachmentRecord[] = [],
) {
  const payload = normalizeCipherResponsePayload(
    parseStoredCipherPayload(cipher.encryptedJson),
    attachments,
  )

  return {
    ...payload,
    object: 'cipher',
    id: cipher.id,
    organizationId: null,
    folderId: cipher.folderId,
    type: cipher.type,
    favorite: cipher.favorite,
    edit: readBoolean(payload.edit, true),
    viewPassword: readBoolean(payload.viewPassword, true),
    organizationUseTotp: readBoolean(payload.organizationUseTotp, false),
    collectionIds: readStringArray(payload.collectionIds),
    permissions: normalizeCipherPermissions(payload.permissions),
    revisionDate: cipher.revisionDate,
    creationDate: cipher.createdAt,
    deletedDate: cipher.deletedAt ?? null,
  }
}

function normalizeCipherResponsePayload(
  payload: Record<string, unknown>,
  attachments: readonly CipherAttachmentRecord[],
): Record<string, unknown> {
  const normalized = { ...payload }

  if (
    Object.hasOwn(normalized, 'attachments') &&
    !Array.isArray(normalized.attachments)
  ) {
    normalized.attachments = []
  }
  if (
    Object.hasOwn(normalized, 'Attachments') &&
    !Array.isArray(normalized.Attachments)
  ) {
    normalized.Attachments = []
  }

  delete normalized.attachments2
  delete normalized.Attachments2
  delete normalized.Attachments
  normalized.attachments = attachments.map(buildAttachmentMetadataResponse)

  return normalized
}

function buildAttachmentsByCipherId(
  attachments: readonly CipherAttachmentRecord[],
): Map<string, CipherAttachmentRecord[]> {
  const grouped = new Map<string, CipherAttachmentRecord[]>()

  for (const attachment of attachments) {
    const group = grouped.get(attachment.cipherId) ?? []
    group.push(attachment)
    grouped.set(attachment.cipherId, group)
  }

  return grouped
}

function buildAttachmentResponse(attachment: CipherAttachmentRecord) {
  return {
    object: 'attachment',
    ...buildAttachmentMetadataResponse(attachment),
    cipherId: attachment.cipherId,
    revisionDate: attachment.revisionDate,
  }
}

function buildAttachmentMetadataResponse(attachment: CipherAttachmentRecord) {
  return {
    id: attachment.id,
    url: `/api/ciphers/${encodeURIComponent(
      attachment.cipherId,
    )}/attachment/${encodeURIComponent(attachment.id)}`,
    fileName: attachment.fileName,
    key: attachment.attachmentKey,
    size: attachment.size,
    sizeName: formatByteSize(attachment.size),
  }
}

function buildBackupAttachmentResponse(attachment: CipherAttachmentRecord) {
  return {
    id: attachment.id,
    cipherId: attachment.cipherId,
    fileName: attachment.fileName,
    key: attachment.attachmentKey,
    size: attachment.size,
    sizeName: formatByteSize(attachment.size),
    contentType: attachment.contentType,
    revisionDate: attachment.revisionDate,
    creationDate: attachment.createdAt,
  }
}

function formatByteSize(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function normalizeCipherPermissions(value: unknown) {
  if (!isPlainObject(value)) {
    return {
      delete: true,
      restore: true,
    }
  }

  return {
    delete: readBoolean(value.delete ?? value.Delete, true),
    restore: readBoolean(value.restore ?? value.Restore, true),
  }
}

function readBoolean(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
    | 'collection_not_found'
    | 'account_not_found'
    | 'attachment_not_found'
    | 'current_device_revoke_forbidden'
    | 'database_unavailable'
    | 'device_not_found'
    | 'folder_not_found'
    | 'invalid_request'
    | 'invalid_token'
    | 'missing_token'
    | 'rate_limited'
    | 'reauth_required'
    | 'revision_conflict'
    | 'server_misconfigured'
    | 'storage_unavailable',
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

function unsupportedAlphaFeature(c: AppContext) {
  return c.json(
    {
      error: {
        code: 'unsupported_feature',
        message:
          'This feature is intentionally not implemented in the alpha scope.',
      },
      requestId: c.get('requestId'),
    },
    501,
  )
}

async function handleDeviceKeysUpdate(c: AppContext) {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const deviceIdOrIdentifier = decodePathParam(c.req.param('id') ?? '').trim()
  if (!deviceIdOrIdentifier) {
    return c.json(
      apiError(c.get('requestId'), 'invalid_request', 'Device ID is required.'),
      400,
    )
  }

  const keyRequest = parseDeviceKeysUpdateRequestBody(
    await readJsonBody(c.req.raw),
  )
  if (!keyRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Device key payload is invalid.',
      ),
      400,
    )
  }

  try {
    const result = await updateDeviceKeys(c.env.DB, {
      userId: auth.user.id,
      deviceIdOrIdentifier,
      encryptedUserKey: keyRequest.encryptedUserKey,
      encryptedPublicKey: keyRequest.encryptedPublicKey,
      encryptedPrivateKey: keyRequest.encryptedPrivateKey,
      updatedAt: new Date().toISOString(),
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

    return c.json(buildDeviceResponse(result.device))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Device key update failed.',
      ),
      503,
    )
  }
}

async function handleAccountProfileUpdate(c: AppContext) {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const profileRequest = parseAccountProfileUpdateRequestBody(
    await readJsonBody(c.req.raw),
  )
  if (!profileRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Account profile payload is invalid.',
      ),
      400,
    )
  }

  try {
    const now = new Date().toISOString()
    const result = await updateAccountProfile(c.env.DB, {
      userId: auth.user.id,
      displayName: profileRequest.name,
      revisionDate: now,
      updatedAt: now,
    })

    if (result.status === 'not_found') {
      return c.json(
        apiError(
          c.get('requestId'),
          'account_not_found',
          'Account was not found.',
        ),
        404,
      )
    }

    return c.json(
      buildAccountProfileResponse({
        ...auth.user,
        displayName: result.displayName,
        revisionDate: result.revisionDate,
      }),
    )
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Account profile update failed.',
      ),
      503,
    )
  }
}

function cipherNotFoundError(requestIdValue: string) {
  return apiError(requestIdValue, 'cipher_not_found', 'Cipher was not found.')
}

function attachmentNotFoundError(requestIdValue: string) {
  return apiError(
    requestIdValue,
    'attachment_not_found',
    'Attachment was not found.',
  )
}

function folderNotFoundError(requestIdValue: string) {
  return apiError(requestIdValue, 'folder_not_found', 'Folder was not found.')
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
  const accessTokenConfig = resolveAccessTokenRuntimeConfig(c.env)
  if (!accessTokenConfig.ok) {
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

  const verification = await verifyAccessToken(
    accessTokenConfig.verifier,
    accessToken,
  )
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

async function parseAttachmentUploadRequest(request: Request): Promise<
  | {
      ok: true
      attachmentKey: string
      body: ArrayBuffer
      contentType: string
      fileName: string
      size: number
    }
  | { ok: false }
> {
  try {
    const form = await request.formData()
    const fileName = readFormString(form, 'fileName', 'FileName')
    const attachmentKey = readFormString(form, 'key', 'Key')
    const file = readFormBlob(form, 'file', 'data', 'attachment')

    if (!fileName || !attachmentKey || !file) {
      return { ok: false }
    }

    const body = await file.arrayBuffer()

    return {
      ok: true,
      attachmentKey,
      body,
      contentType: file.type || 'application/octet-stream',
      fileName,
      size: body.byteLength,
    }
  } catch {
    return { ok: false }
  }
}

function readFormString(
  form: FormData,
  ...fieldNames: string[]
): string | undefined {
  for (const fieldName of fieldNames) {
    const value = form.get(fieldName)
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  return undefined
}

function readFormBlob(
  form: FormData,
  ...fieldNames: string[]
): Blob | undefined {
  for (const fieldName of fieldNames) {
    const value = form.get(fieldName)
    if (value instanceof Blob) {
      return value
    }
  }

  return undefined
}

function buildAttachmentObjectKey(): string {
  return `attachments/${crypto.randomUUID()}`
}

function backupExportFilenameTimestamp(generatedAt: string): string {
  return generatedAt.replace(/[:.]/g, '-')
}

function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseKnownDeviceRequest(
  c: AppContext,
): { ok: true; emailNormalized: string; identifier: string } | { ok: false } {
  const encodedEmail = c.req.header('X-Request-Email')
  const identifier = c.req.header('X-Device-Identifier')?.trim()

  if (!encodedEmail || !identifier) {
    return { ok: false }
  }

  const email = decodeBase64UrlUtf8(encodedEmail)
  if (!email) {
    return { ok: false }
  }

  const emailNormalized = normalizeEmail(email)
  if (!emailNormalized) {
    return { ok: false }
  }

  return {
    ok: true,
    emailNormalized,
    identifier,
  }
}

function decodeBase64UrlUtf8(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    return null
  }

  try {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return new TextDecoder().decode(bytes)
  } catch {
    return null
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

function parseTotpChangeRequestBody(
  body: unknown,
): { ok: true; currentCode: string } | { ok: false } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false }
  }

  const payload = body as Record<string, unknown>
  const currentCode =
    parseRequiredString(payload.currentCode) ??
    parseRequiredString(payload.currentTotpCode) ??
    parseRequiredString(payload.code) ??
    parseRequiredString(payload.totpCode) ??
    parseRequiredString(payload.twoFactorCode)

  return currentCode ? { ok: true, currentCode } : { ok: false }
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

function parseDeviceMetadataUpdateRequestBody(
  body: unknown,
): { ok: true; name: string; type: number } | { ok: false } {
  if (!isPlainObject(body)) {
    return { ok: false }
  }

  const name = parseRequiredString(body.name) ?? parseRequiredString(body.Name)
  const typeValue = body.type ?? body.Type
  const type =
    typeof typeValue === 'number' &&
    Number.isInteger(typeValue) &&
    typeValue >= 0
      ? typeValue
      : null

  if (!name || type === null) {
    return { ok: false }
  }

  return {
    ok: true,
    name,
    type,
  }
}

function parseDeviceKeysUpdateRequestBody(body: unknown):
  | {
      ok: true
      encryptedUserKey: string
      encryptedPublicKey: string
      encryptedPrivateKey: string
    }
  | { ok: false } {
  if (!isPlainObject(body)) {
    return { ok: false }
  }

  const encryptedUserKey =
    parseRequiredString(body.encryptedUserKey) ??
    parseRequiredString(body.EncryptedUserKey)
  const encryptedPublicKey =
    parseRequiredString(body.encryptedPublicKey) ??
    parseRequiredString(body.EncryptedPublicKey)
  const encryptedPrivateKey =
    parseRequiredString(body.encryptedPrivateKey) ??
    parseRequiredString(body.EncryptedPrivateKey)

  if (!encryptedUserKey || !encryptedPublicKey || !encryptedPrivateKey) {
    return { ok: false }
  }

  return {
    ok: true,
    encryptedUserKey,
    encryptedPublicKey,
    encryptedPrivateKey,
  }
}

function parseAccountProfileUpdateRequestBody(
  body: unknown,
): { ok: true; name: string } | { ok: false } {
  if (!isPlainObject(body)) {
    return { ok: false }
  }

  const name = parseRequiredString(body.name) ?? parseRequiredString(body.Name)
  if (!name) {
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

  const payload = body as Record<string, unknown>
  const revisionDate = parseRequiredString(
    payload.revisionDate ?? payload.lastKnownRevisionDate,
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
