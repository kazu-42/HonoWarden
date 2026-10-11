import {
  parseOrganizationMembershipAcceptRequest,
  parseOrganizationMembershipInviteRequest,
} from './domain/organization-membership'
import { readBoundedJsonBody } from './infra/bounded-json'
import type { OrganizationMembershipDelivery } from './organization-membership'

export type OrganizationInvitationMail = {
  from: string
  to: string
  subject: string
  text: string
}

export type OrganizationInvitationSender = (
  message: OrganizationInvitationMail,
  signal: AbortSignal,
) => Promise<'accepted'>

type MailerOptions = {
  adminOrigin: string
  senderEmail: string
  send: OrganizationInvitationSender
  now?: () => number
}

const deliveryUrl = 'https://organization-membership-mailer.internal/deliver'
const maxBodyBytes = 4096
const deliveryDeadlineMs = 10_000

// Mount this receiver behind the existing service binding only. Matching the
// internal URL is a routing check, not authentication for a public endpoint.
export function createOrganizationInvitationMailer(options: MailerOptions): {
  fetch(request: Request): Promise<Response>
} {
  const { adminOrigin, senderEmail, send, now = Date.now } = options
  if (!canonicalHttpsOrigin(adminOrigin) || !normalizedEmail(senderEmail)) {
    throw new Error('Organization invitation mailer configuration is invalid.')
  }

  return {
    async fetch(request) {
      if (request.url !== deliveryUrl || request.method !== 'POST') {
        return result(404)
      }
      if (
        !/^application\/json(?:;|$)/i.test(
          request.headers.get('content-type') ?? '',
        )
      ) {
        return result(400)
      }
      const body = await readBoundedJsonBody(request, maxBodyBytes)
      const delivery = body.ok ? parseDelivery(body.value, now()) : null
      if (!delivery) return result(400)

      const message: OrganizationInvitationMail = {
        from: senderEmail,
        to: delivery.recipientEmail,
        subject: 'HonoWarden organization invitation',
        text: [
          'You have been invited to a HonoWarden organization.',
          'Open this link and sign in with the invited email address:',
          `${adminOrigin}/admin/accept/${delivery.organizationId}/${delivery.membershipId}#token=${delivery.token}`,
          `This single-use invitation expires at ${delivery.expiresAt}.`,
          'An administrator must confirm your membership before you can access shared items.',
          'If you were not expecting this invitation, ignore this message.',
        ].join('\n\n'),
      }
      const controller = new AbortController()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const outcome = await Promise.race([
          Promise.resolve().then(() => send(message, controller.signal)),
          new Promise<'timeout'>((resolve) => {
            timeout = setTimeout(() => {
              resolve('timeout')
              controller.abort()
            }, deliveryDeadlineMs)
          }),
        ])
        if (outcome !== 'accepted') {
          return deliveryFailure(
            outcome === 'timeout' ? 'delivery_timeout' : 'delivery_rejected',
          )
        }
        return result(202)
      } catch {
        return deliveryFailure('delivery_failed')
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    },
  }
}

function deliveryFailure(
  code: 'delivery_timeout' | 'delivery_rejected' | 'delivery_failed',
): Response {
  console.error(
    JSON.stringify({ event: 'organization_invitation_delivery_failed', code }),
  )
  return result(503)
}

function result(status: 202 | 400 | 404 | 503): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function canonicalHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}

function normalizedEmail(value: unknown): value is string {
  const parsed = parseOrganizationMembershipInviteRequest({
    emails: [value],
    type: 2,
  })
  return parsed.ok && parsed.value.emailsNormalized[0] === value
}

function parseDelivery(
  value: unknown,
  now: number,
): OrganizationMembershipDelivery | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null
  const fields = [
    'recipientEmail',
    'token',
    'organizationId',
    'membershipId',
    'expiresAt',
  ]
  const object = value as Record<string, unknown>
  if (
    Object.keys(object).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(object, field))
  )
    return null
  const { recipientEmail, token, organizationId, membershipId, expiresAt } =
    object
  if (
    !normalizedEmail(recipientEmail) ||
    !parseOrganizationMembershipAcceptRequest({ token }).ok ||
    typeof token !== 'string' ||
    typeof organizationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId) ||
    typeof membershipId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(membershipId) ||
    typeof expiresAt !== 'string' ||
    expiresAt.length !== 24 ||
    !Number.isFinite(now)
  )
    return null
  const expiry = Date.parse(expiresAt)
  if (
    !Number.isFinite(expiry) ||
    expiry <= now ||
    new Date(expiry).toISOString() !== expiresAt
  )
    return null
  return { recipientEmail, token, organizationId, membershipId, expiresAt }
}
