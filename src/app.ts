import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'

import type { Bindings } from './bindings'
import {
  authRequestPolicy,
  authRequestQuotaPolicy,
  buildAuthRequestAccessCodeHash,
  buildAuthRequestDeviceHash,
  buildAuthRequestEmailHash,
  buildAuthRequestTimestamps,
  isAuthRequestFeatureEnabled,
  parseAuthRequestCreateBody,
  parseAuthRequestResponseBody,
  verifyAuthRequestAccessCode,
} from './domain/auth-request'
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
  parseAuthRequestGrantForm,
  parseRefreshTokenGrantForm,
  signAccessToken,
  tokenErrorResponse,
  tokenRequestError,
  verifyAccessToken,
  verifyPresentedPasswordHash,
} from './domain/tokens'
import type {
  AccessTokenAuthMethod,
  AccessTokenSigningKey,
  AccessTokenSigner,
  AccessTokenVerifier,
} from './domain/tokens'
import type { AuthRequestGrantRequest } from './domain/tokens'
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
import {
  approveAuthRequest,
  consumeAuthRequestWithSession,
  createAuthRequest,
  denyAuthRequest,
  findAuthRequestForOwner,
  findAuthRequestVerifierById,
  listPendingAuthRequests,
} from './repositories/auth-request-repository'
import type { AuthRequestRecord } from './repositories/auth-request-repository'
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
  getDomainSettingsForUser,
  updateDomainSettingsForUser,
} from './repositories/domain-settings-repository'
import type { DomainSettings } from './repositories/domain-settings-repository'
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
  updateTrustedDeviceKeys,
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
      | 'auth_request'
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
      authMethod: AccessTokenAuthMethod | null
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
const signalRHeartbeatIntervalMs = 15_000
const signalRRecordSeparator = '\u001e'

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

      const requestOrigin = resolvePublicOrigin(c.req.raw)
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

function resolvePublicOrigin(request: Request): string {
  const url = new URL(request.url)
  const scheme =
    readCloudflareVisitorScheme(request.headers.get('CF-Visitor')) ??
    readForwardedProto(request.headers.get('Forwarded')) ??
    readForwardedProto(request.headers.get('X-Forwarded-Proto')) ??
    normalizePublicScheme(url.protocol.replace(/:$/, ''))

  if (scheme) {
    url.protocol = `${scheme}:`
  }

  return url.origin
}

function readCloudflareVisitorScheme(
  headerValue: string | null,
): string | null {
  if (!headerValue) {
    return null
  }

  try {
    const parsed = JSON.parse(headerValue) as unknown
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return normalizePublicScheme((parsed as Record<string, unknown>).scheme)
    }
  } catch {
    return null
  }

  return null
}

function readForwardedProto(headerValue: string | null): string | null {
  if (!headerValue) {
    return null
  }

  const firstValue = headerValue.split(',')[0]?.trim()
  if (!firstValue) {
    return null
  }

  const protoMatch = /(?:^|;)\s*proto=([^;]+)/i.exec(firstValue)
  const rawProto = protoMatch?.[1]?.replace(/^"|"$/g, '') ?? firstValue

  return normalizePublicScheme(rawProto)
}

function normalizePublicScheme(value: unknown): 'http' | 'https' | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase().replace(/:$/, '')
  return normalized === 'http' || normalized === 'https' ? normalized : null
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
  const origin = resolvePublicOrigin(c.req.raw)

  return c.json(buildServerConfig(origin))
})

app.get('/config', (c) => {
  const origin = resolvePublicOrigin(c.req.raw)

  return c.json(buildServerConfig(origin))
})

