export type MfaSessionActor = {
  userId: string
  deviceIdentifier: string
  sessionId: string
}

export type TotpSessionVerification = {
  credentialGeneration: string
  acceptedStep: number
}

export function isValidTotpSessionVerification(
  verification: TotpSessionVerification,
): boolean {
  return (
    typeof verification.credentialGeneration === 'string' &&
    verification.credentialGeneration.length > 0 &&
    verification.credentialGeneration.length <= 128 &&
    Number.isSafeInteger(verification.acceptedStep) &&
    verification.acceptedStep >= 0
  )
}

export function generateTotpCredentialGeneration(): string {
  return crypto.randomUUID()
}
