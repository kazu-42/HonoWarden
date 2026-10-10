import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { URLSearchParams } from 'node:url'
import {
  credentialLifecycleStateOwnershipMarker,
  credentialLifecycleStateOwnershipMarkerBody,
  writeCredentialLifecycleCompletionAttestation,
} from './honowarden-credential-lifecycle-state.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export async function collectCompanyRestoreObjectKeys(bucket, expectedCount) {
  const keys = new Set()
  const cursors = new Set()
  let cursor
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await bucket.list(cursor ? { cursor } : {})
    if (!Array.isArray(page.objects))
      throw new Error('company_restore_inventory_invalid')
    for (const object of page.objects) {
      if (
        typeof object.key !== 'string' ||
        !/^attachments\/[A-Za-z0-9_-]+$/.test(object.key) ||
        keys.has(object.key)
      )
        throw new Error('company_restore_inventory_invalid')
      keys.add(object.key)
    }
    if (page.truncated === false) {
      if (
        !Number.isSafeInteger(expectedCount) ||
        expectedCount < 0 ||
        keys.size !== expectedCount
      )
        throw new Error('company_restore_inventory_invalid')
      return [...keys].sort()
    }
    if (
      page.truncated !== true ||
      typeof page.cursor !== 'string' ||
      !page.cursor ||
      cursors.has(page.cursor)
    )
      throw new Error('company_restore_inventory_invalid')
    cursor = page.cursor
    cursors.add(cursor)
  }
  throw new Error('company_restore_inventory_invalid')
}

export function assertCompanyGroupOnlyState({
  membership,
  directGrants,
  groupGrants,
  groupId,
  collectionId,
}) {
  if (
    membership?.status !== 2 ||
    membership.type !== 2 ||
    typeof membership.org_key !== 'string' ||
    !/^[34]\./.test(membership.org_key) ||
    !Array.isArray(directGrants) ||
    directGrants.length !== 0 ||
    !Array.isArray(groupGrants) ||
    groupGrants.length !== 1 ||
    groupGrants[0].group_id !== groupId ||
    groupGrants[0].collection_id !== collectionId ||
    groupGrants[0].read_only !== 0 ||
    groupGrants[0].hide_passwords !== 0 ||
    groupGrants[0].manage !== 0
  )
    throw new Error('company_restore_group_only_invalid')
}

export function assertCompanyAttachmentBytes(bytes, expected) {
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256)
    throw new Error('company_restore_attachment_decrypt_failed')
}

export async function verifyCompanyNativeAttachment({
  root,
  cipher,
  item,
  native,
  session,
}) {
  if (cipher.payload?.organizationId !== null)
    throw new Error('company_restore_attachment_requires_personal_cipher')
  const attachment = item.attachments?.find(
    (entry) => entry.id === cipher.attachment.id,
  )
  if (attachment?.fileName !== cipher.attachment.fileName)
    throw new Error('native_attachment_metadata_decrypt_failed')
  const output = join(root, 'attachment-' + randomUUID() + '.bin')
  await native(
    [
      'get',
      'attachment',
      cipher.attachment.id,
      '--itemid',
      cipher.id,
      '--output',
      output,
    ],
    { BW_SESSION: session },
  )
  await chmod(output, 0o600)
  const bytes = await readFile(output)
  try {
    assertCompanyAttachmentBytes(bytes, cipher.attachment)
  } finally {
    bytes.fill(0)
  }
  return { flow: 'personal_attachment_binary_decrypted', passed: true }
}

export async function createCompanyNativeAttachment({
  root,
  cipher,
  native,
  session,
}) {
  // Current attachment APIs are personal-only. Never widen fixture authority.
  if (cipher.payload?.organizationId !== null)
    throw new Error('company_restore_attachment_requires_personal_cipher')
  const fileName = 'synthetic-company-restore.bin'
  const path = join(root, fileName)
  const bytes = Buffer.concat([randomBytes(64), Buffer.from([0, 255, 10, 32])])
  const expected = { fileName, bytes: bytes.length, sha256: sha256(bytes) }
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' })
  } finally {
    bytes.fill(0)
  }
  const item = JSON.parse(
    await native(
      ['create', 'attachment', '--file', path, '--itemid', cipher.id],
      { BW_SESSION: session },
    ),
  )
  if (item?.id !== cipher.id || item.attachments?.length !== 1)
    throw new Error('native_attachment_create_failed')
  const attachment = item.attachments[0]
  if (
    typeof attachment.id !== 'string' ||
    !attachment.id ||
    attachment.fileName !== fileName
  )
    throw new Error('native_attachment_create_failed')
  cipher.attachment = { ...expected, id: attachment.id }
}

