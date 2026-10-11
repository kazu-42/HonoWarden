import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertCompanyGroupOnlyState,
  assertCompanyAttachmentBytes,
  collectCompanyRestoreObjectKeys,
  companyRestoreStorage,
  createCompanyNativeAttachment,
  establishCompanyGroupOnlyMember,
  isRestoredTotpChallenge,
  prepareCompanyRestoreResource,
  restoreCompanySnapshot,
  verifyCompanyNativeAttachment,
} from '../../scripts/honowarden-company-restore-smoke.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('current-company restore execution boundary', () => {
  it('collects a complete paginated attachment inventory without silently accepting missing objects', async () => {
    const keys = ['attachments/a', 'attachments/b']
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [{ key: keys[1] }],
        truncated: true,
        cursor: 'next',
      })
      .mockResolvedValueOnce({ objects: [{ key: keys[0] }], truncated: false })
    await expect(collectCompanyRestoreObjectKeys({ list }, 2)).resolves.toEqual(
      keys,
    )
    expect(list.mock.calls).toEqual([[{}], [{ cursor: 'next' }]])
    for (const page of [
      { objects: [], truncated: false },
      { objects: [{ key: keys[0] }, { key: keys[0] }], truncated: false },
      { objects: [{ key: 'attachments/bad\nkey' }], truncated: false },
      { objects: [{ key: keys[0] }], truncated: true },
    ])
      await expect(
        collectCompanyRestoreObjectKeys({ list: async () => page }, 1),
      ).rejects.toThrow('company_restore_inventory_invalid')
  })

  it('rejects a repeated cursor instead of looping on an incomplete inventory', async () => {
    let count = 0
    const list = async () => ({
      objects: [{ key: 'attachments/' + ++count }],
      truncated: true,
      cursor: 'same',
    })
    await expect(collectCompanyRestoreObjectKeys({ list }, 3)).rejects.toThrow(
      'company_restore_inventory_invalid',
    )
    expect(count).toBe(2)
  })

  it('requires an active ordinary member with no direct grant and the exact surviving group grant', () => {
    const state = {
      membership: { status: 2, type: 2, org_key: '3.synthetic-wrapped-key' },
      directGrants: [],
      groupGrants: [
        {
          group_id: 'group',
          collection_id: 'collection',
          read_only: 0,
          hide_passwords: 0,
          manage: 0,
        },
      ],
      groupId: 'group',
      collectionId: 'collection',
    }
    expect(() => assertCompanyGroupOnlyState(state)).not.toThrow()
    for (const replacement of [
      { membership: { ...state.membership, status: -1 } },
      { membership: { ...state.membership, type: 0 } },
      { membership: { ...state.membership, org_key: null } },
      { directGrants: [{ collection_id: 'collection' }] },
      { groupGrants: [] },
      { groupGrants: [{ ...state.groupGrants[0], collection_id: 'other' }] },
      { groupGrants: [{ ...state.groupGrants[0], read_only: 1 }] },
    ])
      expect(() =>
        assertCompanyGroupOnlyState({ ...state, ...replacement }),
      ).toThrow('company_restore_group_only_invalid')
  })

  it('compares exact binary attachment bytes, retaining trailing whitespace and zero bytes', () => {
    const bytes = Buffer.from([0, 255, 10, 32])
    // The expected digest is computed independently from the helper under test.
    const expected = {
      bytes: 4,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    expect(() => assertCompanyAttachmentBytes(bytes, expected)).not.toThrow()
    for (const wrong of [bytes.subarray(0, 3), Buffer.from([0, 255, 10, 33])])
      expect(() => assertCompanyAttachmentBytes(wrong, expected)).toThrow(
        'company_restore_attachment_decrypt_failed',
      )
  })

  it('creates a TOTP-assured surviving member through invitation, acceptance, confirmation and group APIs', async () => {
    const account = {
      email: 'survivor@example.invalid',
      hash: 'synthetic-password-hash',
    }
    const calls = []
    const api = async (...args) => {
      calls.push(args)
      if (args[0] === '/identity/connect/token')
        return { access_token: 'synthetic-bearer' }
      if (args[0].endsWith('/totp/setup')) return { secret: 'SYNTHETICFACTOR' }
      if (args[0].endsWith('/totp/setup/verify')) return { enabled: true }
      if (args[0].endsWith('/groups')) return { Id: 'group' }
    }
    const input = {
      api,
      account,
      ownerToken: 'synthetic-owner',
      organizationId: 'org',
      collectionId: 'collection',
      wrappedOrganizationKey: '3.synthetic-org-key',
      readInvitation: () => ({
        recipientEmail: account.email,
        membershipId: 'member',
        token: 'synthetic-invite',
      }),
      freshOtp: async (value) => {
        expect(value.factor).toBe('SYNTHETICFACTOR')
        return '123456'
      },
    }
    await expect(establishCompanyGroupOnlyMember(input)).resolves.toEqual({
      membershipId: 'member',
      groupId: 'group',
    })
    expect(calls.map(([path]) => path)).toEqual([
      '/identity/connect/token',
      '/identity/accounts/totp/setup',
      '/identity/accounts/totp/setup/verify',
      '/api/organizations/org/users/invite',
      '/api/organizations/org/users/member/accept',
      '/api/organizations/org/users/member/confirm',
      '/api/organizations/org/groups',
    ])
    expect(calls[3][2]).toEqual({
      emails: [account.email],
      type: 2,
      collections: [],
    })
    expect(calls[4][2]).toEqual({ token: 'synthetic-invite' })
    expect(calls[4][3]).toBe('synthetic-bearer')
    expect(calls[5][2]).toEqual({ key: '3.synthetic-org-key' })
    expect(calls[6][2]).toMatchObject({
      users: ['member'],
      collections: [
        {
          id: 'collection',
          readOnly: false,
          hidePasswords: false,
          manage: false,
        },
      ],
    })
    calls.length = 0
    await expect(
      establishCompanyGroupOnlyMember({
        ...input,
        readInvitation: () => ({ recipientEmail: 'wrong@example.invalid' }),
      }),
    ).rejects.toThrow('company_restore_invitation_missing')
    expect(calls.some(([path]) => path.endsWith('/accept'))).toBe(false)
  })

  it('does not invite or grant group access when MFA setup fails', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ access_token: 'synthetic-bearer' })
      .mockResolvedValueOnce({ secret: 'SYNTHETICFACTOR' })
      .mockResolvedValueOnce({ enabled: false })
    await expect(
      establishCompanyGroupOnlyMember({
        api,
        account: { email: 'survivor@example.invalid', hash: 'synthetic-hash' },
        freshOtp: async () => '123456',
      }),
    ).rejects.toThrow('company_restore_member_setup_failed')
    expect(api).toHaveBeenCalledTimes(3)
  })

  it('checks decrypted attachment metadata and actual CLI output bytes without logging the session or output path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'company-restore-attachment-'))
    roots.push(root)
    const bytes = Buffer.from([0, 255, 13, 10, 32])
    const attachment = {
      id: 'attachment',
      fileName: 'synthetic.bin',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    const cipher = {
      id: 'cipher',
      attachment,
      payload: { organizationId: null },
    }
    const item = {
      attachments: [{ id: attachment.id, fileName: attachment.fileName }],
    }
    const native = vi.fn(async (args, env) => {
      expect(args.slice(0, 6)).toEqual([
        'get',
        'attachment',
        'attachment',
        '--itemid',
        'cipher',
        '--output',
      ])
      expect(env).toEqual({ BW_SESSION: 'synthetic-session' })
      await writeFile(args[6], bytes)
    })
    const input = { root, cipher, item, native, session: 'synthetic-session' }
    await expect(verifyCompanyNativeAttachment(input)).resolves.toEqual({
      flow: 'personal_attachment_binary_decrypted',
      passed: true,
    })
    expect((await lstat(native.mock.calls[0][0][6])).mode & 0o777).toBe(0o600)
    native.mockClear()
    await expect(
      verifyCompanyNativeAttachment({
        ...input,
        item: { attachments: [{ id: 'attachment', fileName: 'wrong.bin' }] },
      }),
    ).rejects.toThrow('native_attachment_metadata_decrypt_failed')
    expect(native).not.toHaveBeenCalled()
    native.mockImplementation(async (args) =>
      writeFile(args[6], Buffer.from([0, 255, 13, 10, 33])),
    )
    await expect(verifyCompanyNativeAttachment(input)).rejects.toThrow(
      'company_restore_attachment_decrypt_failed',
    )
  })

  it('creates attachments only on the supported personal item and refuses organization items before I/O', async () => {
    const root = await mkdtemp(join(tmpdir(), 'company-restore-personal-'))
    roots.push(root)
    const cipher = { id: 'personal', payload: { organizationId: null } }
    let uploaded
    const native = vi.fn(async (args, env) => {
      expect(args.slice(0, 3)).toEqual(['create', 'attachment', '--file'])
      expect(args.slice(4)).toEqual(['--itemid', 'personal'])
      expect(env).toEqual({ BW_SESSION: 'synthetic-session' })
      uploaded = await readFile(args[3])
      expect([...uploaded.subarray(-4)]).toEqual([0, 255, 10, 32])
      return JSON.stringify({
        id: 'personal',
        attachments: [
          { id: 'attachment', fileName: 'synthetic-company-restore.bin' },
        ],
      })
    })
    await expect(
      createCompanyNativeAttachment({
        root,
        cipher: { ...cipher, payload: { organizationId: 'org' } },
        native,
        session: 'synthetic-session',
      }),
    ).rejects.toThrow('company_restore_attachment_requires_personal_cipher')
    expect(native).not.toHaveBeenCalled()
    await createCompanyNativeAttachment({
      root,
      cipher,
      native,
      session: 'synthetic-session',
    })
    expect(cipher.attachment).toEqual({
      id: 'attachment',
      fileName: 'synthetic-company-restore.bin',
      bytes: uploaded.length,
      sha256: createHash('sha256').update(uploaded).digest('hex'),
    })
  })

  it.each([0, 1])(
    'pins a nonempty inventory and refuses a restored object count of %s unless it matches',
    async (restoredCount) => {
      const root = await mkdtemp(join(tmpdir(), 'company-restore-inventory-'))
      roots.push(root)
      const source = await prepareCompanyRestoreResource(
        join(root, 'source'),
        'source',
      )
      const stopSource = vi.fn()
      const runBackup = vi.fn(async (args) => {
        if (args[0] === 'export') {
          expect(stopSource).toHaveBeenCalledOnce()
          expect(
            await readFile(args[args.indexOf('--r2-objects') + 1], 'utf8'),
          ).toBe('attachments/object')
          const backup = args[args.indexOf('--out') + 1]
          await mkdir(backup)
          await writeFile(
            join(backup, 'backup-manifest.json'),
            JSON.stringify({
              credentialGeneration: {
                manifestSha256:
                  args[args.indexOf('--generation-manifest-sha256') + 1],
                sourceStateSha256: 'b'.repeat(64),
              },
            }),
          )
          return { executed: true }
        }
        expect(args).toContain('--confirm-fresh-target')
        expect(args[args.indexOf('--expected-manifest-sha256') + 1]).toMatch(
          /^[a-f0-9]{64}$/,
        )
        return {
          executed: true,
          verification: {
            status: 'passed',
            sourceStateSha256: 'b'.repeat(64),
            r2ObjectCount: restoredCount,
          },
        }
      })
      const result = restoreCompanySnapshot({
        root,
        source,
        completedGeneration: {
          status: 'passed',
          sourceSha256: 'a'.repeat(64),
          checks: Array(14).fill({ passed: true }),
        },
        objectKeys: ['attachments/object'],
        stopSource,
        runBackup,
      })
      if (restoredCount === 1)
        await expect(result).resolves.toMatchObject({
          evidence: {
            restored: true,
            r2ObjectCount: 1,
            sourceTargetDistinct: true,
          },
        })
      else
        await expect(result).rejects.toThrow(
          'company_restore_verification_failed',
        )
    },
  )
  it('requires the numeric provider and parameter map without an early authenticated token', () => {
    const challenge = {
      error: 'invalid_grant',
      TwoFactorToken: 'synthetic-challenge',
      TwoFactorProviders: [0],
      TwoFactorProviders2: { 0: {} },
    }
    expect(isRestoredTotpChallenge(challenge)).toBe(true)
    for (const invalid of [
      { ...challenge, TwoFactorProviders: [{ type: 'totp' }] },
      { ...challenge, TwoFactorProviders2: undefined },
      { ...challenge, TwoFactorToken: '' },
      { ...challenge, access_token: 'unexpected-early-bearer' },
      { ...challenge, refresh_token: 'unexpected-early-refresh' },
    ])
      expect(isRestoredTotpChallenge(invalid)).toBe(false)
  })
  it('refuses incomplete company execution before stopping the source or invoking backup', async () => {
    const stopSource = vi.fn()
    const runBackup = vi.fn()
    for (const completedGeneration of [
      undefined,
      {
        status: 'failed',
        sourceSha256: 'a'.repeat(64),
        checks: Array(14).fill({ passed: true }),
      },
      {
        status: 'passed',
        sourceSha256: 'a'.repeat(64),
        checks: Array(13).fill({ passed: true }),
      },
      {
        status: 'passed',
        sourceSha256: 'a'.repeat(64),
        checks: [...Array(13).fill({ passed: true }), { passed: false }],
      },
    ])
      await expect(
        restoreCompanySnapshot({ completedGeneration, stopSource, runBackup }),
      ).rejects.toThrow('company_restore_source_not_completed')
    expect(stopSource).not.toHaveBeenCalled()
    expect(runBackup).not.toHaveBeenCalled()
  })

  it('uses separate private fresh resources with Wrangler-compatible storage and no runtime secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'company-restore-boundary-'))
    roots.push(root)
    const source = await prepareCompanyRestoreResource(
      join(root, 'source'),
      'source',
    )
    const target = await prepareCompanyRestoreResource(
      join(root, 'target'),
      'target',
    )
    expect(source.databaseId).not.toBe(target.databaseId)
    expect(source.bucketName).not.toBe(target.bucketName)
    expect(source.bucketName.length).toBeLessThanOrEqual(63)
    expect(target.bucketName.length).toBeLessThanOrEqual(63)
    expect(companyRestoreStorage(target).d1Persist).toBe(
      join(target.root, '.wrangler/state/v3/d1'),
    )
    for (const resource of [source, target]) {
      expect((await lstat(resource.root)).mode & 0o777).toBe(0o700)
      expect((await lstat(resource.persist)).mode & 0o777).toBe(0o700)
      expect((await lstat(resource.config)).mode & 0o777).toBe(0o600)
      const config = JSON.parse(await readFile(resource.config, 'utf8'))
      expect(config.vars).toBeUndefined()
      expect(config.d1_databases[0].database_id).toBe(resource.databaseId)
      expect(config.r2_buckets[0].bucket_name).toBe(resource.bucketName)
    }
    await expect(
      prepareCompanyRestoreResource(source.root, 'source'),
    ).rejects.toMatchObject({ code: 'EEXIST' })
  })
})
