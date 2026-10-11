import type { Context, Env, Hono } from 'hono'
import {
  isOrganizationAuditCursorSecret,
  isOrganizationAuditId,
  parseOrganizationAuditQuery,
} from './domain/organization-audit'
import {
  exportOrganizationAuditHistory,
  queryOrganizationAuditHistory,
} from './organization-audit'
import type { OrganizationPolicyActor } from './repositories/organization-policy-sql'

type Operation = 'query' | 'export'
export type OrganizationAuditRuntime = {
  enabled: boolean
  database: D1Database
  cursorSecret?: string
  optionalAuditLoggingEnabled: boolean
}

export type OrganizationAuditRouteDependencies<E extends Env> = {
  authenticate: (
    context: Context<E>,
  ) => Promise<
    | { ok: true; actor: OrganizationPolicyActor }
    | { ok: false; response: Response }
  >
  runtime: (context: Context<E>) => OrganizationAuditRuntime
  requestId: (context: Context<E>) => string
  now?: () => string
  reportFailure: (
    context: Context<E>,
    failure: {
      code: 'server_misconfigured' | 'organization_audit_unavailable'
      operation: Operation
    },
  ) => void | Promise<void>
}

export function registerOrganizationAuditRoutes<E extends Env>(
  app: Hono<E>,
  dependencies: OrganizationAuditRouteDependencies<E>,
): void {
  const route =
    (operation: Operation) =>
    async (c: Context<E>): Promise<Response> => {
      c.header('Cache-Control', 'no-store')
      c.header('X-Content-Type-Options', 'nosniff')
      const error = (
        code: string,
        message: string,
        status: 400 | 404 | 413 | 501 | 503,
      ) =>
        c.json(
          { error: { code, message }, requestId: dependencies.requestId(c) },
          status,
        )
      try {
        const runtime = dependencies.runtime(c)
        if (!runtime.enabled)
          return error(
            'unsupported_feature',
            'Organization audit history is unavailable on this server.',
            501,
          )
        const auth = await dependencies.authenticate(c)
        if (!auth.ok) return auth.response
        if (!isOrganizationAuditCursorSecret(runtime.cursorSecret)) {
          await dependencies.reportFailure(c, {
            code: 'server_misconfigured',
            operation,
          })
          return error(
            'server_misconfigured',
            'Organization audit runtime is not configured.',
            503,
          )
        }
        const organizationId = c.req.param('id') ?? ''
        if (!isOrganizationAuditId(organizationId))
          return error(
            'invalid_request',
            'Organization audit identifier is invalid.',
            400,
          )
        const parsed = await parseOrganizationAuditQuery(c.req.queries(), {
          operation,
          organizationId,
          actorUserId: auth.actor.userId,
          now: dependencies.now?.() ?? new Date().toISOString(),
          cursorSecret: runtime.cursorSecret,
        })
        if (!parsed.ok)
          return error(
            'invalid_request',
            'Organization audit query is invalid.',
            400,
          )
        const input = {
          organizationId,
          actor: auth.actor,
          query: parsed.value,
          cursorSecret: runtime.cursorSecret,
          optionalAuditLoggingEnabled: runtime.optionalAuditLoggingEnabled,
        }
        if (operation === 'query') {
          const result = await queryOrganizationAuditHistory(
            runtime.database,
            input,
          )
          if (result.status === 'success') return c.json(result.body)
          return error(
            'organization_not_found',
            'Organization was not found.',
            404,
          )
        }
        const result = await exportOrganizationAuditHistory(
          runtime.database,
          input,
        )
        if (result.status === 'not_found')
          return error(
            'organization_not_found',
            'Organization was not found.',
            404,
          )
        if (result.status === 'export_too_large')
          return error(
            'audit_export_too_large',
            'Audit export exceeds 1,000 rows. Narrow the time range or filters.',
            413,
          )
        c.header('Content-Type', 'text/csv; charset=utf-8')
        c.header(
          'Content-Disposition',
          'attachment; filename="honowarden-organization-audit.csv"',
        )
        c.header(
          'X-HonoWarden-Audit-Coverage',
          'committed-organization-administration;partial',
        )
        c.header(
          'X-HonoWarden-Audit-Optional-Logging',
          runtime.optionalAuditLoggingEnabled ? 'enabled' : 'disabled',
        )
        c.header('X-HonoWarden-Audit-From', result.from)
        c.header('X-HonoWarden-Audit-To', result.to)
        c.header('X-HonoWarden-Audit-Rows', String(result.rowCount))
        c.header('X-HonoWarden-Audit-Retention-Days', '365')
        return c.body(result.csv)
      } catch {
        await dependencies.reportFailure(c, {
          code: 'organization_audit_unavailable',
          operation,
        })
        return error(
          'organization_audit_unavailable',
          'Organization audit history is unavailable.',
          503,
        )
      }
    }
  app.get('/api/organizations/:id/audit-events', route('query'))
  app.get('/api/organizations/:id/audit-events/export', route('export'))
}