export async function establishCompanyGroupOnlyMember({
  api,
  account,
  ownerToken,
  organizationId,
  collectionId,
  wrappedOrganizationKey,
  readInvitation,
  freshOtp,
}) {
  const grant = await api(
    '/identity/connect/token',
    'POST',
    new URLSearchParams({
      grant_type: 'password',
      username: account.email,
      password: account.hash,
      scope: 'api offline_access',
      deviceIdentifier: randomUUID(),
      deviceType: '8',
      deviceName: 'Synthetic surviving group-only member',
    }),
  )
  if (typeof grant?.access_token !== 'string' || !grant.access_token)
    throw new Error('company_restore_member_login_failed')
  account.token = grant.access_token
  const setup = await api(
    '/identity/accounts/totp/setup',
    'POST',
    undefined,
    account.token,
  )
  if (typeof setup?.secret !== 'string' || !setup.secret)
    throw new Error('company_restore_member_setup_failed')
  account.factor = setup.secret
  const verified = await api(
    '/identity/accounts/totp/setup/verify',
    'POST',
    { code: await freshOtp(account) },
    account.token,
  )
  if (verified?.enabled !== true)
    throw new Error('company_restore_member_setup_failed')
  const path = '/api/organizations/' + organizationId
  await api(
    path + '/users/invite',
    'POST',
    { emails: [account.email], type: 2, collections: [] },
    ownerToken,
  )
  const invitation = readInvitation()
  if (
    invitation?.recipientEmail !== account.email ||
    typeof invitation.membershipId !== 'string' ||
    !invitation.membershipId ||
    typeof invitation.token !== 'string' ||
    !invitation.token
  )
    throw new Error('company_restore_invitation_missing')
  const memberPath = path + '/users/' + invitation.membershipId
  await api(
    memberPath + '/accept',
    'POST',
    { token: invitation.token },
    account.token,
  )
  await api(
    memberPath + '/confirm',
    'POST',
    { key: wrappedOrganizationKey },
    ownerToken,
  )
  const group = await api(
    path + '/groups',
    'POST',
    {
      name: 'Synthetic surviving restore group',
      users: [invitation.membershipId],
      collections: [
        {
          id: collectionId,
          readOnly: false,
          hidePasswords: false,
          manage: false,
        },
      ],
    },
    ownerToken,
  )
  if (typeof group?.Id !== 'string' || !group.Id)
    throw new Error('company_restore_group_missing')
  return { membershipId: invitation.membershipId, groupId: group.Id }
}

export function isRestoredTotpChallenge(value) {
  return (
    value?.error === 'invalid_grant' &&
    typeof value.TwoFactorToken === 'string' &&
    value.TwoFactorToken.length > 0 &&
    Array.isArray(value.TwoFactorProviders) &&
    value.TwoFactorProviders.length === 1 &&
    value.TwoFactorProviders[0] === 0 &&
    value.TwoFactorProviders2?.[0] !== null &&
    typeof value.TwoFactorProviders2?.[0] === 'object' &&
    !Array.isArray(value.TwoFactorProviders2[0]) &&
    !Object.hasOwn(value, 'access_token') &&
    !Object.hasOwn(value, 'refresh_token')
  )
}

