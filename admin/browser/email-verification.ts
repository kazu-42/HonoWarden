import { id, record, string } from './api'
import { AdminError, type EmailVerificationAttempt } from './contracts'

type FormBinding = {
  form: HTMLFormElement
  emailInput: HTMLInputElement
  proofInput: HTMLInputElement
}
type VerificationPort = {
  email: string
  now(): number
  assertCurrent(): void
  register(dispose: () => void): () => void
  createChallenge(): Promise<unknown>
  verifyAndReadback(challengeId: string, token: string): Promise<void>
}

export async function prepareEmailVerification(
  input: FormBinding,
  port: VerificationPort,
): Promise<EmailVerificationAttempt> {
  const { form, emailInput, proofInput } = input
  if (
    emailInput.form !== form ||
    proofInput.form !== form ||
    emailInput.type !== 'email' ||
    emailInput.autocomplete !== 'email' ||
    proofInput.type !== 'hidden' ||
    proofInput.getAttribute('autocomplete') !== 'email-verification-token'
  )
    throw new AdminError('validation', 'email_verification_form_invalid')
  port.assertCurrent()
  proofInput.value = ''
  proofInput.removeAttribute('nonce')
  let active = true
  let challengeId = ''
  let expiresAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let unregister = () => {}
  const edited = () => {
    proofInput.value = ''
  }
  const dispose = () => {
    if (!active) return
    active = false
    challengeId = ''
    proofInput.value = ''
    proofInput.removeAttribute('nonce')
    emailInput.removeEventListener('input', edited)
    emailInput.removeEventListener('change', edited)
    clearTimeout(timer)
    unregister()
  }
  unregister = port.register(dispose)
  try {
    const row = record(await port.createChallenge())
    port.assertCurrent()
    if (!active || form.isConnected === false)
      throw new AdminError('cancelled', 'operation_cancelled')
    const origin = form.ownerDocument.location?.origin
    const audience = string(row.audience, 2048)
    const expiration = string(row.expiresAt, 64)
    const nonce = string(row.nonce, 43)
    const expiry = Date.parse(expiration)
    let canonicalOrigin = false
    try {
      canonicalOrigin =
        new URL(audience).origin === audience && audience.startsWith('https://')
    } catch {
      /* Invalid response is rejected below. */
    }
    if (
      Object.keys(row).length !== 7 ||
      row.object !== 'emailVerificationChallenge' ||
      row.protocol !== 'draft-hardt-email-verification-02' ||
      typeof row.challengeId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        row.challengeId,
      ) ||
      row.email !== port.email ||
      !canonicalOrigin ||
      audience !== origin ||
      !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(nonce) ||
      !Number.isFinite(expiry) ||
      new Date(expiry).toISOString() !== expiration ||
      expiry <= port.now() ||
      expiry > port.now() + 330_000
    )
      throw new AdminError('unavailable', 'response_invalid')
    challengeId = id(row.challengeId)
    expiresAt = expiry
    proofInput.setAttribute('nonce', nonce)
    emailInput.addEventListener('input', edited)
    emailInput.addEventListener('change', edited)
    timer = setTimeout(dispose, expiresAt - port.now())
    return {
      dispose,
      async submit() {
        if (!active) throw new AdminError('cancelled', 'operation_cancelled')
        const token = proofInput.value
        const currentChallenge = challengeId
        const matchesEmail =
          emailInput.value.trim().toLowerCase() === port.email
        dispose()
        port.assertCurrent()
        if (port.now() >= expiresAt)
          throw new AdminError('validation', 'email_verification_expired')
        if (!matchesEmail)
          throw new AdminError(
            'validation',
            'email_verification_email_mismatch',
          )
        if (!token) return { status: 'proofUnavailable' }
        if (token.length > 15 * 1024 || !/^[A-Za-z0-9_.~-]+$/.test(token))
          throw new AdminError('validation', 'email_verification_proof_invalid')
        await port.verifyAndReadback(currentChallenge, token)
        return { status: 'verified' }
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
