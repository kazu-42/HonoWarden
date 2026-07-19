import app from './app'
import type { Bindings } from './bindings'
import { isAuthRequestFeatureEnabled } from './domain/auth-request'
import { isGlobalRequestQuotaEnabled } from './domain/request-quota'
import { isRefreshTokenRetentionEnabled } from './domain/tokens'
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
        // Security-sensitive routes persist mandatory rows even when optional
        // audit emission is disabled, so retention must always run.
        auditEvents: true,
        authRequests: isAuthRequestFeatureEnabled(
          env.HONOWARDEN_AUTH_REQUESTS_ENABLED,
        ),
        refreshTokens: isRefreshTokenRetentionEnabled(
          env.HONOWARDEN_REFRESH_TOKEN_RETENTION_ENABLED,
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