export async function prepareCompanyRestoreResource(root, label) {
  // mkdir without recursive deliberately refuses a reused source or target.
  await mkdir(root, { mode: 0o700 })
  const persist = join(root, '.wrangler', 'state')
  await mkdir(join(root, '.wrangler'), { mode: 0o700 })
  await mkdir(persist, { mode: 0o700 })
  const resource = {
    root,
    persist,
    config: join(root, 'wrangler.jsonc'),
    databaseId: randomUUID(),
    databaseName: `synthetic-company-recovery-${label}`,
    bucketName: `company-restore-${label}-${randomUUID()}`,
  }
  // Runtime signing/wrapping secrets are held by the caller, never this config.
  await writeFile(
    resource.config,
    JSON.stringify({
      name: `synthetic-company-recovery-${label}`,
      compatibility_date: '2026-07-21',
      d1_databases: [
        {
          binding: 'DB',
          database_name: resource.databaseName,
          database_id: resource.databaseId,
        },
      ],
      r2_buckets: [
        { binding: 'VAULT_OBJECTS', bucket_name: resource.bucketName },
      ],
    }),
    { mode: 0o600, flag: 'wx' },
  )
  return resource
}

export function companyRestoreStorage(resource) {
  return {
    d1Databases: { DB: resource.databaseId },
    r2Buckets: { VAULT_OBJECTS: resource.bucketName },
    d1Persist: join(resource.persist, 'v3', 'd1'),
    r2Persist: join(resource.persist, 'v3', 'r2'),
  }
}

export async function restoreCompanySnapshot({
  root,
  source,
  completedGeneration,
  objectKeys,
  stopSource,
  runBackup,
}) {
  if (
    completedGeneration?.status !== 'passed' ||
    !/^[a-f0-9]{64}$/.test(completedGeneration.sourceSha256 ?? '') ||
    !Array.isArray(completedGeneration.checks) ||
    completedGeneration.checks.length < 14 ||
    completedGeneration.checks.some((check) => check.passed !== true)
  )
    throw new Error('company_restore_source_not_completed')
  const generationSha256 = sha256(JSON.stringify(completedGeneration))
  await stopSource()
  await writeFile(
    join(source.persist, credentialLifecycleStateOwnershipMarker),
    credentialLifecycleStateOwnershipMarkerBody,
    { mode: 0o600, flag: 'wx' },
  )
  await writeCredentialLifecycleCompletionAttestation(
    source.persist,
    generationSha256,
  )
  const inventory = join(root, 'restore-object-inventory.txt')
  await writeFile(inventory, objectKeys.join('\n'), {
    mode: 0o600,
    flag: 'wx',
  })
  const backup = join(root, 'company-backup')
  const exported = await runBackup([
    'export',
    '--out',
    backup,
    '--database',
    source.databaseName,
    '--bucket',
    source.bucketName,
    '--mode',
    'local',
    '--config',
    source.config,
    '--persist-to',
    source.persist,
    '--generation-manifest-sha256',
    generationSha256,
    '--r2-objects',
    inventory,
    '--execute',
  ])
  if (exported.executed !== true)
    throw new Error('company_restore_export_not_executed')
  const manifestBytes = await readFile(join(backup, 'backup-manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const target = await prepareCompanyRestoreResource(
    join(root, 'restore-target'),
    'target',
  )
  const manifestSha256 = sha256(manifestBytes)
  const restored = await runBackup([
    'restore',
    '--from',
    backup,
    '--database',
    target.databaseName,
    '--bucket',
    target.bucketName,
    '--mode',
    'local',
    '--config',
    target.config,
    '--persist-to',
    target.persist,
    '--expected-manifest-sha256',
    manifestSha256,
    '--expected-generation-manifest-sha256',
    manifest.credentialGeneration.manifestSha256,
    '--execute',
    '--confirm-fresh-target',
  ])
  if (
    restored.executed !== true ||
    restored.verification?.status !== 'passed' ||
    restored.verification.r2ObjectCount !== objectKeys.length ||
    restored.verification.sourceStateSha256 !==
      manifest.credentialGeneration.sourceStateSha256
  )
    throw new Error('company_restore_verification_failed')
  return {
    target,
    evidence: {
      manifestSha256,
      generationSha256: manifest.credentialGeneration.manifestSha256,
      sourceStateSha256: manifest.credentialGeneration.sourceStateSha256,
      restored: true,
      storageVerification: restored.verification.status,
      r2ObjectCount: restored.verification.r2ObjectCount,
      sourceTargetDistinct: source.databaseId !== target.databaseId,
    },
  }
}
