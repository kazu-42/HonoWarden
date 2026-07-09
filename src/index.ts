import app from './app'
import type { Bindings } from './bindings'
import { handleInboundInquiryEmail } from './email/inquiry-handler'
import { isAuditLoggingEnabled } from './domain/audit'
import { isGlobalRequestQuotaEnabled } from './domain/request-quota'
import { cleanupTransientAuthData } from './maintenance/retention-cleanup'

export default {
  fetch(request: Request, env: Bindings, context: ExecutionContext) {
    return app.fetch(request, env, context)
  },
  email(message: ForwardableEmailMessage, env: Bindings) {
    return handleInboundInquiryEmail(message, env)
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
        requestQuotaBuckets: isGlobalRequestQuotaEnabled(
          env.HONOWARDEN_GLOBAL_REQUEST_QUOTA,
        ),
      },
    )

    context.waitUntil(cleanup)

    return cleanup
  },
}