app.get('/notifications/hub', async (c) => {
  if (!isWebSocketUpgrade(c.req.raw)) {
    c.header('Upgrade', 'websocket')

    return c.json(
      apiError(
        c.get('requestId'),
        'websocket_required',
        'Notification hub requires a WebSocket upgrade.',
      ),
      426,
    )
  }

  const auth = await authenticateVaultRequestWithAccessToken(
    c,
    readNotificationHubAccessToken(c),
  )
  if (!auth.ok) {
    return auth.response
  }

  if (typeof WebSocketPair === 'undefined') {
    return c.json(
      apiError(
        c.get('requestId'),
        'server_misconfigured',
        'Notification hub WebSocket runtime is unavailable.',
      ),
      503,
    )
  }

  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]

  acceptNotificationHubWebSocket(server)

  return new Response(null, {
    status: 101,
    webSocket: client,
  })
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

app.get('/api/account/billing/vnext/subscription', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  return c.json(buildBillingSubscriptionResponse())
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
app.post('/api/auth-requests', createAuthRequestRoute)
app.get('/api/auth-requests/pending', listPendingAuthRequestsRoute)
app.get('/api/auth-requests/:id/response', pollAuthRequestRoute)
app.get('/api/auth-requests/:id', readAuthRequestRoute)
app.put('/api/auth-requests/:id', respondToAuthRequestRoute)
app.all('/api/auth-requests', unsupportedAlphaFeature)
app.all('/api/auth-requests/*', unsupportedAlphaFeature)
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
app.post('/api/devices/update-trust', handleTrustedDevicesUpdate)

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

  const authRequestGrant = parseAuthRequestGrantForm(form)
  if (authRequestGrant.ok) {
    return handleAuthRequestTokenGrant(
      c,
      accessTokenConfig,
      authRequestGrant.grant,
    )
  }
  if (!('reason' in authRequestGrant)) {
    return c.json(
      tokenErrorResponse(authRequestGrant.error),
      authRequestGrant.status,
    )
  }

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

      const accessToken = await signAccessToken(
        accessTokenConfig.signer,
        buildAccessTokenClaims({
          user: session.user,
          deviceIdentifier: session.deviceIdentifier,
          issuedAt,
          expiresAt: issuedAt + accessTokenTtlSeconds,
          authMethod: 'refresh',
        }),
      )

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
        (!grantDecision.grant.twoFactorToken &&
          !grantDecision.grant.twoFactorCode)
      ) {
        return await recordAccountFailure()
      }

      let totpCode =
        grantDecision.grant.twoFactorCode ??
        grantDecision.grant.twoFactorToken ??
        null

      if (
        grantDecision.grant.twoFactorToken &&
        grantDecision.grant.twoFactorCode
      ) {
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

        totpCode = grantDecision.grant.twoFactorCode
      }

      if (!totpCode) {
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
        code: totpCode,
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

    const accessToken = await signAccessToken(
      accessTokenConfig.signer,
      buildAccessTokenClaims({
        user,
        deviceIdentifier: device.identifier,
        issuedAt,
        expiresAt,
        authMethod: 'password',
      }),
    )

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

async function handleAuthRequestTokenGrant(
  c: AppContext,
  accessTokenConfig: Extract<AccessTokenRuntimeConfig, { ok: true }>,
  grant: AuthRequestGrantRequest,
) {
  if (!isAuthRequestFeatureEnabled(c.env?.HONOWARDEN_AUTH_REQUESTS_ENABLED)) {
    return c.json(tokenErrorResponse(invalidGrantError()), 400)
  }

  const authRequestSecret = c.env?.HONOWARDEN_AUTH_REQUEST_SECRET
  if (
    !authRequestSecret ||
    new TextEncoder().encode(authRequestSecret).byteLength < 32
  ) {
    return c.json(
      apiError(
        c.get('requestId'),
        'server_misconfigured',
        'Auth requests are not configured.',
      ),
      503,
    )
  }

  const headerDevice = readDeviceInfo(c.req.raw.headers)
  const device = headerDevice ?? grant.device
  if (
    device.identifier !== grant.device.identifier ||
    device.identifier.length === 0 ||
    device.identifier.length > authRequestPolicy.maxDeviceIdentifierLength ||
    grant.authRequestId.length > 128 ||
    grant.accessCode.length < authRequestPolicy.minAccessCodeLength ||
    grant.accessCode.length > authRequestPolicy.maxAccessCodeLength
  ) {
    return c.json(tokenErrorResponse(invalidGrantError()), 400)
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  const now = new Date(issuedAt * 1000).toISOString()

  try {
    const networkQuotaResponse = await enforceAuthRequestQuotas(
      c,
      'auth.request_consume',
      [
        {
          value: `consume:network:${extractClientAddress(c.req.raw.headers)}`,
          limit: authRequestQuotaPolicy.consumeNetworkLimit,
        },
      ],
    )
    if (networkQuotaResponse) {
      return networkQuotaResponse
    }

    const request = await findAuthRequestVerifierById(
      c.env.DB,
      grant.authRequestId,
      now,
    )
    const accessCodeVerified =
      request &&
      (await verifyAuthRequestAccessCode(
        authRequestSecret,
        grant.authRequestId,
        grant.accessCode,
        request.accessCodeHash,
      ))

    if (
      !request ||
      !accessCodeVerified ||
      request.status !== 'approved' ||
      request.requestType !== 0 ||
      !request.userId ||
      request.requestDeviceIdentifier !== device.identifier
    ) {
      await emitAuthRequestConsumeFailure(c, grant.authRequestId)
      return c.json(tokenErrorResponse(invalidGrantError()), 400)
    }

    const deviceHash = await buildAuthRequestDeviceHash(
      authRequestSecret,
      device.identifier,
    )
    const ownerQuotaResponse = await enforceAuthRequestQuotas(
      c,
      'auth.request_consume',
      [
        {
          value: `consume:account:${request.emailHash}`,
          limit: authRequestQuotaPolicy.consumeAccountLimit,
        },
        {
          value: `consume:device:${deviceHash}`,
          limit: authRequestQuotaPolicy.consumeDeviceLimit,
        },
      ],
    )
    if (ownerQuotaResponse) {
      return ownerQuotaResponse
    }

    const user = await findAuthUserById(c.env.DB, request.userId)
    if (
      !user ||
      user.disabledAt ||
      user.emailNormalized !== grant.usernameNormalized
    ) {
      await emitAuthRequestConsumeFailure(c, grant.authRequestId)
      return c.json(tokenErrorResponse(invalidGrantError()), 400)
    }

    const refreshToken = generateRefreshToken()
    const refreshTokenHash = await hashRefreshToken(
      accessTokenConfig.refreshTokenSecret,
      refreshToken,
    )
    const refreshTokenId = crypto.randomUUID()
    const consume = await consumeAuthRequestWithSession(c.env.DB, {
      authRequestId: request.id,
      accessCodeHash: request.accessCodeHash,
      userId: user.id,
      requestDeviceIdentifier: device.identifier,
      deviceId: buildDeviceId(user.id, device.identifier),
      deviceName: device.name,
      deviceType: device.type,
      refreshTokenId,
      refreshTokenHash,
      refreshTokenExpiresAt: new Date(
        (issuedAt + refreshTokenTtlSeconds) * 1000,
      ).toISOString(),
      now,
    })

    if (consume.status !== 'consumed') {
      await emitAuthRequestConsumeFailure(c, grant.authRequestId)
      return c.json(tokenErrorResponse(invalidGrantError()), 400)
    }

    const accessToken = await signAccessToken(
      accessTokenConfig.signer,
      buildAccessTokenClaims({
        user,
        deviceIdentifier: device.identifier,
        issuedAt,
        expiresAt: issuedAt + accessTokenTtlSeconds,
        authMethod: 'auth_request',
      }),
    )

    await emitAuditEvent(c, {
      name: 'auth.request_consume',
      outcome: 'success',
      actor: {
        userId: user.id,
        deviceIdentifier: device.identifier,
      },
      target: { type: 'auth_request', id: request.id },
    })

    return c.json(buildTokenResponse(user, accessToken, refreshToken))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Token exchange failed.',
      ),
      503,
    )
  }
}

async function emitAuthRequestConsumeFailure(
  c: AppContext,
  authRequestId: string,
): Promise<void> {
  await emitAuditEvent(c, {
    name: 'auth.request_consume',
    outcome: 'failure',
    target: { type: 'auth_request', id: authRequestId },
    context: { reason: 'invalid_or_replayed' },
  })
}

app.get('/api/sync', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const [folders, ciphers, attachments, domainSettings] = await Promise.all([
      listFoldersByUser(c.env.DB, auth.user.id),
      listCiphersByUser(c.env.DB, auth.user.id),
      listCipherAttachmentsByUser(c.env.DB, auth.user.id),
      getDomainSettingsForUser(c.env.DB, auth.user.id),
    ])

    return c.json(
      buildSyncResponse(
        auth.user,
        folders,
        ciphers,
        attachments,
        domainSettings,
      ),
    )
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

  try {
    const domainSettings = await getDomainSettingsForUser(
      c.env.DB,
      auth.user.id,
    )

    return c.json(buildDomainsResponse(domainSettings))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Domain metadata lookup failed.',
      ),
      503,
    )
  }
})

