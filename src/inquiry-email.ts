import {
  buildInquiryInboundRecord,
  inquiryRetentionPolicy,
  parseInquiryMailboxConfig,
} from './domain/inquiry'
import type { Bindings } from './bindings'
import {
  markInquiryMessageForwarded,
  persistInquiryInboundMessage,
} from './repositories/inquiry-repository'

export async function handleInquiryEmail(
  message: ForwardableEmailMessage,
  env: Bindings,
): Promise<void> {
  const now = new Date().toISOString()
  const config = parseInquiryMailboxConfig({
    mailboxes: env.HONOWARDEN_INQUIRY_MAILBOXES,
    domains: env.HONOWARDEN_INQUIRY_DOMAINS,
  })
  const maxRawSizeBytes = parsePositiveInteger(
    env.HONOWARDEN_INQUIRY_MAX_RAW_BYTES,
    inquiryRetentionPolicy.maxRawSizeBytes,
  )

  if (message.rawSize > maxRawSizeBytes) {
    message.setReject('Message is too large.')
    return
  }

  const recordResult = await buildInquiryInboundRecord({
    envelopeFrom: message.from,
    envelopeTo: message.to,
    headers: message.headers,
    rawSize: message.rawSize,
    now,
    retentionDays: inquiryRetentionPolicy.metadataRetentionDays,
    config,
  })

  if (!recordResult.ok) {
    message.setReject('Recipient is not accepted.')
    return
  }

  const record = recordResult.value
  const forwardTo = normalizeForwardDestination(
    env.HONOWARDEN_INQUIRY_FORWARD_TO,
  )

  await persistInquiryInboundMessage(env.INQUIRY_DB, record)

  if (record.deliveryStatus === 'rejected') {
    message.setReject('Attachments are not accepted.')
    return
  }

  if (forwardTo) {
    await message.forward(forwardTo)
    try {
      await markInquiryMessageForwarded(env.INQUIRY_DB, {
        threadId: record.threadId,
        messageId: record.messageId,
        forwardedAt: new Date().toISOString(),
      })
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'inquiry.forward_status_update_failed',
          threadId: record.threadId,
          messageId: record.messageId,
          error: serializeError(error),
        }),
      )
    }
  }
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeForwardDestination(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)
    ? normalized
    : null
}

function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }

  return { name: 'UnknownError', message: String(error) }
}
