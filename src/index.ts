import app from './app'
import type { Bindings } from './bindings'
import { isAuditLoggingEnabled } from './domain/audit'
import { isAuthRequestFeatureEnabled } from './domain/auth-request'
import { isGlobalRequestQuotaEnabled } from './domain/request-quota'
import { handleInquiryEmail } from './inquiry-email'
import { cleanupTransientAuthData } from './maintenance/retention-cleanup'

export { NotificationHub } from './notification-hub'

export default {
  fetch(request: Request, env: Bindings, context: ExecutionContext) {
    return app.fetch(request, env, context)
  },
  scheduled(
    controller: ScheduledController,
    env: Bindings,
    context: ExecutionContext,
  ) {
    const cleanup = cleanupTransientAuthData(
      env.DB,
      new Date(controller.scheduledTime).toISOString(),
      {
        auditEvents: isAuditLoggingEnabled(env.HONOWARDEN_AUDIT_LOGS),
        authRequests: isAuthRequestFeatureEnabled(
          env.HONOWARDEN_AUTH_REQUESTS_ENABLED,
        ),
        requestQuotaBuckets:
          isGlobalRequestQuotaEnabled(env.HONOWARDEN_GLOBAL_REQUEST_QUOTA) ||
          isAuthRequestFeatureEnabled(env.HONOWARDEN_AUTH_REQUESTS_ENABLED),
      },
    )

    context.waitUntil(cleanup)

    return cleanup
  },
  email(message: ForwardableEmailMessage, env: Bindings) {
    return handleInquiryEmail(message, env)
  },
} satisfies ExportedHandler<Bindings>
