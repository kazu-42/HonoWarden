export const accountCredentialPolicy = {
  authenticationHashMaxLength: 4096,
} as const

export type SecurityStampRotationRequest = {
  masterPasswordHash: string
}

export type SecurityStampRotationParseResult =
  ({ ok: true } & SecurityStampRotationRequest) | { ok: false }

export function parseSecurityStampRotationBody(
  body: unknown,
): SecurityStampRotationParseResult {
  if (
    !isPlainObject(body) ||
    body.otp !== undefined ||
    body.Otp !== undefined
  ) {
    return { ok: false }
  }

  const aliases = [body.masterPasswordHash, body.MasterPasswordHash].filter(
    (value) => value !== undefined,
  )
  if (
    aliases.length === 0 ||
    aliases.some((value) => typeof value !== 'string')
  ) {
    return { ok: false }
  }

  const masterPasswordHash = aliases[0] as string
  if (
    aliases.some((value) => value !== masterPasswordHash) ||
    masterPasswordHash.length === 0 ||
    masterPasswordHash.length >
      accountCredentialPolicy.authenticationHashMaxLength ||
    masterPasswordHash.trim() !== masterPasswordHash ||
    [...masterPasswordHash].some(isControlCharacter)
  ) {
    return { ok: false }
  }

  return { ok: true, masterPasswordHash }
}

export function nextCredentialRevisionDate(
  currentRevisionDate: string,
  candidateRevisionDate: string,
): string {
  const current = Date.parse(currentRevisionDate)
  const candidate = Date.parse(candidateRevisionDate)
  if (!Number.isFinite(current) || !Number.isFinite(candidate)) {
    throw new Error('credential revision dates must be valid')
  }

  return new Date(Math.max(candidate, current + 1)).toISOString()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return code <= 31 || code === 127
}
