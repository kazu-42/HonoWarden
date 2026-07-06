import { describe, expect, it } from 'vitest'

import {
  normalizeEmail,
  parseAllowedEmails,
  resolvePrelogin,
} from '../../src/domain/prelogin'

describe('prelogin domain', () => {
  it('normalizes email addresses for allowlist matching', () => {
    expect(normalizeEmail(' Person@Example.Test ')).toBe('person@example.test')
    expect(normalizeEmail('missing-at')).toBeNull()
  })

  it('parses comma and whitespace separated allowed emails', () => {
    expect(
      parseAllowedEmails(
        'alice@example.test, Bob@Example.Test\ncarol@example.test',
      ),
    ).toEqual(
      new Set(['alice@example.test', 'bob@example.test', 'carol@example.test']),
    )
  })

  it('returns KDF parameters for an allowed email', () => {
    expect(
      resolvePrelogin({ email: 'Person@Example.Test' }, 'person@example.test'),
    ).toEqual({
      ok: true,
      response: {
        kdf: 0,
        kdfIterations: 600000,
        kdfMemory: null,
        kdfParallelism: null,
      },
    })
  })

  it('denies prelogin by default', () => {
    expect(
      resolvePrelogin({ email: 'person@example.test' }, undefined),
    ).toEqual({
      ok: false,
      status: 403,
      error: {
        code: 'prelogin_not_allowed',
        message: 'Prelogin is not available for this account.',
      },
    })
  })

  it('rejects malformed requests', () => {
    expect(resolvePrelogin({ email: '' }, 'person@example.test')).toEqual({
      ok: false,
      status: 400,
      error: {
        code: 'invalid_request',
        message: 'A valid email is required.',
      },
    })
  })
})
