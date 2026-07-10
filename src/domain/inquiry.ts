export const defaultInquiryMailboxes = [
  'security',
  'support',
  'hello',
  'admin',
  'postmaster',
  'abuse',
] as const

export const inquiryRetentionPolicy = {
  metadataRetentionDays: 365,
  maxSubjectPreviewLength: 160,
  maxRawSizeBytes: 1_000_000,
} as const

export type InquiryMailboxConfig = {
  mailboxes: string[]
  domains: string[]
}

export type ParseInquiryMailboxConfigInput = {
  mailboxes?: string | undefined
  domains?: string | undefined
}

export type InquiryDeliveryStatus = 'stored' | 'forwarded' | 'rejected'
export type InquiryBodyStorageState = 'metadata_only'
export type InquiryAttachmentStorageState = 'none' | 'rejected'

export type InquiryInboundRecord = {
  threadId: string
  messageId: string
  eventId: string
  mailbox: string
  threadKey: string
  senderHash: string
  envelopeSenderHash: string
  envelopeRecipient: string
  messageIdHash: string | null
  inReplyToHash: string | null
  referencesHash: string | null
  subjectPreview: string | null
  rawSize: number
  contentType: string | null
  hasAttachmentHint: boolean
  bodyStorageState: InquiryBodyStorageState
  rawBodyStored: boolean
  rawObjectKey: string | null
  attachmentStorageState: InquiryAttachmentStorageState
  deliveryStatus: InquiryDeliveryStatus
  rejectionReason: string | null
  forwardAttempted: boolean
  forwardedAt: string | null
  receivedAt: string
  retentionDeadline: string
}

export type BuildInquiryInboundRecordInput = {
  envelopeFrom: string
  envelopeTo: string
  headers: Headers
  rawSize: number
  now: string
  retentionDays: number
  config: InquiryMailboxConfig
}

export type BuildInquiryInboundRecordResult =
  | { ok: true; value: InquiryInboundRecord }
  | { ok: false; reason: 'recipient_not_allowed' }

export function parseInquiryMailboxConfig(
  input: ParseInquiryMailboxConfigInput,
): InquiryMailboxConfig {
  const domains = parseList(input.domains)
    .map((domain) => domain.toLowerCase())
    .filter(isValidDomain)
  const mailboxes = parseList(input.mailboxes)
    .map(extractLocalPart)
    .filter(isValidLocalPart)

  return {
    mailboxes:
      mailboxes.length > 0 ? unique(mailboxes) : [...defaultInquiryMailboxes],
    domains: domains.length > 0 ? unique(domains) : ['honowarden.com'],
  }
}

export async function buildInquiryInboundRecord(
  input: BuildInquiryInboundRecordInput,
): Promise<BuildInquiryInboundRecordResult> {
  const recipient = normalizeRecipient(input.envelopeTo)
  if (!recipient || !isAllowedRecipient(recipient, input.config)) {
    return { ok: false, reason: 'recipient_not_allowed' }
  }

  const mailbox = recipient.localPart
  const envelopeRecipient = `${recipient.localPart}@${recipient.domain}`
  const envelopeSender = input.envelopeFrom.trim().toLowerCase()
  const subjectPreview = sanitizeSubjectPreview(input.headers.get('subject'))
  const messageId = input.headers.get('message-id')
  const inReplyTo = input.headers.get('in-reply-to')
  const references = input.headers.get('references')
  const contentType = sanitizeHeaderValue(input.headers.get('content-type'))
  const hasAttachmentHint = hasAttachmentContentHint(input.headers)
  const senderHash = await sha256Hex(envelopeSender)
  const threadKey = await buildThreadKey({
    mailbox,
    envelopeSender,
    subjectPreview,
    messageId,
    inReplyTo,
    references,
  })
  const threadId = `inq_thr_${await sha256Hex(`${mailbox}\0${threadKey}`)}`
  const messageEntropy =
    messageId ?? `${envelopeSender}\0${envelopeRecipient}\0${input.now}`
  const messageIdValue = `inq_msg_${await sha256Hex(
    `${mailbox}\0${messageEntropy}\0${input.rawSize}`,
  )}`

  return {
    ok: true,
    value: {
      threadId,
      messageId: messageIdValue,
      eventId: crypto.randomUUID(),
      mailbox,
      threadKey,
      senderHash,
      envelopeSenderHash: senderHash,
      envelopeRecipient,
      messageIdHash: await hashNullableHeader(messageId),
      inReplyToHash: await hashNullableHeader(inReplyTo),
      referencesHash: await hashNullableHeader(references),
      subjectPreview,
      rawSize: input.rawSize,
      contentType,
      hasAttachmentHint,
      bodyStorageState: 'metadata_only',
      rawBodyStored: false,
      rawObjectKey: null,
      attachmentStorageState: hasAttachmentHint ? 'rejected' : 'none',
      deliveryStatus: hasAttachmentHint ? 'rejected' : 'stored',
      rejectionReason: hasAttachmentHint ? 'attachments_disabled' : null,
      forwardAttempted: false,
      forwardedAt: null,
      receivedAt: input.now,
      retentionDeadline: new Date(
        Date.parse(input.now) + input.retentionDays * 86400 * 1000,
      ).toISOString(),
    },
  }
}

