import { createDecipheriv, createHmac, pbkdf2Sync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createWrappedAccount } from '../admin/browser/crypto/account-registration'
import { createAdminClient } from '../admin/browser/admin-client'

describe('invited account creation', () => {
  it('produces interoperable encrypted account keys without returning raw key material', async () => {
    const email = 'new@example.test'
    const password = 'Public registration vector 2026!'
    const result = await createWrappedAccount(email, password)
    const master = pbkdf2Sync(password, email, 600000, 32, 'sha256')
    const stretch = Buffer.concat(
      ['enc', 'mac'].map((label) =>
        createHmac('sha256', master)
          .update(Buffer.concat([Buffer.from(label), Buffer.from([1])]))
          .digest(),
      ),
    )
    const decrypt = (key: Buffer, encoded: string) => {
      expect(encoded.startsWith('2.')).toBe(true)
      const [iv, ciphertext, mac] = encoded
        .slice(2)
        .split('|')
        .map((part) => Buffer.from(part, 'base64'))
      expect(
        createHmac('sha256', key.subarray(32))
          .update(iv!)
          .update(ciphertext!)
          .digest(),
      ).toEqual(mac)
      const cipher = createDecipheriv('aes-256-cbc', key.subarray(0, 32), iv!)
      return Buffer.concat([cipher.update(ciphertext!), cipher.final()])
    }
    expect(result.masterPasswordHash).toBe(
      pbkdf2Sync(master, password, 1, 32, 'sha256').toString('base64'),
    )
    const userKey = decrypt(stretch, result.userKey)
    expect(userKey.length).toBe(64)
    const privateKey = decrypt(userKey, result.privateKey)
    const imported = await crypto.subtle.importKey(
      'pkcs8',
      privateKey,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    )
    const publicKey = await crypto.subtle.importKey(
      'spki',
      Buffer.from(result.publicKey, 'base64'),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    )
    const plaintext = new Uint8Array([0, 1, 255, 128])
    expect(
      new Uint8Array(
        await crypto.subtle.decrypt(
          'RSA-OAEP',
          imported,
          await crypto.subtle.encrypt('RSA-OAEP', publicKey, plaintext),
        ),
      ),
    ).toEqual(plaintext)
    expect(Object.keys(result).sort()).toEqual([
      'masterPasswordHash',
      'privateKey',
      'publicKey',
      'userKey',
    ])
    expect(JSON.stringify(result)).not.toContain(password)
  })

  it('requires a captured invitation and never exposes its token in session state', async () => {
    const client = createAdminClient({
      lifecycle: false,
      fetch: async () => {
        throw new Error('Unexpected request')
      },
    })
    await expect(
      client.registerInvitedAccount({
        email: 'new@example.test',
        password: 'Public example password',
        displayName: 'New member',
      }),
    ).rejects.toMatchObject({ code: 'invitation_required' })
    client.dispose()
  })

  it('sends one encrypted registration request, keeps acceptance separate and disposes crypto', async () => {
    const requests: { path: string; body: string }[] = []
    let disposed = false
    const invitation = {
      organizationId: 'org',
      membershipId: 'member',
      token: 'a'.repeat(43),
    }
    const client = createAdminClient({
      lifecycle: false,
      invitation,
      crypto: () => ({
        call: async <T>() =>
          ({
            masterPasswordHash: 'derived-hash',
            userKey: 'wrapped-user',
            publicKey: 'spki',
            privateKey: 'wrapped-private',
          }) as T,
        dispose: () => {
          disposed = true
        },
      }),
      fetch: async (path, init) => {
        requests.push({ path: String(path), body: String(init?.body) })
        return new Response(
          JSON.stringify({ object: 'accountRegistration', created: true }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      },
    })
    await client.registerInvitedAccount({
      email: ' NEW@EXAMPLE.TEST ',
      password: 'Public example password',
      displayName: 'New member',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe('/api/accounts/register-invited')
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      email: 'new@example.test',
      invitation,
      masterPasswordHash: 'derived-hash',
    })
    expect(requests[0]!.body).not.toContain('Public example password')
    expect(client.getSession().phase).toBe('signedOut')
    expect(JSON.stringify(client.getSession())).not.toContain(invitation.token)
    expect(client.getSession().pendingInvitation).toBeDefined()
    expect(disposed).toBe(true)
    client.dispose()
  })

  it('returns to sign-in and clears the submitted password when worker creation fails', async () => {
    const fetch = vi.fn()
    const client = createAdminClient({
      lifecycle: false,
      invitation: {
        organizationId: 'org',
        membershipId: 'member',
        token: 'A'.repeat(43),
      },
      fetch,
      crypto: () => {
        throw new Error('Worker unavailable')
      },
    })
    const input = {
      email: 'new@example.test',
      password: 'Public example password',
      displayName: 'New member',
    }
    await expect(client.registerInvitedAccount(input)).rejects.toThrow(
      'Worker unavailable',
    )
    expect(input.password).toBe('')
    expect(client.getSession().phase).toBe('signedOut')
    expect(fetch).not.toHaveBeenCalled()
    client.dispose()
  })

  it('never submits late crypto results after logout cancels registration', async () => {
    let resolveCrypto!: (value: unknown) => void
    const deferred = new Promise<unknown>((resolve) => {
      resolveCrypto = resolve
    })
    const fetch = vi.fn()
    const dispose = vi.fn()
    const client = createAdminClient({
      lifecycle: false,
      invitation: {
        organizationId: 'org',
        membershipId: 'member',
        token: 'A'.repeat(43),
      },
      fetch,
      crypto: () => ({
        call: async <T>() => (await deferred) as T,
        dispose,
      }),
    })
    const input = {
      email: 'new@example.test',
      password: 'Public example password',
      displayName: 'New member',
    }
    const pending = client.registerInvitedAccount(input)
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'operation_cancelled',
    })
    expect(client.getSession().phase).toBe('authenticating')
    await client.logout()
    resolveCrypto({
      masterPasswordHash: 'derived-hash',
      userKey: 'wrapped-user',
      publicKey: 'spki',
      privateKey: 'wrapped-private',
    })
    await rejected
    expect(fetch).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(input.password).toBe('')
    expect(client.getSession()).toEqual({ phase: 'signedOut' })
    client.dispose()
  })
})
