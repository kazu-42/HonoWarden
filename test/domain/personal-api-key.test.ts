import { describe, expect, it } from 'vitest'

import {
  buildPersonalApiKeyClientId,
  buildPersonalApiKeyVerifier,
  generatePersonalApiKeySecret,
  isPersonalApiKeyFeatureEnabled,
  parseApiKeyClientId,
  parsePersonalApiKeyClientId,
  personalApiKeyPolicy,
  verifyPersonalApiKeySecret,
} from '../../src/domain/personal-api-key'

const userId = '11111111-1111-4111-8111-111111111111'
const verifierSecret = '0123456789abcdef0123456789abcdef'

describe('personal API-key domain', () => {
  it('keeps the capability explicitly opt-in', () => {
    expect(isPersonalApiKeyFeatureEnabled(' TRUE ')).toBe(true)
    expect(isPersonalApiKeyFeatureEnabled('false')).toBe(false)
    expect(isPersonalApiKeyFeatureEnabled('yes')).toBe(false)
    expect(isPersonalApiKeyFeatureEnabled(undefined)).toBe(false)
  })

  it('builds and parses only official personal user client IDs', () => {
    expect(buildPersonalApiKeyClientId(userId)).toBe(`user.${userId}`)
    expect(parsePersonalApiKeyClientId(`user.${userId}`)).toBe(userId)
    expect(parseApiKeyClientId(`user.${userId}`)).toEqual({
      kind: 'user',
      userId,
    })
    expect(
      parseApiKeyClientId('organization.22222222-2222-4222-8222-222222222222'),
    ).toEqual({
      kind: 'organization',
      organizationId: '22222222-2222-4222-8222-222222222222',
    })
    expect(
      parsePersonalApiKeyClientId(
        'organization.22222222-2222-4222-8222-222222222222',
      ),
    ).toBeNull()
    expect(parsePersonalApiKeyClientId('user.not-a-uuid')).toBeNull()
    expect(parsePersonalApiKeyClientId(` user.${userId} `)).toBeNull()
  })

  it('generates a high-entropy URL-safe secret without an identifier prefix', () => {
    const first = generatePersonalApiKeySecret()
    const second = generatePersonalApiKeySecret()

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(first).toHaveLength(personalApiKeyPolicy.secretEncodedLength)
    expect(second).not.toBe(first)
    expect(first).not.toContain(userId)
  })

  it('uses a user-bound keyed verifier and never embeds raw secret material', async () => {
    const rawSecret = 'synthetic-personal-api-key-secret'
    const verifier = await buildPersonalApiKeyVerifier(
      verifierSecret,
      userId,
      rawSecret,
    )

    expect(verifier).toMatch(/^hmac-sha256:v1:[A-Za-z0-9_-]+$/)
    expect(verifier).not.toContain(rawSecret)
    expect(verifier).not.toContain(verifierSecret)
    await expect(
      verifyPersonalApiKeySecret(verifierSecret, userId, rawSecret, verifier),
    ).resolves.toBe(true)
    await expect(
      verifyPersonalApiKeySecret(
        verifierSecret,
        userId,
        'wrong-secret',
        verifier,
      ),
    ).resolves.toBe(false)
    await expect(
      verifyPersonalApiKeySecret(
        verifierSecret,
        '22222222-2222-4222-8222-222222222222',
        rawSecret,
        verifier,
      ),
    ).resolves.toBe(false)
  })

  it('rejects malformed verifier encodings without throwing', async () => {
    await expect(
      verifyPersonalApiKeySecret(
        verifierSecret,
        userId,
        'synthetic-personal-api-key-secret',
        'sha256:not-keyed',
      ),
    ).resolves.toBe(false)
  })
})
