import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertMutationState,
  assertR2Snapshot,
  currentCliEnvironment,
  verifyCurrentCliBinary,
} from '../../scripts/honowarden-current-cli-smoke.mjs'

describe('current official CLI smoke boundaries', () => {
  it('rejects unrelated R2 loss, changed body, extra keys, and incomplete inventories', () => {
    const snapshot = {
      keys: ['synthetic-unrelated-object'],
      truncated: false,
      cursor: null,
      bodySha256: 'synthetic-digest',
    }
    expect(() =>
      assertR2Snapshot(
        snapshot,
        'synthetic-unrelated-object',
        'synthetic-digest',
      ),
    ).not.toThrow()
    for (const invalid of [
      { ...snapshot, keys: [] },
      { ...snapshot, bodySha256: 'changed-digest' },
      { ...snapshot, keys: [...snapshot.keys, 'extra-object'] },
      { ...snapshot, truncated: true, cursor: 'more' },
    ]) {
      expect(() =>
        assertR2Snapshot(
          invalid,
          'synthetic-unrelated-object',
          'synthetic-digest',
        ),
      ).toThrow('local R2 sentinel identity changed')
    }
  })
  const expected = {
    itemName: 'synthetic-name',
    itemNotes: 'synthetic-notes',
    itemUsername: 'synthetic-username',
    itemPassword: 'synthetic-password',
    itemUri: 'https://synthetic.example.invalid',
  }
  const item = {
    id: 'synthetic-item',
    name: expected.itemName,
    notes: expected.itemNotes,
    login: {
      username: expected.itemUsername,
      password: expected.itemPassword,
      uris: [{ uri: expected.itemUri }],
    },
  }

  it('rejects stale sync presence after deletion and misplaced trash after restoration', () => {
    expect(() =>
      assertMutationState([item], [], item.id, 'absent', expected),
    ).toThrow('permanent deletion state mismatch')
    expect(() =>
      assertMutationState(
        [],
        [{ ...item, deletedDate: '2026-10-03T00:00:00Z' }],
        item.id,
        'present',
        expected,
      ),
    ).toThrow('active mutation state mismatch')
    expect(() =>
      assertMutationState([item], [], item.id, 'trash', expected),
    ).toThrow('trash mutation state mismatch')
  })

  it('requires exact decrypted fields and a deletion timestamp in trashed readback', () => {
    expect(() =>
      assertMutationState(
        [{ ...item, name: 'stale-name' }],
        [],
        item.id,
        'present',
        expected,
      ),
    ).toThrow('decrypted field equality failed')
    expect(() =>
      assertMutationState([], [item], item.id, 'trash', expected),
    ).toThrow('trash mutation state mismatch')
    expect(() =>
      assertMutationState([], [], item.id, 'absent', expected),
    ).not.toThrow()
  })

  it('rejects substituted binaries before executing them without reflecting contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'current-cli-integrity-'))
    try {
      const binary = join(root, 'bw')
      await writeFile(binary, 'synthetic-sensitive-substitution', {
        mode: 0o700,
      })
      await expect(verifyCurrentCliBinary(binary)).rejects.toThrow(
        'current CLI binary digest mismatch',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a symlink before binary inspection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'current-cli-symlink-'))
    try {
      await writeFile(join(root, 'actual'), 'substitution', { mode: 0o700 })
      await symlink(join(root, 'actual'), join(root, 'bw'))
      await expect(verifyCurrentCliBinary(join(root, 'bw'))).rejects.toThrow(
        'current CLI binary must be a regular file',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('isolates profile and trust while excluding ambient credentials and TLS bypasses', () => {
    const root = { absolute: '/synthetic/private/run' }
    const env = currentCliEnvironment(root, '/synthetic/private/run/ca.pem', {
      PATH: '/usr/bin',
      HOME: '/normal/home',
      BW_PASSWORD: 'ambient-password',
      BW_SESSION: 'ambient-session',
      CLOUDFLARE_API_TOKEN: 'ambient-cloud-token',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_EXTRA_CA_CERTS: '/ambient/trust.pem',
    })
    expect(env.HOME).toBe('/synthetic/private/run/home')
    expect(env[['BIT', 'WARDENCLI_APPDATA_DIR'].join('')]).toBe(
      '/synthetic/private/run/profile',
    )
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/synthetic/private/run/ca.pem')
    expect(env).not.toHaveProperty('BW_PASSWORD')
    expect(env).not.toHaveProperty('BW_SESSION')
    expect(env).not.toHaveProperty('CLOUDFLARE_API_TOKEN')
    expect(env).not.toHaveProperty('NODE_TLS_REJECT_UNAUTHORIZED')
  })
})