app.get('/api/settings/domains', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const domainSettings = await getDomainSettingsForUser(
      c.env.DB,
      auth.user.id,
    )

    return c.json(buildDomainsResponse(domainSettings))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Domain settings lookup failed.',
      ),
      503,
    )
  }
})

app.post('/api/settings/domains', updateDomainSettingsRoute)
app.put('/api/settings/domains', updateDomainSettingsRoute)

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

app.put('/api/devices/identifier/:identifier/token', async (c) => {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const request = parsePushTokenRequestBody(await readJsonBody(c.req.raw))
  if (!request.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Push token payload is invalid.',
      ),
      400,
    )
  }

  return c.body(null, 204)
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
  const userDecryptionOptions = masterPasswordUnlock
    ? {
        HasMasterPassword: true,
        hasMasterPassword: true,
        MasterPasswordUnlock: masterPasswordUnlock,
        masterPasswordUnlock,
        TrustedDeviceOption: null,
        trustedDeviceOption: null,
        KeyConnectorOption: null,
        keyConnectorOption: null,
      }
    : null

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
    UserDecryptionOptions: userDecryptionOptions,
    KeyConnectorUrl: null,
  }
}

function buildAccessTokenClaims(input: {
  user: AuthUserRecord
  deviceIdentifier: string
  issuedAt: number
  expiresAt: number
  authMethod: AccessTokenAuthMethod
}) {
  return {
    sub: input.user.id,
    email: input.user.emailNormalized,
    email_verified: true,
    name: input.user.displayName,
    premium: false,
    amr: ['Application'],
    device: input.deviceIdentifier,
    securityStamp: input.user.securityStamp,
    sstamp: input.user.securityStamp,
    iat: input.issuedAt,
    exp: input.expiresAt,
    authMethod: input.authMethod,
  }
}

function buildAccountKeysResponse(user: AuthUserRecord) {
  if (!user.publicKey || !user.privateKey) {
    return null
  }

  return {
    signatureKeyPair: null,
    publicKeyEncryptionKeyPair: {
      publicKey: user.publicKey,
      wrappedPrivateKey: user.privateKey,
      signedPublicKey: null,
    },
    securityState: null,
  }
}

