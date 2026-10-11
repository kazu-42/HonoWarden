import { describe, expect, it } from 'vitest'
import app from '../src/app'
import { parseInitialSetup } from '../src/initial-setup'

const body = {
  email: 'first@example.test',
  displayName: 'First owner',
  masterPasswordHash: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))),
  userKey: '2.public-wrapped-key',
  publicKey: 'public-spki',
  privateKey: '2.public-wrapped-private-key',
}
describe('first account setup', () => {
  it('is default-off and rejects missing, weak, or wrong setup authorization before D1', async () => {
    for (const env of [
      {},
      { HONOWARDEN_INITIAL_SETUP_ENABLED: 'true' },
      {
        HONOWARDEN_INITIAL_SETUP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: 'weak',
      },
      {
        HONOWARDEN_INITIAL_SETUP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: 'public-synthetic-setup-code-of-32-bytes',
      },
    ]) {
      const response = await app.request(
        '/api/accounts/initial-setup',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-HonoWarden-Bootstrap-Token': 'wrong',
          },
          body: JSON.stringify(body),
        },
        env,
      )
      expect(response.status).toBe(403)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(JSON.stringify(await response.json())).not.toContain(body.email)
    }
  })
  it('accepts only wrapped registration material, never a password, invitation, or authority override', () => {
    expect(parseInitialSetup(body)).toMatchObject(body)
    for (const value of [
      { ...body, password: 'do-not-send-password' },
      { ...body, invitation: {} },
      { ...body, role: 0 },
      { ...body, emailVerified: true },
      { ...body, masterPasswordHash: 'invalid' },
      { ...body, userKey: '' },
    ])
      expect(parseInitialSetup(value)).toBeNull()
  })
})
