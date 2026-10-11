export type AdminErrorKind =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'conflict'
  | 'unavailable'
  | 'rateLimit'
  | 'transport'
  | 'crypto'
  | 'cancelled'

export class AdminError extends Error {
  override readonly name = 'AdminError'
  readonly kind: AdminErrorKind
  readonly code: string
  readonly httpStatus?: number
  readonly requestId?: string
  readonly persisted?: true
  readonly membershipIds?: readonly string[]
  readonly retryAfterSeconds?: number
  constructor(
    kind: AdminErrorKind,
    code: string,
    detail: {
      httpStatus?: number
      requestId?: string
      persisted?: true
      membershipIds?: readonly string[]
      retryAfterSeconds?: number
    } = {},
  ) {
    super(code)
    this.kind = kind
    this.code = code
    Object.assign(this, detail)
  }
}
