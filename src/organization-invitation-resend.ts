import { parseOrganizationMembershipInviteRequest } from './domain/organization-membership'
import type {
  OrganizationInvitationMail,
  OrganizationInvitationSender,
} from './organization-invitation-mailer'

export type InvitationProviderFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>

const endpoint = 'https://api.resend.com/emails'
const maxResponseBytes = 4096
const encoder = new TextEncoder()

export function createResendInvitationSender(options: {
  apiKey: string
  fetch?: InvitationProviderFetch
}): OrganizationInvitationSender {
  const { apiKey, fetch = globalThis.fetch } = options
  if (!/^[!-~]{1,512}$/.test(apiKey)) {
    throw new Error('Resend invitation sender configuration is invalid.')
  }
  return async (message, signal) => {
    let response: Response | undefined
    try {
      if (signal.aborted || !validMessage(message)) throw deliveryError()
      const body = JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      })
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', encoder.encode(body)),
      )
      const idempotencyKey =
        'honowarden-invitation:' +
        [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      if (signal.aborted) throw deliveryError()
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body,
        redirect: 'error',
        signal,
      })
      if (!response.ok || signal.aborted) throw deliveryError()
      const value = await acknowledgement(response, signal)
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('id' in value) ||
        typeof value.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
        signal.aborted
      )
        throw deliveryError()
      return 'accepted'
    } catch {
      throw deliveryError()
    } finally {
      // Provider error bodies may contain recipient addresses or token-bearing
      // content. Discard them without reading or awaiting unbounded cleanup.
      if (response?.body && !response.body.locked) {
        void response.body.cancel().catch(() => undefined)
      }
    }
  }
}

function validMessage(message: OrganizationInvitationMail): boolean {
  const sender = parseOrganizationMembershipInviteRequest({
    emails: [message.from],
    type: 2,
  })
  const recipient = parseOrganizationMembershipInviteRequest({
    emails: [message.to],
    type: 2,
  })
  return (
    sender.ok &&
    sender.value.emailsNormalized[0] === message.from &&
    recipient.ok &&
    recipient.value.emailsNormalized[0] === message.to &&
    typeof message.subject === 'string' &&
    message.subject.length > 0 &&
    message.subject.length <= 256 &&
    ![...message.subject].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    typeof message.text === 'string' &&
    message.text.length > 0 &&
    encoder.encode(message.text).byteLength <= 8192
  )
}

async function acknowledgement(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const length = response.headers.get('content-length')
  if (
    !/^application\/json(?:;|$)/i.test(
      response.headers.get('content-type') ?? '',
    ) ||
    !response.body ||
    signal.aborted ||
    (length !== null &&
      (!/^\d+$/.test(length) ||
        !Number.isSafeInteger(Number(length)) ||
        Number(length) > maxResponseBytes))
  )
    throw deliveryError()
  const reader = response.body.getReader()
  let onAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      void reader.cancel().catch(() => undefined)
      reject(deliveryError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxResponseBytes) throw deliveryError()
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  } finally {
    signal.removeEventListener('abort', onAbort)
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function deliveryError(): Error {
  return new Error('Resend invitation delivery failed.')
}