function buildMasterPasswordUnlockResponse(user: AuthUserRecord) {
  if (!user.userKey) {
    return null
  }

  return {
    Salt: user.emailNormalized,
    salt: user.emailNormalized,
    Kdf: {
      KdfType: user.kdfAlgorithm === 'pbkdf2-sha256' ? 0 : 0,
      kdfType: user.kdfAlgorithm === 'pbkdf2-sha256' ? 0 : 0,
      Iterations: user.kdfIterations,
      iterations: user.kdfIterations,
      Memory: user.kdfMemory,
      memory: user.kdfMemory,
      Parallelism: user.kdfParallelism,
      parallelism: user.kdfParallelism,
    },
    kdf: {
      KdfType: user.kdfAlgorithm === 'pbkdf2-sha256' ? 0 : 0,
      kdfType: user.kdfAlgorithm === 'pbkdf2-sha256' ? 0 : 0,
      Iterations: user.kdfIterations,
      iterations: user.kdfIterations,
      Memory: user.kdfMemory,
      memory: user.kdfMemory,
      Parallelism: user.kdfParallelism,
      parallelism: user.kdfParallelism,
    },
    MasterKeyEncryptedUserKey: user.userKey,
    masterKeyEncryptedUserKey: user.userKey,
    masterKeyWrappedUserKey: user.userKey,
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
  domainSettings: DomainSettings = emptyDomainSettings,
) {
  const attachmentsByCipherId = buildAttachmentsByCipherId(attachments)
  const profile = buildSyncProfileResponse(user)
  const folderResponses = folders.map(buildFolderResponse)
  const cipherResponses = ciphers.map((cipher) =>
    buildCipherResponse(cipher, attachmentsByCipherId.get(cipher.id) ?? []),
  )
  const domains = buildSyncDomainsResponse(domainSettings)
  const userDecryption = buildSyncUserDecryptionResponse(user)

  return {
    object: 'sync',
    profile,
    folders: folderResponses,
    collections: [],
    ciphers: cipherResponses,
    domains,
    policies: [],
    policiesNew: [],
    sends: [],
    userDecryption,
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
    revisionDate: normalizeApiTimestamp(user.revisionDate),
    creationDate: normalizeApiTimestamp(user.createdAt),
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

const emptyDomainSettings: DomainSettings = {
  equivalentDomains: [],
  excludedGlobalEquivalentDomains: [],
}

function buildDomainsResponse(settings: DomainSettings = emptyDomainSettings) {
  return {
    equivalentDomains: settings.equivalentDomains,
    globalEquivalentDomains: [],
    EquivalentDomains: settings.equivalentDomains,
    GlobalEquivalentDomains: [],
  }
}

function buildSyncDomainsResponse(
  settings: DomainSettings = emptyDomainSettings,
) {
  return {
    equivalentDomains: settings.equivalentDomains,
    globalEquivalentDomains: [],
  }
}

function buildSyncUserDecryptionResponse(user: AuthUserRecord) {
  const masterPasswordUnlock = buildSyncMasterPasswordUnlockResponse(user)

  return masterPasswordUnlock
    ? {
        masterPasswordUnlock,
      }
    : null
}

function buildSyncMasterPasswordUnlockResponse(user: AuthUserRecord) {
  if (!user.userKey) {
    return null
  }

  return {
    salt: user.emailNormalized,
    kdf: {
      kdfType: user.kdfAlgorithm === 'pbkdf2-sha256' ? 0 : 0,
      iterations: user.kdfIterations,
      memory: user.kdfMemory,
      parallelism: user.kdfParallelism,
    },
    masterKeyWrappedUserKey: user.userKey,
  }
}

function buildAccountProfileResponse(user: AuthUserRecord) {
  const masterPasswordUnlock = buildMasterPasswordUnlockResponse(user)
  const userDecryptionOptions = masterPasswordUnlock
    ? {
        HasMasterPassword: true,
        hasMasterPassword: true,
        MasterPasswordUnlock: masterPasswordUnlock,
        masterPasswordUnlock,
        TrustedDeviceOption: null,
        trustedDeviceOption: null,
        KeyConnectorOption: null,
        keyConnectorOption: null,
      }
    : null

  return {
    object: 'profile',
    ...buildProfileResponse(user),
    UserDecryptionOptions: userDecryptionOptions,
    userDecryptionOptions,
    KeyConnectorUrl: null,
    keyConnectorUrl: null,
  }
}

function buildBillingSubscriptionResponse() {
  return {
    status: 'canceled',
    cart: {
      passwordManager: {
        seats: {
          translationKey: 'premiumMembership',
          quantity: 0,
          cost: 0,
          discount: null,
        },
        additionalStorage: null,
      },
      secretsManager: null,
      cadence: 'annually',
      discount: null,
      estimatedTax: 0,
    },
    storage: null,
    cancelAt: null,
    canceled: null,
    nextCharge: null,
    suspension: null,
    gracePeriod: null,
  }
}

function buildSyncProfileResponse(user: AuthUserRecord) {
  const name = user.displayName ?? user.emailNormalized
  const accountKeys = buildAccountKeysResponse(user)

  return {
    providerOrganizations: [],
    premiumFromOrganization: false,
    forcePasswordReset: false,
    avatarColor: '#3366cc',
    emailVerified: true,
    twoFactorEnabled: user.totpEnabled,
    privateKey: user.privateKey,
    accountKeys,
    premium: false,
    culture: 'en-US',
    name,
    organizations: [],
    organizationsNew: [],
    usesKeyConnector: false,
    id: user.id,
    masterPasswordHint: null,
    email: user.emailNormalized,
    key: user.userKey,
    securityStamp: user.securityStamp,
    providers: [],
    creationDate: normalizeApiTimestamp(user.createdAt),
  }
}

function buildProfileResponse(user: AuthUserRecord) {
  const name = user.displayName ?? user.emailNormalized
  const accountKeys = buildAccountKeysResponse(user)

  return {
    providerOrganizations: [],
    premiumFromOrganization: false,
    forcePasswordReset: false,
    avatarColor: '#3366cc',
    emailVerified: true,
    twoFactorEnabled: user.totpEnabled,
    privateKey: user.privateKey,
    accountKeys,
    premium: false,
    culture: 'en-US',
    name,
    organizations: [],
    organizationsNew: [],
    usesKeyConnector: false,
    id: user.id,
    masterPasswordHint: null,
    email: user.emailNormalized,
    key: user.userKey,
    securityStamp: user.securityStamp,
    providers: [],
    creationDate: normalizeApiTimestamp(user.createdAt),
    Id: user.id,
    Name: name,
    Email: user.emailNormalized,
    EmailVerified: true,
    Premium: false,
    PremiumFromOrganization: false,
    Culture: 'en-US',
    TwoFactorEnabled: user.totpEnabled,
    Key: user.userKey,
    AccountKeys: accountKeys,
    AvatarColor: '#3366cc',
    CreationDate: normalizeApiTimestamp(user.createdAt),
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
    creationDate: normalizeApiTimestamp(device.createdAt),
    revisionDate: normalizeApiTimestamp(device.updatedAt),
    isTrusted: isTrustedDevice(device),
    encryptedUserKey: device.encryptedUserKey,
    encryptedPublicKey: device.encryptedPublicKey,
    devicePendingAuthRequest: null,
    lastActivityDate: normalizeApiTimestamp(
      device.lastSeenAt ?? device.updatedAt,
    ),
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
    revisionDate: normalizeApiTimestamp(cipher.revisionDate),
    creationDate: normalizeApiTimestamp(cipher.createdAt),
    deletedDate: normalizeNullableApiTimestamp(cipher.deletedAt),
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
    revisionDate: normalizeApiTimestamp(attachment.revisionDate),
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
    revisionDate: normalizeApiTimestamp(attachment.revisionDate),
    creationDate: normalizeApiTimestamp(attachment.createdAt),
  }
}

function normalizeNullableApiTimestamp(
  value: string | null | undefined,
): string | null {
  return value ? normalizeApiTimestamp(value) : null
}

function normalizeApiTimestamp(value: string): string {
  const sqliteTimestamp = value.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/,
  )
  const candidate = sqliteTimestamp
    ? `${sqliteTimestamp[1]}T${sqliteTimestamp[2]}${sqliteTimestamp[3] ?? ''}Z`
    : value
  const timestamp = Date.parse(candidate)

  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString()
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
    revisionDate: normalizeApiTimestamp(folder.revisionDate),
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
    | 'auth_request_conflict'
    | 'auth_request_not_found'
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
    | 'storage_unavailable'
    | 'websocket_required',
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

async function updateDomainSettingsRoute(c: AppContext) {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const domainSettingsRequest = parseDomainSettingsRequestBody(
    await readJsonBody(c.req.raw),
  )
  if (!domainSettingsRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Equivalent domain settings are invalid.',
      ),
      400,
    )
  }

  const revisionDate = new Date().toISOString()

  try {
    const result = await updateDomainSettingsForUser(c.env.DB, {
      userId: auth.user.id,
      equivalentDomains: domainSettingsRequest.equivalentDomains,
      excludedGlobalEquivalentDomains:
        domainSettingsRequest.excludedGlobalEquivalentDomains,
      revisionDate,
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

    return c.json(buildDomainsResponse(result.settings))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Domain settings update failed.',
      ),
      503,
    )
  }
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

async function handleTrustedDevicesUpdate(c: AppContext) {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const trustRequest = parseTrustedDeviceUpdateRequestBody(
    await readJsonBody(c.req.raw),
  )
  if (!trustRequest.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Device trust payload is invalid.',
      ),
      400,
    )
  }

  try {
    const result = await updateTrustedDeviceKeys(c.env.DB, {
      userId: auth.user.id,
      devices: trustRequest.devices,
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

    return c.json(buildDeviceListResponse(result.devices))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Device trust update failed.',
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

async function createAuthRequestRoute(c: AppContext) {
  const runtime = resolveAuthRequestRuntime(c)
  if (!runtime.ok) {
    return runtime.response
  }

  const headerDevice = readDeviceInfo(c.req.raw.headers)
  const request = parseAuthRequestCreateBody(
    await readJsonBody(c.req.raw),
    headerDevice?.type ?? null,
  )
  if (!request.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Auth request payload is invalid.',
      ),
      400,
    )
  }

  if (
    headerDevice &&
    headerDevice.identifier !== request.value.requestDeviceIdentifier
  ) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Auth request device identifiers do not match.',
      ),
      400,
    )
  }

  const id = crypto.randomUUID()
  const timestamps = buildAuthRequestTimestamps(new Date().toISOString())

  try {
    const emailHash = await buildAuthRequestEmailHash(
      runtime.secret,
      request.value.emailNormalized,
    )
    const deviceHash = await buildAuthRequestDeviceHash(
      runtime.secret,
      request.value.requestDeviceIdentifier,
    )
    const quotaResponse = await enforceAuthRequestQuotas(
      c,
      'auth.request_create',
      [
        {
          value: `create:account:${emailHash}`,
          limit: authRequestQuotaPolicy.createAccountLimit,
        },
        {
          value: `create:device:${deviceHash}`,
          limit: authRequestQuotaPolicy.createDeviceLimit,
        },
        {
          value: `create:network:${extractClientAddress(c.req.raw.headers)}`,
          limit: authRequestQuotaPolicy.createNetworkLimit,
        },
      ],
    )
    if (quotaResponse) {
      return quotaResponse
    }

    const user = await findAuthUserByEmail(
      c.env.DB,
      request.value.emailNormalized,
    )
    const owner = user && !user.disabledAt ? user : null

    const persistedRequest = {
      id,
      userId: owner?.id ?? null,
      emailHash,
      requestType: request.value.requestType,
      requestDeviceIdentifier: request.value.requestDeviceIdentifier,
      requestDeviceType: request.value.requestDeviceType,
      requestPublicKey: request.value.requestPublicKey,
      accessCodeHash: await buildAuthRequestAccessCodeHash(
        runtime.secret,
        id,
        request.value.accessCode,
      ),
      ...timestamps,
    }
    await createAuthRequest(c.env.DB, persistedRequest)

    await emitAuditEvent(c, {
      name: 'auth.request_create',
      outcome: 'success',
      target: { type: 'auth_request', id },
    })

    return c.json(
      buildAuthRequestResponse({
        ...persistedRequest,
        status: 'pending',
        requestApproved: null,
        approvingDeviceIdentifier: null,
        encryptedResponseKey: null,
        responseAt: null,
        consumedAt: null,
      }),
    )
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Auth request creation failed.',
      ),
      503,
    )
  }
}

