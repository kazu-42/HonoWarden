import { describe, expect, it, vi } from 'vitest'

import app from '../src/app'

const lifecyclePaths = [
  '/api/accounts/email-token',
  '/api/accounts/email',
  '/api/accounts/verify-email',
  '/api/accounts/verify-email-token',
  '/api/accounts',
  '/api/accounts/delete',
  '/api/accounts/delete-recover',
  '/api/accounts/delete-recover-token',
] as const

const lifecycleMutations = [
  ['POST', '/api/accounts/email-token'],
  ['POST', '/api/accounts/email'],
  ['POST', '/api/accounts/verify-email'],
  ['POST', '/api/accounts/verify-email-token'],
  ['DELETE', '/api/accounts'],
  ['POST', '/api/accounts/delete'],
  ['POST', '/api/accounts/delete-recover'],
  ['POST', '/api/accounts/delete-recover-token'],
] as const

describe('account lifecycle route gates', () => {
  it('keeps every lifecycle route default-off and D1-free, including HEAD', async () => {
    const prepare = vi.fn(() => {
      throw new Error('D1 must not be touched')
    })
    const database = { prepare } as unknown as D1Database

    for (const path of lifecyclePaths) {
      const response = await app.request(
        path,
        { method: 'HEAD' },
        { DB: database },
      )
      expect(response.status, `HEAD ${path}`).toBe(501)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    for (const [method, path] of lifecycleMutations) {
      const response = await app.request(path, { method }, { DB: database })
      expect(response.status, `${method} ${path}`).toBe(501)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails loudly and D1-free when enabled without secret or mailer', async () => {
    const prepare = vi.fn(() => {
      throw new Error('D1 must not be touched')
    })
    const response = await app.request(
      '/api/accounts/email-token',
      { method: 'POST' },
      {
        DB: { prepare } as unknown as D1Database,
        HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED: 'true',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'server_misconfigured' },
    })
    expect(prepare).not.toHaveBeenCalled()
  })
})
