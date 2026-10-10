import { normalizeEmail } from './prelogin'

export type AccountRegistrationFields = {
  email: string
  displayName: string | null
  masterPasswordHash: string
  userKey: string
  publicKey: string
  privateKey: string
}

export const accountRegistrationFields = [
  'email',
  'displayName',
  'masterPasswordHash',
  'userKey',
  'publicKey',
  'privateKey',
] as const
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  value.trim() === value &&
  ![...value].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  )

// Each endpoint separately validates its complete field allowlist and authority.
export function parseAccountRegistrationFields(
  body: Record<string, unknown>,
): AccountRegistrationFields | null {
  const email =
    typeof body.email === 'string' && body.email.length <= 254
      ? normalizeEmail(body.email)
      : null
  if (
    !email ||
    !bounded(body.masterPasswordHash, 44) ||
    !/^[A-Za-z0-9+/]{43}=$/.test(body.masterPasswordHash) ||
    !bounded(body.userKey, 4096) ||
    !bounded(body.publicKey, 32768) ||
    !bounded(body.privateKey, 32768) ||
    (body.displayName !== undefined &&
      body.displayName !== null &&
      !bounded(body.displayName, 100))
  )
    return null
  if (btoa(atob(body.masterPasswordHash)) !== body.masterPasswordHash)
    return null
  return {
    email,
    displayName: typeof body.displayName === 'string' ? body.displayName : null,
    masterPasswordHash: body.masterPasswordHash,
    userKey: body.userKey,
    publicKey: body.publicKey,
    privateKey: body.privateKey,
  }
}