async function listPendingAuthRequestsRoute(c: AppContext) {
  const runtime = resolveAuthRequestRuntime(c)
  if (!runtime.ok) {
    return runtime.response
  }

  const auth = await authenticateActiveDeviceRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const requests = await listPendingAuthRequests(
      c.env.DB,
      auth.user.id,
      new Date().toISOString(),
    )

    return c.json({
      object: 'list',
      data: requests.map(buildAuthRequestResponse),
      continuationToken: null,
    })
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Auth request list failed.',
      ),
      503,
    )
  }
}

async function readAuthRequestRoute(c: AppContext) {
  const runtime = resolveAuthRequestRuntime(c)
  if (!runtime.ok) {
    return runtime.response
  }

  const auth = await authenticateActiveDeviceRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const id = c.req.param('id')
  if (!id) {
    return c.json(authRequestNotFoundError(c.get('requestId')), 404)
  }

  try {
    const request = await findAuthRequestForOwner(c.env.DB, id, auth.user.id)

    return request
      ? c.json(buildAuthRequestResponse(request))
      : c.json(authRequestNotFoundError(c.get('requestId')), 404)
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Auth request lookup failed.',
      ),
      503,
    )
  }
}

async function respondToAuthRequestRoute(c: AppContext) {
  const runtime = resolveAuthRequestRuntime(c)
  if (!runtime.ok) {
    return runtime.response
  }

  const auth = await authenticateActiveDeviceRequest(c)
  if (!auth.ok) {
    return auth.response
  }

  const response = parseAuthRequestResponseBody(await readJsonBody(c.req.raw))
  if (!response.ok) {
    return c.json(
      apiError(
        c.get('requestId'),
        'invalid_request',
        'Auth request response is invalid.',
      ),
      400,
    )
  }

  const id = c.req.param('id')
  if (!id) {
    return c.json(authRequestNotFoundError(c.get('requestId')), 404)
  }
  const now = new Date().toISOString()

  try {
    const current = await findAuthRequestForOwner(c.env.DB, id, auth.user.id)
    if (!current) {
      return c.json(authRequestNotFoundError(c.get('requestId')), 404)
    }

    if (current.requestDeviceIdentifier === auth.deviceIdentifier) {
      return c.json(authRequestConflictError(c.get('requestId')), 409)
    }

    const transition = response.value.requestApproved
      ? await approveAuthRequest(c.env.DB, {
          id,
          userId: auth.user.id,
          approvingDeviceIdentifier: auth.deviceIdentifier,
          encryptedResponseKey: response.value.encryptedResponseKey,
          now,
        })
      : await denyAuthRequest(c.env.DB, {
          id,
          userId: auth.user.id,
          approvingDeviceIdentifier: auth.deviceIdentifier,
          now,
        })

    const updated = await findAuthRequestForOwner(c.env.DB, id, auth.user.id)
    if (!updated) {
      return c.json(authRequestNotFoundError(c.get('requestId')), 404)
    }

    const isSameResponse =
      updated.requestApproved === response.value.requestApproved &&
      (response.value.requestApproved
        ? updated.encryptedResponseKey === response.value.encryptedResponseKey
        : updated.encryptedResponseKey === null)

    if (transition.status === 'not_updated' && !isSameResponse) {
      return c.json(authRequestConflictError(c.get('requestId')), 409)
    }

    if (transition.status === 'updated') {
      await emitAuditEvent(c, {
        name: response.value.requestApproved
          ? 'auth.request_approve'
          : 'auth.request_deny',
        outcome: 'success',
        actor: {
          userId: auth.user.id,
          deviceIdentifier: auth.deviceIdentifier,
        },
        target: { type: 'auth_request', id },
      })
    }

    return c.json(buildAuthRequestResponse(updated))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Auth request response failed.',
      ),
      503,
    )
  }
}

