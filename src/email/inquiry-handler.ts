import type { Bindings } from '../bindings'
import {
  inquiryMessageRetentionPolicy,
  persistInquiryMessage,
} from '../repositories/inquiry-message-repository'
import type {
  InquiryMessageAttachmentStorageState,
  InquiryMessageDeliveryStatus,
  PersistInquiryMessageInput,
} from '../repositories/inquiry-message-repository'

type InquiryEmailMessage = Pick<
  ForwardableEmailMessage,
  'from' | 'to' | 'headers' | 'rawSize' | 'setReject'
>

type InquiryHandlerOptions = {
  now?: Date
  id?: string
}

type NormalizedAddress = {
  localPart: string
  domain: string
}

const defaultInquiryDomain = 'honowarden.com'
const defaultInquiryMailboxes = [
  'security',
  'support',
  'hello',
  'admin',
  'postmaster',
  'abuse',
]
const rejectReasons = {
  unsupportedRecipient: 'Unsupported inquiry recipient',
  attachmentRejected: 'Inquiry attachments are not accepted yet',
  storageFailure: 'Temporary inquiry storage failure',
} as const

export async function handleInboundInquiryEmail(
  message: InquiryEmailMessage,
  env: Bindings,
  options: InquiryHandlerOptions = {},
): Promise<void> {
  const now = options.now ?? new Date()
  const receivedAt = now.toISOString()
  const id = options.id ?? crypto.randomUUID()
  const recipient = normalizeEnvelopeAddress(message.to)
  const domain = normalizeDomain(
    env.HONOWARDEN_INQUIRY_DOMAIN ?? defaultInquiryDomain,
  )
  const mailboxes = parseInquiryMailboxes(env.HONOWARDEN_INQUIRY_MAILBOXES)
  const mailbox =
    recipient?.domain === domain && mailboxes.has(recipient.localPart)
      ? recipient.localPart
      : null
  const attachmentPolicy = classifyAttachmentPolicy(message.headers)
  const deliveryStatus: InquiryMessageDeliveryStatus =
    mailbox && attachmentPolicy.storageState !== 'rejected'
      ? 'stored'
      : 'rejected'
  const rejectReason = rejectReasonFor({
    mailbox,
    attachmentStorageState: attachmentPolicy.storageState,
  })

  try {
    await persistInquiryMessage(
      env.DB,
      await buildInquiryMessageInput({
        id,
        mailbox: mailbox ?? 'unsupported',
        message,
        receivedAt,
        retentionDeleteAfter: addDaysIso(
          now,
          inquiryMessageRetentionPolicy.metadataRetentionDays,
        ),
        deliveryStatus,
        rejectReason,
        attachmentStorageState: attachmentPolicy.storageState,
        attachmentCount: attachmentPolicy.attachmentCount,
      }),
    )
  } catch (error) {
    logInquiryEmailError({
      code: 'inquiry_storage_failed',
      mailbox: mailbox ?? 'unsupported',
      error,
    })
    message.setReject(rejectReasons.storageFailure)
    return
  }

  if (rejectReason) {
    message.setReject(rejectReason)
  }
}

async function buildInquiryMessageInput(input: {
  id: string
  mailbox: string
  message: InquiryEmailMessage
  receivedAt: string
  retentionDeleteAfter: string
  deliveryStatus: InquiryMessageDeliveryStatus
  rejectReason: string | null
  attachmentStorageState: InquiryMessageAttachmentStorageState
  attachmentCount: number | null
}): Promise<PersistInquiryMessageInput> {
  const subject = input.message.headers.get('subject')
  const messageId = input.message.headers.get('message-id')
  const headers = buildSanitizedHeaderMetadata(input.message.headers)
  const bodyMetadata = buildBodyMetadata({
    headers: input.message.headers,
    rawSize: input.message.rawSize,
  })

  return {
    id: input.id,
    mailbox: input.mailbox,
    envelopeSender: input.message.from.trim(),
    envelopeSenderSha256: await sha256Hex(input.message.from.trim()),
    envelopeRecipient: input.message.to.trim(),
    messageIdSha256: messageId ? await sha256Hex(messageId) : null,
    subjectSha256: subject ? await sha256Hex(subject) : null,
    headersJson: JSON.stringify(headers),
    headerCount: headers.headerCount,
    rawSize: input.message.rawSize,
    bodyMetadataJson: JSON.stringify(bodyMetadata),
    bodyStorageState: 'metadata_only',
    rawStorageState: 'disabled',
    attachmentStorageState: input.attachmentStorageState,
    attachmentCount: input.attachmentCount,
    deliveryStatus: input.deliveryStatus,
    rejectReason: input.rejectReason,
    receivedAt: input.receivedAt,
    retentionDeleteAfter: input.retentionDeleteAfter,
  }
}

