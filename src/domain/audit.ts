export type AuditEventName =
  | 'admin.bootstrap'
  | 'account.security_stamp.rotate'
  | 'account.password.change'
  | 'account.kdf.change'
  | 'account.keys.initialize'
  | 'account.keys.rotate'
  | 'auth.password_grant'
  | 'auth.refresh_grant'
  | 'auth.refresh_reuse'
  | 'auth.request_approve'
  | 'auth.request_create'
  | 'auth.request_consume'
  | 'auth.request_deny'
  | 'auth.request_poll'
  | 'backup.export'
  | 'attachment.create'
  | 'attachment.delete'
  | 'cipher.create'
  | 'cipher.delete'
  | 'cipher.permanent_delete'
  | 'cipher.restore'
  | 'cipher.update'
  | 'device.revoke'
  | 'folder.create'
  | 'folder.delete'
  | 'folder.update'
  | 'session.revoke_all'
  | 'totp.change'
  | 'totp.disable'

export type AuditEventOutcome = 'success' | 'failure'

export type AuditEvent = {
  object: 'auditEvent'
  schemaVersion: 1
  name: AuditEventName
  outcome: AuditEventOutcome
  requestId: string
  occurredAt: string
  actor?: {
    userId?: string
    deviceIdentifier?: string
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
    id?: string
  }
  context?: AuditContext
}

type AuditContext = Record<string, string | number | boolean | null>

type AuditEventInput = {
  name: AuditEventName
  outcome: AuditEventOutcome
  requestId: string
  occurredAt: string
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
  context?: AuditContext
}

const sensitiveContextKeyFragments = [
  'body',
  'encrypted',
  'hash',
  'key',
  'password',
  'payload',
  'secret',
  'token',
]

export function buildAuditEvent(input: AuditEventInput): AuditEvent {
  const event: AuditEvent = {
    object: 'auditEvent',
    schemaVersion: 1,
    name: input.name,
    outcome: input.outcome,
    requestId: input.requestId,
    occurredAt: input.occurredAt,
  }
  const context = sanitizeAuditContext(input.context)

  if (input.actor) {
    event.actor = sanitizeAuditActor(input.actor)
  }

  if (input.target) {
    event.target = sanitizeAuditTarget(input.target)
  }

  if (Object.keys(context).length > 0) {
    event.context = context
  }

  return event
}

export function serializeAuditEvent(event: AuditEvent): string {
  return JSON.stringify(event)
}

export function isAuditLoggingEnabled(value: string | undefined): boolean {
  return value === 'true'
}

function sanitizeAuditContext(context: AuditContext | undefined): AuditContext {
  if (!context) {
    return {}
  }

  const sanitized: AuditContext = {}

  for (const [key, value] of Object.entries(context)) {
    if (isSensitiveContextKey(key)) {
      continue
    }

    sanitized[key] = value
  }

  return sanitized
}

function isSensitiveContextKey(key: string): boolean {
  const normalizedKey = key.toLowerCase()

  return sensitiveContextKeyFragments.some((fragment) =>
    normalizedKey.includes(fragment),
  )
}

function sanitizeAuditActor(
  actor: NonNullable<AuditEventInput['actor']>,
): NonNullable<AuditEvent['actor']> {
  const sanitized: NonNullable<AuditEvent['actor']> = {}

  if (actor.userId !== undefined) {
    sanitized.userId = actor.userId
  }

  if (actor.deviceIdentifier !== undefined) {
    sanitized.deviceIdentifier = actor.deviceIdentifier
  }

  return sanitized
}

function sanitizeAuditTarget(
  target: NonNullable<AuditEventInput['target']>,
): NonNullable<AuditEvent['target']> {
  const sanitized: NonNullable<AuditEvent['target']> = {
    type: target.type,
  }

  if (target.id !== undefined) {
    sanitized.id = target.id
  }

  return sanitized
}