async function pollAuthRequestRoute(c: AppContext) {
  const runtime = resolveAuthRequestRuntime(c)
  if (!runtime.ok) {
    return runtime.response
  }

  const id = c.req.param('id')
  const accessCode = c.req.query('code')
  if (
    !id ||
    !accessCode ||
    accessCode.length < authRequestPolicy.minAccessCodeLength ||
    accessCode.length > authRequestPolicy.maxAccessCodeLength
  ) {
    return c.json(authRequestNotFoundError(c.get('requestId')), 404)
  }

  try {
    const networkQuotaResponse = await enforceAuthRequestQuotas(
      c,
      'auth.request_poll',
      [
        {
          value: `poll:network:${extractClientAddress(c.req.raw.headers)}`,
          limit: authRequestQuotaPolicy.pollNetworkLimit,
        },
      ],
    )
    if (networkQuotaResponse) {
      return networkQuotaResponse
    }

    const request = await findAuthRequestVerifierById(
      c.env.DB,
      id,
      new Date().toISOString(),
    )
    const verified =
      request &&
      (await verifyAuthRequestAccessCode(
        runtime.secret,
        id,
        accessCode,
        request.accessCodeHash,
      ))

    if (!request || !verified) {
      return c.json(authRequestNotFoundError(c.get('requestId')), 404)
    }

    const deviceHash = await buildAuthRequestDeviceHash(
      runtime.secret,
      request.requestDeviceIdentifier,
    )
    const ownerQuotaResponse = await enforceAuthRequestQuotas(
      c,
      'auth.request_poll',
      [
        {
          value: `poll:account:${request.emailHash}`,
          limit: authRequestQuotaPolicy.pollAccountLimit,
        },
        {
          value: `poll:device:${deviceHash}`,
          limit: authRequestQuotaPolicy.pollDeviceLimit,
        },
      ],
    )
    if (ownerQuotaResponse) {
      return ownerQuotaResponse
    }

    await emitAuditEvent(c, {
      name: 'auth.request_poll',
      outcome: 'success',
      target: { type: 'auth_request', id },
      context: { status: request.status },
    })

    return c.json(buildAuthRequestResponse(request))
  } catch {
    return c.json(
      apiError(
        c.get('requestId'),
        'database_unavailable',
        'Auth request lookup failed.',
      ),
      503,
    )
  }
}

