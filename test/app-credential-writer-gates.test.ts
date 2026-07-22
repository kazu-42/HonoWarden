import { describe, expect, it } from 'vitest'

import app from '../src/app'

const disabledWriters = [
  {
    name: 'account-key initialization',
    path: '/api/accounts/keys',
    message: 'Account keys are not activated on this server.',
  },
  {
    name: 'password change',
    path: '/api/accounts/password',
    message: 'Password change is not activated on this server.',
  },
  {
    name: 'KDF mutation',
    path: '/api/accounts/kdf',
    message: 'KDF mutation is not activated on this server.',
  },
  {
    name: 'user-key rotation',
    path: '/api/accounts/key-management/rotate-user-account-keys',
    message: 'User-key rotation is not activated on this server.',
  },
] as const

const enabledPostOnlyWriters = [
  {
    name: 'password change',
    path: '/api/accounts/password',
    env: { HONOWARDEN_PASSWORD_CHANGE_ENABLED: 'true' },
  },
  {
    name: 'KDF mutation',
    path: '/api/accounts/kdf',
    env: { HONOWARDEN_KDF_MUTATION_ENABLED: 'true' },
  },
] as const

describe('credential writer rollout gates', () => {
  it.each(disabledWriters)(
    'keeps disabled $name POST and HEAD D1-free before global quota or auth',
    async ({ path, message }) => {
      for (const method of ['POST', 'HEAD'] as const) {
        const database = new ExplodingD1Database()
        const response = await app.request(
          path,
          {
            method,
            headers: { 'Content-Type': 'application/json' },
            ...(method === 'POST' ? { body: '{}' } : {}),
          },
          {
            DB: database as unknown as D1Database,
            HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true',
          },
        )

        expect(response.status).toBe(501)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        if (method === 'HEAD') {
          await expect(response.text()).resolves.toBe('')
        } else {
          await expect(response.json()).resolves.toMatchObject({
            error: {
              code: 'unsupported_feature',
              message,
            },
          })
        }
        expect(database.calls).toBe(0)
      }
    },
  )

  it.each(enabledPostOnlyWriters)(
    'keeps enabled $name GET and HEAD method-rejected with POST advertised',
    async ({ path, env }) => {
      for (const method of ['GET', 'HEAD'] as const) {
        const database = new ExplodingD1Database()
        const response = await app.request(
          path,
          { method },
          {
            DB: database as unknown as D1Database,
            ...env,
          },
        )

        expect(response.status).toBe(405)
        expect(response.headers.get('Allow')).toBe('POST')
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        await expect(response.text()).resolves.toBe('')
        expect(database.calls).toBe(0)
      }
    },
  )
})

class ExplodingD1Database {
  calls = 0

  prepare(): never {
    this.calls += 1
    throw new Error('D1 must not be called')
  }

  batch(): never {
    this.calls += 1
    throw new Error('D1 must not be called')
  }
}
