import app from './app'
import type { Bindings } from './bindings'
import { cleanupTransientAuthData } from './maintenance/retention-cleanup'

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
    )

    context.waitUntil(cleanup)

    return cleanup
  },
}