function resolveAuthRequestRuntime(
  c: AppContext,
): { ok: true; secret: string } | { ok: false; response: Response } {
  if (!isAuthRequestFeatureEnabled(c.env?.HONOWARDEN_AUTH_REQUESTS_ENABLED)) {
    return { ok: false, response: unsupportedAlphaFeature(c) }
  }

  const secret = c.env?.HONOWARDEN_AUTH_REQUEST_SECRET
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    return {
      ok: false,
      response: c.json(
        apiError(
          c.get('requestId'),
          'server_misconfigured',
          'Auth requests are not configured.',
        ),
        503,
      ),
    }
  }

  return { ok: true, secret }
}

async function enforceAuthRequestQuotas(
  c: AppContext,
  eventName:
    'auth.request_consume' | 'auth.request_create' | 'auth.request_poll',
  quotas: Array<{ value: string; limit: number }>,
): Promise<Response | null> {
  const now = new Date().toISOString()

  for (const quota of quotas) {
    const bucketKey = await buildRequestQuotaBucketKey(
      'anonymous',
      `auth-request:${quota.value}`,
    )
    const bucket = await recordRequestQuotaHit(c.env.DB, {
      bucketKey,
      scope: 'anonymous',
      limit: quota.limit,
      windowSeconds: authRequestQuotaPolicy.windowSeconds,
      blockSeconds: authRequestQuotaPolicy.blockSeconds,
      now,
    })

    if (isRequestQuotaExceeded(bucket, now)) {
      await emitAuditEvent(c, {
        name: eventName,
        outcome: 'failure',
        context: { reason: 'quota_rejected' },
      })
      c.header('Retry-After', String(authRequestQuotaPolicy.blockSeconds))

      return c.json(
        apiError(c.get('requestId'), 'rate_limited', 'Request quota exceeded.'),
        429,
      )
    }
  }

  return null
}

async function authenticateActiveDeviceRequest(
  c: AppContext,
): Promise<AuthenticatedVaultRequest> {
  const auth = await authenticateVaultRequest(c)
  if (!auth.ok) {
    return auth
  }

  try {
    const device = await findDeviceByIdentifier(c.env.DB, {
      userId: auth.user.id,
      identifier: auth.deviceIdentifier,
    })

    if (!device) {
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

    return auth
  } catch {
    return {
      ok: false,
      response: c.json(
        apiError(
          c.get('requestId'),
          'database_unavailable',
          'Device authorization failed.',
        ),
        503,
      ),
    }
  }
}

function buildAuthRequestResponse(request: AuthRequestRecord) {
  return {
    object: 'auth-request',
    id: request.id,
    publicKey: request.requestPublicKey,
    requestDeviceType: `Device ${request.requestDeviceType}`,
    requestDeviceTypeValue: request.requestDeviceType,
    requestDeviceIdentifier: request.requestDeviceIdentifier,
    requestIpAddress: null,
    requestCountryName: null,
    type: request.requestType,
    creationDate: request.createdAt,
    responseDate: request.responseAt,
    requestApproved: request.requestApproved ?? false,
    key: request.requestApproved ? request.encryptedResponseKey : null,
    requestDeviceId: null,
  }
}

function authRequestNotFoundError(requestIdValue: string) {
  return apiError(
    requestIdValue,
    'auth_request_not_found',
    'Auth request was not found.',
  )
}

function authRequestConflictError(requestIdValue: string) {
  return apiError(
    requestIdValue,
    'auth_request_conflict',
    'Auth request could not be updated.',
  )
}

async function authenticateVaultRequest(
  c: AppContext,
): Promise<AuthenticatedVaultRequest> {
  return authenticateVaultRequestWithAccessToken(
    c,
    readBearerToken(c.req.header('Authorization')),
  )
}

async function authenticateVaultRequestWithAccessToken(
  c: AppContext,
  accessToken: string | null,
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

function readNotificationHubAccessToken(c: AppContext): string | null {
  return (
    readBearerToken(c.req.header('Authorization')) ??
    readAccessTokenQuery(c.req.raw.url)
  )
}

function readAccessTokenQuery(url: string): string | null {
  const token = new URL(url).searchParams.get('access_token')?.trim()

  return token || null
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
}

export function acceptNotificationHubWebSocket(server: WebSocket): void {
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null
  const clearHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }
  }

  server.accept()
  server.addEventListener('message', (event) => {
    const payload = readWebSocketMessage(event.data)
    if (!payload) {
      return
    }

    for (const frame of payload.split(signalRRecordSeparator)) {
      if (!frame) {
        continue
      }

      const message = parseSignalRFrame(frame)
      if (!message) {
        continue
      }

      if (isSignalRHandshake(message)) {
        const protocol = readSignalRProtocol(message)
        clearHeartbeat()
        server.send(`{}${signalRRecordSeparator}`)
        sendSignalRPing(server, protocol)
        heartbeatInterval = setInterval(() => {
          sendSignalRPing(server, protocol)
        }, signalRHeartbeatIntervalMs)
      }
    }
  })
  server.addEventListener('close', clearHeartbeat)
  server.addEventListener('error', clearHeartbeat)
}

function readWebSocketMessage(data: string | ArrayBuffer): string | null {
  if (typeof data === 'string') {
    return data
  }

  try {
    return new TextDecoder().decode(data)
  } catch {
    return null
  }
}

function parseSignalRFrame(frame: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(frame)
    if (isPlainObject(parsed)) {
      return parsed
    }
  } catch {
    return null
  }

  return null
}

function isSignalRHandshake(message: Record<string, unknown>): boolean {
  return (
    (message.protocol === 'json' || message.protocol === 'messagepack') &&
    message.version === 1
  )
}

function readSignalRProtocol(
  message: Record<string, unknown>,
): 'json' | 'messagepack' {
  return message.protocol === 'messagepack' ? 'messagepack' : 'json'
}

