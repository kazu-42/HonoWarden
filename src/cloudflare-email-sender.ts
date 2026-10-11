import {
  validOrganizationInvitationMessage,
  type OrganizationInvitationSender,
} from './organization-invitation-mailer'

type EmailBinding = Pick<SendEmail, 'send'>

const providerCodes = new Set([
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_TOO_MANY_RECIPIENTS',
  'E_TOO_MANY_ATTACHMENTS',
  'E_CONTENT_TOO_LARGE',
  'E_SENDER_NOT_VERIFIED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_RECIPIENT_SUPPRESSED',
  'E_DELIVERY_FAILED',
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
  'E_INTERNAL_SERVER_ERROR',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY',
])

export function createCloudflareEmailSender(
  binding: EmailBinding | undefined,
): OrganizationInvitationSender {
  if (!binding || typeof binding.send !== 'function') {
    throw new Error('Cloudflare email sender configuration is invalid.')
  }
  return async (message, signal) => {
    if (signal.aborted || !validOrganizationInvitationMessage(message)) {
      throw deliveryError()
    }
    let onAbort!: () => void
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(deliveryError())
      signal.addEventListener('abort', onAbort, { once: true })
    })
    let reported = false
    try {
      if (signal.aborted) throw deliveryError()
      const result = await Promise.race([
        binding.send({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
        aborted,
      ])
      if (signal.aborted) throw deliveryError()
      if (
        !result ||
        typeof result.messageId !== 'string' ||
        result.messageId.length === 0 ||
        result.messageId.length > 512 ||
        [...result.messageId].some((character) => {
          const codePoint = character.codePointAt(0)!
          return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
        })
      ) {
        report('invalid_ack')
        reported = true
        throw deliveryError()
      }
      return 'accepted'
    } catch (error) {
      if (!reported) report(signal.aborted ? 'timeout' : providerCode(error))
      throw deliveryError()
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

function providerCode(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  try {
    const code: unknown = Reflect.get(error, 'code')
    return typeof code === 'string' && providerCodes.has(code)
      ? code
      : 'unknown'
  } catch {
    return 'unknown'
  }
}

function report(code: string): void {
  console.error(JSON.stringify({ event: 'cloudflare_email_send_failed', code }))
}

function deliveryError(): Error {
  return new Error('Cloudflare email delivery failed.')
}
