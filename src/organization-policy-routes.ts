import type { Context, Env, Hono } from 'hono'
import {
  listOrganizationPolicies,
  readOrganizationPolicy,
  readOrganizationPolicyImpact,
  updateOrganizationPolicy,
  type OrganizationPolicyActor,
  type OrganizationPolicyResult,
} from './organization-policy'

type Operation = 'list' | 'read' | 'impact' | 'update'
export type OrganizationPolicyRuntime = {
  enabled: boolean
  database: D1Database
}
export type OrganizationPolicyRouteDependencies<E extends Env> = {
  authenticate: (
    context: Context<E>,
  ) => Promise<
    | { ok: true; actor: OrganizationPolicyActor }
    | { ok: false; response: Response }
  >
  runtime: (context: Context<E>) => OrganizationPolicyRuntime
  requestId: (context: Context<E>) => string
  reportFailure: (
    context: Context<E>,
    failure: { code: 'organization_policy_unavailable'; operation: Operation },
  ) => void | Promise<void>
}

export function registerOrganizationPolicyRoutes<E extends Env>(
  app: Hono<E>,
  dependencies: OrganizationPolicyRouteDependencies<E>,
): void {
  const route =
    (operation: Operation) =>
    async (c: Context<E>): Promise<Response> => {
      c.header('Cache-Control', 'no-store')
      const error = (
        code: string,
        message: string,
        status: 400 | 403 | 404 | 501 | 503,
      ) =>
        c.json(
          { error: { code, message }, requestId: dependencies.requestId(c) },
          status,
        )
      const runtime = dependencies.runtime(c)
      if (!runtime.enabled)
        return error(
          'unsupported_feature',
          'Organization policy management is unavailable on this server.',
          501,
        )
      try {
        const auth = await dependencies.authenticate(c)
        if (!auth.ok) {
          const headers = new Headers(auth.response.headers)
          headers.set('Cache-Control', 'no-store')
          return new Response(auth.response.body, {
            status: auth.response.status,
            statusText: auth.response.statusText,
            headers,
          })
        }
        const organizationId = c.req.param('id') ?? ''
        if (
          !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId) ||
          Object.keys(c.req.queries()).length > 0
        )
          return error(
            'invalid_request',
            'Organization policy identifier or query is invalid.',
            400,
          )
        const rawType = c.req.param('type')
        let policyType = 0
        if (rawType !== undefined) {
          if (
            !/^(0|[1-9]\d*)$/.test(rawType) ||
            !Number.isSafeInteger(Number(rawType))
          )
            return error(
              'invalid_request',
              'Organization policy type is invalid.',
              400,
            )
          policyType = Number(rawType)
          if (policyType !== 0)
            return error(
              'unsupported_feature',
              'This organization policy type is unavailable on this server.',
              501,
            )
        }
        const input = { actor: auth.actor, organizationId }
        let result: OrganizationPolicyResult
        switch (operation) {
          case 'list':
            result = await listOrganizationPolicies(runtime.database, input)
            break
          case 'read':
            result = await readOrganizationPolicy(runtime.database, input)
            break
          case 'impact':
            result = await readOrganizationPolicyImpact(runtime.database, input)
            break
          case 'update': {
            const body = await readPolicyBody(c.req.raw)
            if (!body.ok)
              return error(
                'invalid_request',
                'Organization policy payload is invalid.',
                400,
              )
            result = await updateOrganizationPolicy(runtime.database, {
              ...input,
              body: body.value,
              policyType,
              now: new Date().toISOString(),
              requestId: dependencies.requestId(c),
            })
            break
          }
        }
        switch (result.status) {
          case 'success':
            return c.json(result.body)
          case 'invalid_request':
            return error(
              'invalid_request',
              'Organization policy payload is invalid.',
              400,
            )
          case 'unsupported_feature':
            return error(
              'unsupported_feature',
              'Requested organization policy configuration is unavailable.',
              501,
            )
          case 'not_found':
            return error(
              'organization_not_found',
              'Organization policy was not found.',
              404,
            )
          case 'mfa_required':
            return error(
              'organization_mfa_required',
              'Verify TOTP for this session before changing this organization policy.',
              403,
            )
        }
      } catch {
        await dependencies.reportFailure(c, {
          code: 'organization_policy_unavailable',
          operation,
        })
        return error(
          'organization_policy_unavailable',
          'Organization policy operation failed.',
          503,
        )
      }
    }
  app.get('/api/organizations/:id/policies', route('list'))
  app.get('/api/organizations/:id/policies/:type/impact', route('impact'))
  app.get('/api/organizations/:id/policies/:type', route('read'))
  app.put('/api/organizations/:id/policies/:type', route('update'))
}

// Policy writers reject raw duplicate keys, including differently escaped keys.
// JSON.parse alone loses exact duplicates before the domain parser sees them.
async function readPolicyBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const maximumBytes = 4_096
  const contentLength = request.headers.get('Content-Length')
  if (
    !request.body ||
    (contentLength !== null &&
      (!/^\d+$/.test(contentLength) ||
        !Number.isSafeInteger(Number(contentLength)) ||
        Number(contentLength) > maximumBytes))
  ) {
    await request.body?.cancel().catch(() => undefined)
    return { ok: false }
  }
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  const chunks: string[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false }
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }))
    }
    chunks.push(decoder.decode())
    const raw = chunks.join('')
    const value: unknown = JSON.parse(raw)
    const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]/gu) ?? []
    let depth = 0
    const keys = new Set<string>()
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token === '{' || token === '[') depth += 1
      else if (token === '}' || token === ']') depth -= 1
      else if (
        depth === 1 &&
        token?.startsWith('"') &&
        tokens[index + 1] === ':'
      ) {
        const key = (JSON.parse(token) as string).toLowerCase()
        if (keys.has(key)) return { ok: false }
        keys.add(key)
      }
    }
    return { ok: true, value }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { ok: false }
  } finally {
    reader.releaseLock()
  }
}
