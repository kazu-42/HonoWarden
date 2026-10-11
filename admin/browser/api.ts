import { AdminError } from './contracts'

export type FetchPort = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>
const errorCodes = new Set([
  'unsupported_feature',
  'invalid_request',
  'invalid_grant',
  'invalid_client',
  'missing_token',
  'invalid_token',
  'server_misconfigured',
  'database_unavailable',
  'organization_membership_unavailable',
  'invitation_delivery_unavailable',
  'organization_not_found',
  'membership_conflict',
  'organization_mfa_required',
  'mfa_required',
  'group_conflict',
  'group_not_found',
  'organization_groups_unavailable',
  'organization_policy_unavailable',
  'organization_audit_unavailable',
  'audit_export_too_large',
  'collection_not_found',
  'rate_limited',
  'reauth_required',
  'totp_session_required',
  'totp_not_enrolled',
  'recent_auth_required',
  'totp_code_invalid',
  'totp_unavailable',
  'authentication_required',
])
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new AdminError('unavailable', 'response_invalid')
  return value as Record<string, unknown>
}
export function string(value: unknown, max = 65_536): string {
  if (typeof value !== 'string' || value.length > max)
    throw new AdminError('unavailable', 'response_invalid')
  return value
}
export function id(value: unknown): string {
  const result = string(value, 128)
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(result))
    throw new AdminError('validation', 'identifier_invalid')
  return result
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10_000)
    throw new AdminError('unavailable', 'response_invalid')
  return value
}

async function readText(response: Response, max = 2_000_000): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let result = ''
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) {
        await reader.cancel()
        throw new AdminError('unavailable', 'response_invalid')
      }
      result += decoder.decode(value, { stream: true })
    }
    return result + decoder.decode()
  } catch (error) {
    if (error instanceof AdminError) throw error
    throw new AdminError('transport', 'response_unavailable')
  } finally {
    reader.releaseLock()
  }
}

export type ApiRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  form?: URLSearchParams
  token?: string
  signal: AbortSignal
  ifMatch?: string
  csv?: boolean
}
export function createApi(fetcher: FetchPort) {
  return async (
    path: string,
    input: ApiRequest,
  ): Promise<{ value: unknown; etag: string | null }> => {
    if (!/^\/(?:api|identity)\//.test(path) || /[\r\n#]/.test(path))
      throw new AdminError('validation', 'endpoint_invalid')
    const headers: Record<string, string> = {}
    if (input.token) headers.Authorization = `Bearer ${input.token}`
    if (input.ifMatch) headers['If-Match'] = input.ifMatch
    let body: string | undefined
    if (input.form) {
      body = input.form.toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else if (input.body !== undefined) {
      body = JSON.stringify(input.body)
      headers['Content-Type'] = 'application/json'
    }
    let response: Response
    try {
      response = await fetcher(path, {
        method: input.method ?? 'GET',
        headers,
        ...(body === undefined ? {} : { body }),
        signal: input.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      })
    } catch {
      if (input.signal.aborted && input.signal.reason instanceof AdminError)
        throw input.signal.reason
      throw new AdminError(
        input.signal.aborted ? 'cancelled' : 'transport',
        input.signal.aborted ? 'operation_cancelled' : 'request_unavailable',
      )
    }
    const text = await readText(response)
    let value: unknown
    if (input.csv && response.ok) {
      if (
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .startsWith('text/csv')
      )
        throw new AdminError('unavailable', 'response_invalid')
      return {
        value: new Blob([text], { type: 'text/csv;charset=utf-8' }),
        etag: null,
      }
    }
    try {
      value = text ? JSON.parse(text) : null
    } catch {
      throw new AdminError('unavailable', 'response_invalid')
    }
    if (!response.ok) {
      const data =
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {}
      const error =
        typeof data.error === 'object' && data.error !== null
          ? (data.error as Record<string, unknown>)
          : {}
      const proposedCode =
        typeof data.error === 'string' ? data.error : error.code
      const code =
        typeof proposedCode === 'string' && errorCodes.has(proposedCode)
          ? proposedCode
          : 'request_failed'
      const requestId = response.headers.get('X-Request-Id') ?? data.requestId
      const retryAfter = response.headers.get('Retry-After')
      const kind =
        response.status === 401 || code === 'invalid_grant'
          ? 'authentication'
          : response.status === 403
            ? 'authorization'
            : response.status === 404
              ? 'authorization'
              : response.status === 409
                ? 'conflict'
                : response.status === 429
                  ? 'rateLimit'
                  : response.status >= 500
                    ? 'unavailable'
                    : 'validation'
      const detail: ConstructorParameters<typeof AdminError>[2] = {
        httpStatus: response.status,
      }
      if (
        typeof requestId === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(requestId)
      )
        detail.requestId = requestId
      if (retryAfter && /^\d{1,6}$/.test(retryAfter))
        detail.retryAfterSeconds = Number(retryAfter)
      if (
        data.persisted === true &&
        code === 'invitation_delivery_unavailable'
      ) {
        detail.persisted = true
        if (
          Array.isArray(data.membershipIds) &&
          data.membershipIds.length <= 20 &&
          data.membershipIds.every(
            (entry) =>
              typeof entry === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(entry),
          )
        )
          detail.membershipIds = [...data.membershipIds] as string[]
      }
      const normalized = new AdminError(kind, code, detail)
      // Only the controller consumes this supported challenge, never UI state/errors.
      if (
        path === '/identity/connect/token' &&
        input.form?.get('grant_type') === 'password' &&
        response.status === 400 &&
        typeof data.TwoFactorToken === 'string' &&
        /^[A-Za-z0-9_-]{20,512}$/.test(data.TwoFactorToken)
      ) {
        if (
          !Array.isArray(data.TwoFactorProviders) ||
          !data.TwoFactorProviders.some(
            (provider: unknown) =>
              provider !== null &&
              typeof provider === 'object' &&
              (provider as Record<string, unknown>).type === 'totp',
          )
        )
          throw new AdminError('authentication', 'second_factor_unsupported')
        throw new TotpChallenge(data.TwoFactorToken)
      }
      throw normalized
    }
    return { value, etag: response.headers.get('ETag') }
  }
}

export class TotpChallenge extends Error {
  constructor(readonly token: string) {
    super('totp_required')
  }
}