function buildSanitizedHeaderMetadata(headers: Headers) {
  return {
    schemaVersion: 1,
    headerCount: Array.from(headers.entries()).length,
    date: headerOrNull(headers, 'date'),
    contentType: headerOrNull(headers, 'content-type'),
    contentTransferEncoding: headerOrNull(headers, 'content-transfer-encoding'),
    autoSubmitted: headerOrNull(headers, 'auto-submitted'),
    precedence: headerOrNull(headers, 'precedence'),
    hasSubject: headers.has('subject'),
    hasMessageId: headers.has('message-id'),
    hasReferences: headers.has('references'),
    hasInReplyTo: headers.has('in-reply-to'),
  }
}

function buildBodyMetadata(input: { headers: Headers; rawSize: number }) {
  return {
    schemaVersion: 1,
    rawSize: input.rawSize,
    contentType: headerOrNull(input.headers, 'content-type'),
    contentTransferEncoding: headerOrNull(
      input.headers,
      'content-transfer-encoding',
    ),
    parser: 'not_run',
    bodyStorageState: 'metadata_only',
    rawStorageState: 'disabled',
  }
}

function classifyAttachmentPolicy(headers: Headers): {
  storageState: InquiryMessageAttachmentStorageState
  attachmentCount: number | null
} {
  const contentDisposition = headers.get('content-disposition')?.toLowerCase()
  const contentType = headers.get('content-type')?.toLowerCase()

  if (
    contentDisposition?.includes('attachment') ||
    contentType?.includes('multipart/mixed')
  ) {
    return {
      storageState: 'rejected',
      attachmentCount: null,
    }
  }

  if (contentType?.includes('multipart/')) {
    return {
      storageState: 'unknown',
      attachmentCount: null,
    }
  }

  return {
    storageState: 'not_present',
    attachmentCount: 0,
  }
}

function rejectReasonFor(input: {
  mailbox: string | null
  attachmentStorageState: InquiryMessageAttachmentStorageState
}): string | null {
  if (!input.mailbox) {
    return rejectReasons.unsupportedRecipient
  }

  if (input.attachmentStorageState === 'rejected') {
    return rejectReasons.attachmentRejected
  }

  return null
}

function parseInquiryMailboxes(value: string | undefined): Set<string> {
  const source = value?.trim() ? value.split(',') : defaultInquiryMailboxes
  const mailboxes = source
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[a-z0-9._+-]+$/.test(entry))

  return new Set(mailboxes.length > 0 ? mailboxes : defaultInquiryMailboxes)
}

function normalizeEnvelopeAddress(value: string): NormalizedAddress | null {
  const bracketMatch = /<([^>]+)>/.exec(value)
  const candidate = (bracketMatch?.[1] ?? value).trim().toLowerCase()
  const atIndex = candidate.lastIndexOf('@')

  if (atIndex <= 0 || atIndex === candidate.length - 1) {
    return null
  }

  return {
    localPart: candidate.slice(0, atIndex),
    domain: normalizeDomain(candidate.slice(atIndex + 1)),
  }
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase()
}

function headerOrNull(headers: Headers, name: string): string | null {
  const value = headers.get(name)

  if (!value) {
    return null
  }

  return value.length <= 256 ? value : `${value.slice(0, 256)}...`
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function addDaysIso(date: Date, days: number): string {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString()
}

function logInquiryEmailError(input: {
  code: string
  mailbox: string
  error: unknown
}): void {
  console.error(
    JSON.stringify({
      service: 'honowarden',
      event: 'inquiry_email_error',
      code: input.code,
      mailbox: input.mailbox,
      errorName:
        input.error instanceof Error ? input.error.name : typeof input.error,
    }),
  )
}
