import { beforeAll, describe, expect, it } from 'vitest'

import {
  emailVerificationPolicy,
  hashEmailVerificationNonce,
  parseEmailVerificationProof,
  resolveEmailVerificationRuntimePolicy,
  verifyEmailVerificationProof,
} from '../../src/domain/email-verification'

const issuer = 'https://issuer.example.test'
const audience = 'https://vault.example.test'
const email = 'owner@example.test'
const nonce = 'AQEB'.repeat(10) + 'AQE'
const now = 1_791_072_000
type Algorithm = 'Ed25519' | 'ES256'
const keys = new Map<Algorithm, CryptoKeyPair>()
const publicKeys = new Map<Algorithm, JsonWebKey>()
const holderKeys = new Map<Algorithm, CryptoKeyPair>()
const holderPublicKeys = new Map<Algorithm, JsonWebKey>()

beforeAll(async () => {
  for (const algorithm of ['Ed25519', 'ES256'] as const) {
    const pair = (await crypto.subtle.generateKey(
      algorithm === 'Ed25519'
        ? { name: 'Ed25519' }
        : { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    keys.set(algorithm, pair)
    publicKeys.set(algorithm, {
      ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey),
      alg: algorithm,
    })
    const holderPair = (await crypto.subtle.generateKey(
      algorithm === 'Ed25519'
        ? { name: 'Ed25519' }
        : { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    holderKeys.set(algorithm, holderPair)
    holderPublicKeys.set(algorithm, {
      ...((await crypto.subtle.exportKey(
        'jwk',
        holderPair.publicKey,
      )) as JsonWebKey),
      alg: algorithm,
    })
  }
})

describe('draft-02 Email Verification Protocol relying-party profile', () => {
  it('stays disabled without reading unconfigured issuer policy', () => {
    expect(resolveEmailVerificationRuntimePolicy({})).toEqual({
      status: 'disabled',
      enabled: false,
    })
  })

  it('requires a canonical HTTPS RP origin and exact trusted public issuer/JWKS registry', () => {
    const ready = resolveEmailVerificationRuntimePolicy(configuration())
    expect(ready.status).toBe('ready')
    for (const overrides of [
      { HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN: `${audience}/` },
      { HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN: 'http://vault.example.test' },
      {
        HONOWARDEN_EMAIL_VERIFICATION_ISSUERS:
          '[{"emailDomain":"example.test","issuer":"https://127.0.0.1","jwksUri":"https://127.0.0.1/keys"}]',
      },
      {
        HONOWARDEN_EMAIL_VERIFICATION_ISSUERS:
          '[{"emailDomain":"example.test","issuer":"https://issuer.example.test","jwksUri":"https://keys.example.test/keys?url=private"}]',
      },
      {
        HONOWARDEN_EMAIL_VERIFICATION_ISSUERS:
          '[{"emailDomain":"example.test","emailDomain":"other.test","issuer":"https://issuer.example.test","jwksUri":"https://keys.example.test/keys"}]',
      },
    ])
      expect(
        resolveEmailVerificationRuntimePolicy({
          ...configuration(),
          ...overrides,
        }).status,
      ).toBe('misconfigured')
  })

  it.each<Algorithm>(['Ed25519', 'ES256'])(
    'accepts actual %s issuer and holder signatures without requiring optional exp',
    async (algorithm) => {
      const token = await proof({ algorithm })
      expect(
        await verifyEmailVerificationProof(token, await context(algorithm)),
      ).toEqual({ ok: true })
      expect(parseEmailVerificationProof(token)).toEqual({
        issuer,
        email,
        nonce,
      })
    },
  )

  it('hashes the raw issuer JWT including its trailing tilde', async () => {
    const token = await proof({ hashWithoutTilde: true })
    expect(await verifyEmailVerificationProof(token, await context())).toEqual({
      ok: false,
    })
  })

  it.each([
    { issuerClaims: { email: 'Owner@example.test' } },
    { issuerClaims: { email_verified: 'true' } },
    { issuerClaims: { iss: 'https://attacker.example.test' } },
    { issuerClaims: { iat: now - 301 } },
    { issuerClaims: { iat: now + 31 } },
    { issuerClaims: { exp: now } },
    { issuerClaims: { exp: 'future' } },
    { issuerClaims: { _sd: [] } },
    { issuerClaims: { _sd_alg: 'sha-256' } },
    { bindingClaims: { aud: `${audience}/` } },
    { bindingClaims: { aud: [audience] } },
    { bindingClaims: { nonce: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI' } },
    { bindingClaims: { iat: now - 301 } },
    { bindingClaims: { iat: now + 31 } },
    { bindingClaims: { exp: now - 1 } },
    { issuerHeader: { typ: 'JWT' } },
    { issuerHeader: { alg: 'EdDSA' } },
    { issuerHeader: { alg: 'none' } },
    { issuerHeader: { jku: 'https://attacker.example.test/keys' } },
    { issuerHeader: { crit: [] } },
    { bindingHeader: { typ: 'JWT' } },
    { bindingHeader: { alg: 'ES256' } },
    { holderKey: { d: 'private-key' } },
    { holderKey: { alg: 'EdDSA' } },
    { holderKey: { crv: 'Ed448' } },
  ])(
    'rejects independently signed invalid protocol claims %#',
    async (overrides) => {
      expect(
        await verifyEmailVerificationProof(
          await proof(overrides),
          await context(),
        ),
      ).toEqual({ ok: false })
    },
  )

  it('rejects issuer or holder signature tampering, extra disclosures, and noncanonical compact encodings', async () => {
    const token = await proof()
    const [evt, kb] = token.split('~')
    const sections = evt!.split('.')
    const signature = decode(sections[2]!)
    signature[0] = signature[0]! ^ 1
    sections[2] = encode(signature)
    const holderSections = kb!.split('.')
    const holderSignature = decode(holderSections[2]!)
    holderSignature[0] = holderSignature[0]! ^ 1
    holderSections[2] = encode(holderSignature)
    for (const invalid of [
      `${sections.join('.')}~${kb}`,
      `${evt}~${holderSections.join('.')}`,
      `${evt}~disclosure~${kb}`,
      `${evt}~${kb}~`,
      `${evt}=~${kb}`,
      'a'.repeat(emailVerificationPolicy.maxTokenBytes + 1),
    ])
      expect(
        await verifyEmailVerificationProof(invalid, await context()),
      ).toEqual({ ok: false })
  })

  it('rejects duplicate members and ambiguous signing key IDs', async () => {
    const raw =
      '{"alg":"Ed25519","alg":"Ed25519","kid":"issuer-key","typ":"evt+jwt"}'
    const token = await proof({ rawIssuerHeader: raw })
    expect(parseEmailVerificationProof(token)).toBeNull()
    const valid = await proof()
    const expected = await context()
    expect(
      await verifyEmailVerificationProof(valid, {
        ...expected,
        jwks: {
          keys: [publicKeys.get('Ed25519'), publicKeys.get('Ed25519')].map(
            (key) => ({ ...key, kid: 'issuer-key' }),
          ),
        },
      }),
    ).toEqual({ ok: false })
  })

  it('requires the issuer key algorithm and curve to match the signed header', async () => {
    const expected = await context()
    const token = await proof()
    expect(
      await verifyEmailVerificationProof(token, {
        ...expected,
        jwks: {
          keys: [
            { ...publicKeys.get('Ed25519'), kid: 'issuer-key', alg: 'ES256' },
          ],
        },
      }),
    ).toEqual({ ok: false })
  })

  it('accepts an issuer JWK without optional alg while requiring the holder key alg', async () => {
    const expected = await context()
    const issuerPublic = { ...publicKeys.get('Ed25519'), kid: 'issuer-key' }
    delete issuerPublic.alg
    expect(
      await verifyEmailVerificationProof(await proof(), {
        ...expected,
        jwks: { keys: [issuerPublic] },
      }),
    ).toEqual({ ok: true })
    expect(
      await verifyEmailVerificationProof(
        await proof({ holderKey: { alg: undefined } }),
        expected,
      ),
    ).toEqual({ ok: false })
  })

  it('accepts different supported issuer and holder algorithms and finite fractional NumericDate', async () => {
    expect(
      await verifyEmailVerificationProof(
        await proof({
          holderAlgorithm: 'ES256',
          issuerClaims: { iat: now - 0.5 },
          bindingClaims: { iat: now - 0.25 },
        }),
        await context(),
      ),
    ).toEqual({ ok: true })
  })
})

function configuration() {
  return {
    HONOWARDEN_EMAIL_VERIFICATION_ENABLED: 'true',
    HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN: audience,
    HONOWARDEN_EMAIL_VERIFICATION_ISSUERS: JSON.stringify([
      {
        emailDomain: 'example.test',
        issuer,
        jwksUri: 'https://keys.example.test/keys',
      },
    ]),
  }
}
async function context(algorithm: Algorithm = 'Ed25519') {
  return {
    issuer,
    email,
    audience,
    nonceDigest: await hashEmailVerificationNonce(nonce),
    nowUnixSeconds: now,
    jwks: { keys: [{ ...publicKeys.get(algorithm), kid: 'issuer-key' }] },
  }
}
type Overrides = {
  algorithm?: Algorithm
  holderAlgorithm?: Algorithm
  issuerClaims?: Record<string, unknown>
  bindingClaims?: Record<string, unknown>
  issuerHeader?: Record<string, unknown>
  bindingHeader?: Record<string, unknown>
  holderKey?: Record<string, unknown>
  rawIssuerHeader?: string
  hashWithoutTilde?: boolean
}
async function proof(overrides: Overrides = {}) {
  const algorithm = overrides.algorithm ?? 'Ed25519'
  const holderAlgorithm = overrides.holderAlgorithm ?? algorithm
  const holder = {
    ...holderPublicKeys.get(holderAlgorithm),
    ...overrides.holderKey,
  }
  const evt = await signed(
    overrides.rawIssuerHeader ??
      JSON.stringify({
        alg: algorithm,
        kid: 'issuer-key',
        typ: 'evt+jwt',
        ...overrides.issuerHeader,
      }),
    {
      iss: issuer,
      iat: now,
      email,
      email_verified: true,
      cnf: { jwk: holder },
      ...overrides.issuerClaims,
    },
    algorithm,
  )
  const hash = encode(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          `${evt}${overrides.hashWithoutTilde ? '' : '~'}`,
        ),
      ),
    ),
  )
  const kb = await signed(
    JSON.stringify({
      alg: holderAlgorithm,
      typ: 'kb+jwt',
      ...overrides.bindingHeader,
    }),
    {
      aud: audience,
      nonce,
      iat: now,
      sd_hash: hash,
      ...overrides.bindingClaims,
    },
    holderAlgorithm,
    true,
  )
  return `${evt}~${kb}`
}
async function signed(
  header: string,
  payload: Record<string, unknown>,
  algorithm: Algorithm,
  holder = false,
) {
  const input = `${encode(new TextEncoder().encode(header))}.${encode(new TextEncoder().encode(JSON.stringify(payload)))}`
  const signature = await crypto.subtle.sign(
    algorithm === 'Ed25519' ? 'Ed25519' : { name: 'ECDSA', hash: 'SHA-256' },
    (holder ? holderKeys : keys).get(algorithm)!.privateKey,
    new TextEncoder().encode(input),
  )
  return `${input}.${encode(new Uint8Array(signature))}`
}
function encode(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
function decode(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/')),
    (character) => character.charCodeAt(0),
  )
}
