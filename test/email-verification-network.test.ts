import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createEmailIssuerResolver,
  EmailVerificationUnavailable,
} from '../src/email-verification'

const entry = {
  emailDomain: 'example.test',
  issuer: 'https://issuer.example.test',
  jwksUri: 'https://keys.example.test/jwks',
}
const question = '_email-verification.example.test'
const dns = {
  Status: 0,
  Question: [{ name: question, type: 16 }],
  Answer: [
    { name: question, type: 16, TTL: 120, data: '"iss=issuer.example.test"' },
  ],
}
const metadata = {
  issuer: entry.issuer,
  issuance_endpoint: 'https://issuer.example.test/issuance',
  jwks_uri: entry.jwksUri,
  signing_alg_values_supported: ['Ed25519', 'ES256'],
}
const jwks = {
  keys: [
    { kid: 'one', kty: 'OKP', crv: 'Ed25519', x: 'AQEB'.repeat(10) + 'AQE' },
  ],
}
afterEach(() => vi.useRealTimers())

describe('bounded EVP issuer discovery and trust', () => {
  it('independently resolves the exact TXT delegation and only fetches reviewed metadata/JWKS URLs', async () => {
    const fetcher = scripted([dns, metadata, jwks])
    const resolver = createEmailIssuerResolver(fetcher)
    expect(await resolver.resolve(entry)).toEqual({
      jwks,
      algorithms: ['Ed25519', 'ES256'],
    })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://cloudflare-dns.com/dns-query?name=_email-verification.example.test&type=TXT',
      `${entry.issuer}/.well-known/email-verification`,
      entry.jwksUri,
    ])
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET',
        redirect: 'error',
      })
      expect(new Headers(init?.headers).has('authorization')).toBe(false)
      expect(new Headers(init?.headers).has('cookie')).toBe(false)
    }
  })

  it.each([
    { ...dns, Status: 3 },
    {
      ...dns,
      Question: [{ name: '_email-verification.attacker.test', type: 16 }],
    },
    { ...dns, Answer: [{ ...dns.Answer[0], name: 'attacker.test' }] },
    { ...dns, Answer: [{ ...dns.Answer[0], type: 5 }] },
    { ...dns, Answer: [dns.Answer[0], dns.Answer[0]] },
    {
      ...dns,
      Answer: [{ ...dns.Answer[0], data: '"iss=attacker.example.test"' }],
    },
    { ...dns, Answer: [{ ...dns.Answer[0], data: '"iss=127.0.0.1"' }] },
  ])(
    'rejects unrelated, ambiguous, unsupported, or changed DNS delegation %#',
    async (invalid) => {
      const fetcher = scripted([invalid, metadata, jwks])
      await expect(
        createEmailIssuerResolver(fetcher).resolve(entry),
      ).rejects.toBeInstanceOf(EmailVerificationUnavailable)
      expect(fetcher).toHaveBeenCalledTimes(1)
    },
  )

  it('joins quoted TXT chunks only within one exact record', async () => {
    const fetcher = scripted([
      {
        ...dns,
        Answer: [{ ...dns.Answer[0], data: '"iss=" "issuer.example.test"' }],
      },
      metadata,
      jwks,
    ])
    expect(await createEmailIssuerResolver(fetcher).resolve(entry)).toEqual({
      jwks,
      algorithms: ['Ed25519', 'ES256'],
    })
  })

  it.each([
    { ...metadata, issuer: `${entry.issuer}/` },
    { ...metadata, jwks_uri: 'https://127.0.0.1/private' },
    { ...metadata, jwks_uri: 'https://attacker.example.test/keys' },
    { ...metadata, signing_alg_values_supported: ['EdDSA'] },
  ])(
    'rejects metadata identity/key URL/algorithm drift before following it %#',
    async (invalid) => {
      const fetcher = scripted([dns, invalid, jwks])
      await expect(
        createEmailIssuerResolver(fetcher).resolve(entry),
      ).rejects.toBeInstanceOf(EmailVerificationUnavailable)
      expect(fetcher).toHaveBeenCalledTimes(2)
    },
  )

  it('bounds stream bodies and rejects raw duplicate JSON members', async () => {
    for (const body of ['{"Status":0,"Status":0}', 'x'.repeat(65537)]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(body, {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await expect(
        createEmailIssuerResolver(fetcher).resolve(entry),
      ).rejects.toBeInstanceOf(EmailVerificationUnavailable)
    }
  })

  it('caches only successful bounded trust and never falls back to expired data on outage', async () => {
    let time = 0
    const fetcher = scripted([dns, metadata, jwks])
    const resolver = createEmailIssuerResolver(fetcher, () => time)
    await resolver.resolve(entry)
    await resolver.resolve(entry)
    expect(fetcher).toHaveBeenCalledTimes(3)
    time = 60001
    fetcher.mockRejectedValue(new Error('sensitive upstream exception'))
    await expect(resolver.resolve(entry)).rejects.toMatchObject({
      reason: 'issuer_unavailable',
    })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it.each([1, 5])(
    'expires a %s-second DNS delegation from receipt rather than after slow metadata/JWKS',
    async (ttl) => {
      let time = 0
      const fetcher = vi.fn<typeof fetch>()
      for (const [document, receivedAt] of [
        [{ ...dns, Answer: [{ ...dns.Answer[0], TTL: ttl }] }, 0],
        [metadata, 2000],
        [jwks, 4000],
      ] as const)
        fetcher.mockImplementationOnce(async () => {
          time = receivedAt
          return new Response(JSON.stringify(document), {
            headers: { 'Content-Type': 'application/json' },
          })
        })
      const resolver = createEmailIssuerResolver(fetcher, () => time)
      expect(await resolver.resolve(entry)).toEqual({
        jwks,
        algorithms: ['Ed25519', 'ES256'],
      })
      expect(fetcher).toHaveBeenCalledTimes(3)
      if (ttl === 5) {
        time = 4999
        await resolver.resolve(entry)
        expect(fetcher).toHaveBeenCalledTimes(3)
        time = 5000
      }
      fetcher.mockRejectedValueOnce(new Error('synthetic DNS outage'))
      await expect(resolver.resolve(entry)).rejects.toBeInstanceOf(
        EmailVerificationUnavailable,
      )
      expect(fetcher).toHaveBeenCalledTimes(4)
      expect(fetcher.mock.calls[3]![0]).toBe(
        'https://cloudflare-dns.com/dns-query?name=_email-verification.example.test&type=TXT',
      )
    },
  )

  it('cancels the active stream reader when a response body stalls past its timeout', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(body, { headers: { 'Content-Type': 'application/json' } }),
      )
    const outcome = createEmailIssuerResolver(fetcher)
      .resolve(entry)
      .catch((failure: unknown) => failure)
    await vi.advanceTimersByTimeAsync(0)
    expect(body.locked).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await outcome).toBeInstanceOf(EmailVerificationUnavailable)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
  })

  it('shares one five-second budget across DNS, metadata, and a stalled JWKS body', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetcher = vi.fn<typeof fetch>()
    for (const document of [dns, metadata])
      fetcher.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return new Response(JSON.stringify(document), {
          headers: { 'Content-Type': 'application/json' },
        })
      })
    fetcher.mockResolvedValueOnce(
      new Response(body, { headers: { 'Content-Type': 'application/json' } }),
    )
    let settled = false
    const outcome = createEmailIssuerResolver(fetcher)
      .resolve(entry)
      .catch((failure: unknown) => failure)
      .then((result) => {
        settled = true
        return result
      })
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(body.locked).toBe(true)
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(await outcome).toBeInstanceOf(EmailVerificationUnavailable)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
  })
})

function scripted(documents: unknown[]) {
  const fetcher = vi.fn<typeof fetch>()
  for (const document of documents)
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify(document), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  return fetcher
}
