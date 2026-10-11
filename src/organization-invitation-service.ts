import { createOrganizationInvitationMailer } from './organization-invitation-mailer'
import { createCloudflareEmailSender } from './cloudflare-email-sender'

export type OrganizationInvitationServiceBindings = {
  HONOWARDEN_INVITATION_ADMIN_ORIGIN?: string
  HONOWARDEN_INVITATION_SENDER_EMAIL?: string
  EMAIL?: SendEmail
}

// A separate, service-binding-only Worker entrypoint. It must have no public
// routes, workers.dev endpoint, preview URLs, or inquiry/vault database binding.
export default {
  fetch(
    request: Request,
    env: OrganizationInvitationServiceBindings,
  ): Promise<Response> | Response {
    try {
      return createOrganizationInvitationMailer({
        adminOrigin: env.HONOWARDEN_INVITATION_ADMIN_ORIGIN ?? '',
        senderEmail: env.HONOWARDEN_INVITATION_SENDER_EMAIL ?? '',
        send: createCloudflareEmailSender(env.EMAIL),
      }).fetch(request)
    } catch {
      console.error(
        JSON.stringify({
          event: 'organization_invitation_configuration_failed',
        }),
      )
      return new Response(null, {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      })
    }
  },
}