export function markInquiryForwarded(
  record: InquiryInboundRecord,
  forwardedAt: string,
): InquiryInboundRecord {
  return {
    ...record,
    deliveryStatus: 'forwarded',
    forwardAttempted: true,
    forwardedAt,
  }
}

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
}

function extractLocalPart(value: string): string {
  return value.includes('@') ? (value.split('@')[0] ?? '') : value
}

function isValidLocalPart(value: string): boolean {
  return /^[a-z0-9._%+-]+$/.test(value)
}

function isValidDomain(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizeRecipient(
  value: string,
): { localPart: string; domain: string } | null {
  const normalized = value.trim().toLowerCase()
  const match = normalized.match(/^([^@\s]+)@([^@\s]+)$/)
  if (!match?.[1] || !match[2]) {
    return null
  }

  return {
    localPart: match[1],
    domain: match[2],
  }
}

function isAllowedRecipient(
  recipient: { localPart: string; domain: string },
  config: InquiryMailboxConfig,
): boolean {
  return (
    config.mailboxes.includes(recipient.localPart) &&
    config.domains.includes(recipient.domain)
  )
}

function sanitizeSubjectPreview(value: string | null): string | null {
  const sanitized = sanitizeHeaderValue(value)
  if (!sanitized) {
    return null
  }

  return sanitized.slice(0, inquiryRetentionPolicy.maxSubjectPreviewLength)
}

function sanitizeHeaderValue(value: string | null): string | null {
  const sanitized = (value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return sanitized.length > 0 ? sanitized : null
}

function hasAttachmentContentHint(headers: Headers): boolean {
  const contentType = headers.get('content-type')?.toLowerCase() ?? ''
  const contentDisposition =
    headers.get('content-disposition')?.toLowerCase() ?? ''

  return (
    contentType.includes('multipart/mixed') ||
    contentType.includes('multipart/related') ||
    contentDisposition.includes('attachment')
  )
}

async function buildThreadKey(input: {
  mailbox: string
  envelopeSender: string
  subjectPreview: string | null
  messageId: string | null
  inReplyTo: string | null
  references: string | null
}): Promise<string> {
  const reference = input.inReplyTo ?? lastReference(input.references)
  if (reference) {
    return `ref:${await sha256Hex(reference.trim().toLowerCase())}`
  }
  if (input.messageId) {
    return `msg:${await sha256Hex(input.messageId.trim().toLowerCase())}`
  }

  return `fallback:${await sha256Hex(
    `${input.mailbox}\0${input.envelopeSender}\0${input.subjectPreview ?? ''}`,
  )}`
}

function lastReference(value: string | null): string | null {
  const references = (value ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  return references.at(-1) ?? null
}

async function hashNullableHeader(
  value: string | null,
): Promise<string | null> {
  const sanitized = sanitizeHeaderValue(value)
  return sanitized ? sha256Hex(sanitized.toLowerCase()) : null
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', encoded)

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