function sendSignalRPing(
  server: WebSocket,
  protocol: 'json' | 'messagepack',
): void {
  if (server.readyState !== WebSocket.OPEN) {
    return
  }

  if (protocol === 'messagepack') {
    server.send(new Uint8Array([0x02, 0x91, 0x06]).buffer)
    return
  }

  server.send(`{"type":6}${signalRRecordSeparator}`)
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

function parsePushTokenRequestBody(
  body: unknown,
): { ok: true } | { ok: false } {
  if (!isPlainObject(body)) {
    return { ok: false }
  }

  return typeof body.pushToken === 'string' && body.pushToken.trim()
    ? { ok: true }
    : { ok: false }
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

function parseTrustedDeviceUpdateRequestBody(body: unknown):
  | {
      ok: true
      devices: {
        deviceIdOrIdentifier: string
        encryptedUserKey: string
        encryptedPublicKey: string
        encryptedPrivateKey: string
      }[]
    }
  | { ok: false } {
  if (!isPlainObject(body)) {
    return { ok: false }
  }

  const devices = body.devices ?? body.Devices
  if (!Array.isArray(devices) || devices.length < 1 || devices.length > 100) {
    return { ok: false }
  }

  const parsedDevices: {
    deviceIdOrIdentifier: string
    encryptedUserKey: string
    encryptedPublicKey: string
    encryptedPrivateKey: string
  }[] = []
  const seenDeviceIds = new Set<string>()

  for (const device of devices) {
    if (!isPlainObject(device)) {
      return { ok: false }
    }

    const deviceIdOrIdentifier =
      parseRequiredString(device.id) ??
      parseRequiredString(device.Id) ??
      parseRequiredString(device.deviceId) ??
      parseRequiredString(device.DeviceId) ??
      parseRequiredString(device.identifier) ??
      parseRequiredString(device.Identifier) ??
      parseRequiredString(device.deviceIdentifier) ??
      parseRequiredString(device.DeviceIdentifier)
    const encryptedUserKey =
      parseRequiredString(device.encryptedUserKey) ??
      parseRequiredString(device.EncryptedUserKey)
    const encryptedPublicKey =
      parseRequiredString(device.encryptedPublicKey) ??
      parseRequiredString(device.EncryptedPublicKey)
    const encryptedPrivateKey =
      parseRequiredString(device.encryptedPrivateKey) ??
      parseRequiredString(device.EncryptedPrivateKey)

    if (
      !deviceIdOrIdentifier ||
      !encryptedUserKey ||
      !encryptedPublicKey ||
      !encryptedPrivateKey ||
      seenDeviceIds.has(deviceIdOrIdentifier)
    ) {
      return { ok: false }
    }

    seenDeviceIds.add(deviceIdOrIdentifier)
    parsedDevices.push({
      deviceIdOrIdentifier,
      encryptedUserKey,
      encryptedPublicKey,
      encryptedPrivateKey,
    })
  }

  return {
    ok: true,
    devices: parsedDevices,
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

function parseDomainSettingsRequestBody(body: unknown):
  | {
      ok: true
      equivalentDomains: string[][]
      excludedGlobalEquivalentDomains: number[]
    }
  | { ok: false } {
  if (!isPlainObject(body)) {
    return { ok: false }
  }

  const equivalentDomainsValue =
    body.equivalentDomains ?? body.EquivalentDomains
  const excludedGlobalDomainsValue =
    body.excludedGlobalEquivalentDomains ??
    body.ExcludedGlobalEquivalentDomains ??
    []
  const equivalentDomains = parseEquivalentDomainGroups(
    equivalentDomainsValue ?? [],
  )
  const excludedGlobalEquivalentDomains =
    parseExcludedGlobalEquivalentDomainTypes(excludedGlobalDomainsValue)

  if (!equivalentDomains || !excludedGlobalEquivalentDomains) {
    return { ok: false }
  }

  return {
    ok: true,
    equivalentDomains,
    excludedGlobalEquivalentDomains,
  }
}

function parseEquivalentDomainGroups(value: unknown): string[][] | null {
  if (!Array.isArray(value) || value.length > 100) {
    return null
  }

  const groups: string[][] = []

  for (const group of value) {
    if (!Array.isArray(group) || group.length > 20) {
      return null
    }

    const domains: string[] = []
    const seenDomains = new Set<string>()
    for (const rawDomain of group) {
      const domain = normalizeEquivalentDomain(rawDomain)
      if (!domain) {
        return null
      }

      if (!seenDomains.has(domain)) {
        domains.push(domain)
        seenDomains.add(domain)
      }
    }

    if (domains.length < 2) {
      return null
    }

    groups.push(domains)
  }

  return groups
}

function normalizeEquivalentDomain(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const domain = value.trim().toLowerCase().replace(/\.$/, '')
  if (
    !domain ||
    domain.length > 253 ||
    domain.includes('/') ||
    domain.includes(':') ||
    domain.includes('@') ||
    domain.includes('*') ||
    domain.includes(' ')
  ) {
    return null
  }

  const labels = domain.split('.')
  if (labels.some((label) => !isValidDomainLabel(label))) {
    return null
  }

  return domain
}

function isValidDomainLabel(label: string): boolean {
  return (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )
}

function parseExcludedGlobalEquivalentDomainTypes(
  value: unknown,
): number[] | null {
  if (!Array.isArray(value) || value.length > 200) {
    return null
  }

  const excludedGlobalDomains: number[] = []
  const seenTypes = new Set<number>()

  for (const item of value) {
    if (!Number.isInteger(item) || item < 0 || item > 255) {
      return null
    }

    if (!seenTypes.has(item)) {
      excludedGlobalDomains.push(item)
      seenTypes.add(item)
    }
  }

  return excludedGlobalDomains
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
