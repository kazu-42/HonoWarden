import {
  createApi,
  array,
  id,
  record,
  string,
  TotpChallenge,
  type ApiRequest,
  type FetchPort,
} from './api'
import {
  AdminError,
  type AdminClient,
  type AuditFilter,
  type AuditPage,
  type CollectionGrant,
  type CollectionView,
  type CompanySettingsView,
  type GroupInput,
  type GroupView,
  type MemberView,
  type OrganizationView,
  type PolicyView,
  type Role,
  type SessionView,
} from './contracts'
import { createCryptoPort, type CryptoPort } from './crypto-client'
import { validateKdf, type KdfSettings } from './crypto/kdf'
import type { WrappedAccount, WrappedOrganization } from './crypto/keyring'
import { consumeInvitation, type PendingInvitation } from './invitation'
import { prepareEmailVerification } from './email-verification'
import type { WrappedAccountRegistration } from './crypto/account-registration'

export type AdminClientOptions = {
  fetch?: FetchPort
  crypto?: () => CryptoPort
  clock?: () => number
  invitation?: PendingInvitation
  lifecycle?: boolean
}

function companySettings(value: unknown): CompanySettingsView {
  const row = record(value)
  if (
    row.object !== 'companySettings' ||
    typeof row.canEdit !== 'boolean' ||
    (row.expectedMemberCount !== null &&
      (typeof row.expectedMemberCount !== 'number' ||
        !Number.isSafeInteger(row.expectedMemberCount) ||
        row.expectedMemberCount < 1 ||
        row.expectedMemberCount > 100000))
  )
    throw new AdminError('unavailable', 'response_invalid')
  return {
    name: string(row.name, 100),
    defaultEmailDomain:
      row.defaultEmailDomain === null
        ? null
        : string(row.defaultEmailDomain, 253),
    expectedMemberCount: row.expectedMemberCount as number | null,
    mailTestRecipient:
      row.mailTestRecipient === null
        ? null
        : string(row.mailTestRecipient, 254),
    revision: row.revision === null ? null : id(row.revision),
    canEdit: row.canEdit,
  }
}

function role(value: unknown): Role {
  if (value !== 0 && value !== 1 && value !== 2)
    throw new AdminError('unavailable', 'response_invalid')
  return value
}
function nullableString(value: unknown): string | null {
  return value === null ? null : string(value)
}
function grants(value: unknown): CollectionGrant[] {
  return array(value).map((item) => {
    const row = record(item)
    if (
      typeof row.ReadOnly !== 'boolean' ||
      typeof row.HidePasswords !== 'boolean' ||
      typeof row.Manage !== 'boolean'
    )
      throw new AdminError('unavailable', 'response_invalid')
    return {
      id: id(row.Id),
      readOnly: row.ReadOnly,
      hidePasswords: row.HidePasswords,
      manage: row.Manage,
    }
  })
}
function member(value: unknown): MemberView {
  const row = record(value)
  if (![-1, 0, 1, 2].includes(row.Status as number))
    throw new AdminError('unavailable', 'response_invalid')
  return {
    id: id(row.Id),
    userId: row.UserId === null ? null : id(row.UserId),
    name: nullableString(row.Name),
    email: string(row.Email, 254),
    status: row.Status as MemberView['status'],
    type: role(row.Type),
    collections: grants(row.Collections),
  }
}
function group(value: unknown): GroupView {
  const row = record(value)
  return {
    id: id(row.Id),
    organizationId: id(row.OrganizationId),
    name: string(row.Name, 100),
  }
}
function policy(value: unknown): PolicyView {
  const row = record(value)
  if (row.Type !== 0 || typeof row.Enabled !== 'boolean')
    throw new AdminError('unavailable', 'response_invalid')
  return { required: row.Enabled, revision: nullableString(row.RevisionDate) }
}
function kdf(value: unknown): KdfSettings {
  const row = record(value)
  const settings = {
    type: row.kdf as 0 | 1,
    iterations: row.kdfIterations as number,
    memory: row.kdfMemory as number | null,
    parallelism: row.kdfParallelism as number | null,
  }
  validateKdf(settings)
  return settings
}

export function createAdminClient(
  options: AdminClientOptions = {},
): AdminClient {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const api = createApi(fetcher)
  const newCrypto = options.crypto ?? createCryptoPort
  const now = options.clock ?? Date.now
  let state: SessionView = { phase: 'signedOut' }
  let invitation = options.invitation
  if (!invitation && typeof window !== 'undefined')
    invitation = consumeInvitation(window.location, (path) =>
      window.history.replaceState(null, '', path),
    )
  const listeners = new Set<(value: SessionView) => void>()
  const aborts = new Set<AbortController>()
  let epoch = 0
  let syncSequence = 0
  let emailVerificationReadVersion = 0
  const emailVerificationAttempts = new Set<() => void>()
  const retireEmailVerification = () => {
    for (const dispose of emailVerificationAttempts) dispose()
    emailVerificationAttempts.clear()
  }
  let port: CryptoPort | undefined
  let tokens: { access: string; refresh: string; expiresAt: number } | undefined
  let refresh: Promise<void> | undefined
  let profile: Record<string, unknown> | undefined
  let pending:
    | {
        email: string
        hash: string
        challenge: string
        device: string
        settings: KdfSettings
      }
    | undefined
  let challengeTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const view = (): SessionView =>
    structuredClone({
      ...state,
      ...(invitation
        ? {
            pendingInvitation: {
              organizationId: invitation.organizationId,
              membershipId: invitation.membershipId,
            },
          }
        : {}),
    })
  const publish = (next: SessionView) => {
    state = next
    for (const listener of listeners) listener(view())
  }
  const stopCrypto = () => {
    port?.dispose()
    port = undefined
  }
  const assertEpoch = (expected: number) => {
    if (epoch !== expected || disposed)
      throw new AdminError('cancelled', 'operation_cancelled')
  }
  const cancel = () => {
    epoch++
    retireEmailVerification()
    for (const controller of aborts) controller.abort()
    aborts.clear()
    stopCrypto()
    pending = undefined
    refresh = undefined
    clearTimeout(challengeTimer)
    clearTimeout(idleTimer)
  }
  const reset = (phase: 'signedOut' | 'expired') => {
    cancel()
    tokens = undefined
    profile = undefined
    publish({ phase })
  }
  const lock = () => {
    if (!tokens || !profile) {
      reset('signedOut')
      return
    }
    cancel()
    publish({
      phase: 'locked',
      ...(state.email ? { email: state.email } : {}),
    })
  }
  const touch = () => {
    clearTimeout(idleTimer)
    if (state.phase === 'unlocked') idleTimer = setTimeout(lock, 5 * 60_000)
  }
  const request = async (
    path: string,
    input: Omit<ApiRequest, 'signal' | 'token'> = {},
    authenticated = true,
    signal?: AbortSignal,
  ) => {
    const expected = epoch
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new AdminError('transport', 'request_timeout')),
      30_000,
    )
    aborts.add(controller)
    try {
      const result = await api(path, {
        ...input,
        signal: signal
          ? AbortSignal.any([controller.signal, signal])
          : controller.signal,
        ...(authenticated && tokens ? { token: tokens.access } : {}),
      })
      assertEpoch(expected)
      if (signal?.aborted)
        throw new AdminError('cancelled', 'operation_cancelled')
      return result
    } catch (error) {
      assertEpoch(expected)
      if (signal?.aborted)
        throw new AdminError('cancelled', 'operation_cancelled')
      if (
        error instanceof AdminError &&
        (error.code === 'mfa_required' ||
          error.code === 'organization_mfa_required')
      )
        publish({ ...state, mfaRequired: true, mfaVerified: false })
      throw error
    } finally {
      clearTimeout(timeout)
      aborts.delete(controller)
    }
  }
  const installTokens = (value: unknown, settings?: KdfSettings) => {
    const row = record(value)
    if (
      row.token_type !== 'Bearer' ||
      !Number.isSafeInteger(row.expires_in) ||
      (row.expires_in as number) <= 0 ||
      (row.expires_in as number) > 86_400
    )
      throw new AdminError('unavailable', 'response_invalid')
    if (
      settings &&
      (row.Kdf !== settings.type ||
        row.KdfIterations !== settings.iterations ||
        row.KdfMemory !== settings.memory ||
        row.KdfParallelism !== settings.parallelism)
    )
      throw new AdminError('crypto', 'kdf_generation_changed')
    tokens = {
      access: string(row.access_token, 16_384),
      refresh: string(row.refresh_token, 4096),
      expiresAt: now() + (row.expires_in as number) * 1000,
    }
  }
  const ensureToken = async () => {
    if (!tokens) throw new AdminError('authentication', 'session_required')
    if (tokens.expiresAt > now() + 30_000) return
    if (!refresh) {
      const expected = epoch
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh,
      })
      refresh = request(
        '/identity/connect/token',
        { method: 'POST', form },
        false,
      )
        .then((result) => {
          assertEpoch(expected)
          installTokens(result.value)
        })
        .catch((error: unknown) => {
          if (epoch === expected) reset('expired')
          throw error
        })
        .finally(() => {
          if (epoch === expected) refresh = undefined
        })
    }
    await refresh
  }
  const authorized = async (
    path: string,
    input: Omit<ApiRequest, 'signal' | 'token'> = {},
  ) => {
    await ensureToken()
    try {
      return await request(path, input)
    } catch (error) {
      if (error instanceof AdminError && error.httpStatus === 401)
        reset('expired')
      throw error
    }
  }
  const cryptoCall = async <T>(
    command: Parameters<CryptoPort['call']>[0],
  ): Promise<T> => {
    const expected = epoch
    if (!port) throw new AdminError('crypto', 'locked')
    const value = await port.call<T>(command)
    assertEpoch(expected)
    return value
  }
  const organizations = (
    row: Record<string, unknown>,
  ): { views: OrganizationView[]; keys: WrappedOrganization[] } => {
    const seen = new Set<string>()
    const rows = array(row.Organizations)
    const views: OrganizationView[] = []
    const keys: WrappedOrganization[] = []
    for (const value of rows) {
      const org = record(value)
      const orgId = id(org.Id)
      if (seen.has(orgId) || org.Status !== 2 || org.Enabled !== true)
        throw new AdminError('unavailable', 'response_invalid')
      seen.add(orgId)
      views.push({
        id: orgId,
        name: string(org.Name, 1000),
        role: role(org.Type),
      })
      keys.push({ id: orgId, key: string(org.Key) })
    }
    return { views, keys }
  }
  const account = (row: Record<string, unknown>): WrappedAccount => {
    const accountKeys = record(row.AccountKeys)
    const pair = record(accountKeys.publicKeyEncryptionKeyPair)
    return {
      userKey: string(row.Key),
      privateKey: string(row.PrivateKey),
      publicKey: string(pair.publicKey),
      organizations: organizations(row).keys,
    }
  }
  const fetchProfile = async () => {
    const result = record((await authorized('/api/accounts/profile')).value)
    id(result.Id)
    string(result.Email, 254)
    if (typeof result.EmailVerified !== 'boolean')
      throw new AdminError('unavailable', 'response_invalid')
    return result
  }
  const assurance = async (): Promise<boolean> => {
    const row = record(
      (await authorized('/identity/accounts/totp/assurance')).value,
    )
    if (row.object !== 'totpSession' || typeof row.verified !== 'boolean')
      throw new AdminError('unavailable', 'response_invalid')
    return row.verified
  }
  const setupView = (value: unknown) => {
    const row = record(value)
    const secret = string(row.secret, 128)
    const uri = string(row.uri, 2048)
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch {
      throw new AdminError('unavailable', 'response_invalid')
    }
    if (
      !/^[A-Z2-7]{16,128}$/.test(secret) ||
      parsed.protocol !== 'otpauth:' ||
      parsed.hostname !== 'totp' ||
      parsed.searchParams.get('secret') !== secret
    )
      throw new AdminError('unavailable', 'response_invalid')
    return { secret, uri }
  }
  const finishLogin = async (value: unknown, settings: KdfSettings) => {
    installTokens(value, settings)
    const current = await fetchProfile()
    const verified = await assurance()
    await cryptoCall({ action: 'unlock', account: account(current) })
    profile = current
    pending = undefined
    clearTimeout(challengeTimer)
    publish({
      phase: 'unlocked',
      email: string(current.Email, 254),
      organizations: organizations(current).views,
      mfaVerified: verified,
      totpEnabled: current.TwoFactorEnabled === true,
      emailVerified: current.EmailVerified === true,
    })
    touch()
  }
  const unlocked = (orgId?: string) => {
    if (state.phase !== 'unlocked') throw new AdminError('crypto', 'locked')
    if (
      orgId &&
      !state.organizations?.some(
        (organization) => organization.id === id(orgId),
      )
    )
      throw new AdminError('authorization', 'organization_not_found')
    touch()
  }
  const orgPath = (orgId: string) => `/api/organizations/${id(orgId)}`
  const memberPath = (orgId: string, memberId: string) =>
    `${orgPath(orgId)}/users/${id(memberId)}`
  const sync = async () => {
    unlocked()
    const expectedEpoch = epoch
    const expectedSync = ++syncSequence
    const verificationVersion = emailVerificationReadVersion
    const current = await fetchProfile()
    assertEpoch(expectedEpoch)
    if (expectedSync !== syncSequence) return
    const verified = await assurance()
    assertEpoch(expectedEpoch)
    if (expectedSync !== syncSequence) return
    try {
      await cryptoCall({
        action: 'organizations',
        organizations: organizations(current).keys,
      })
    } catch (error) {
      if (error instanceof AdminError && error.kind === 'crypto') lock()
      throw error
    }
    assertEpoch(expectedEpoch)
    if (expectedSync !== syncSequence) return
    if (profile?.Id !== current.Id || profile?.Email !== current.Email)
      retireEmailVerification()
    if (
      verificationVersion !== emailVerificationReadVersion &&
      profile?.Id === current.Id &&
      profile?.Email === current.Email
    )
      current.EmailVerified = state.emailVerified
    profile = current
    publish({
      ...state,
      email: string(current.Email, 254),
      organizations: organizations(current).views,
      mfaVerified: verified,
      mfaRequired: verified ? false : (state.mfaRequired ?? false),
      totpEnabled: current.TwoFactorEnabled === true,
      emailVerified: current.EmailVerified === true,
    })
  }
  const mutationReadback = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read()
    } catch (error) {
      throw new AdminError(
        'unavailable',
        'mutation_readback_unavailable',
        error instanceof AdminError && error.requestId
          ? { requestId: error.requestId }
          : {},
      )
    }
  }
  const readMember = async (orgId: string, memberId: string) =>
    member((await authorized(memberPath(orgId, memberId))).value)
  const listMembers = async (orgId: string) => {
    unlocked(orgId)
    return array(
      record(
        (await authorized(`${orgPath(orgId)}/users?includeCollections=true`))
          .value,
      ).data,
    ).map(member)
  }
  const collection = async (
    orgId: string,
    value: unknown,
  ): Promise<CollectionView> => {
    const row = record(value)
    const collectionId = id(row.Id)
    if (row.OrganizationId !== orgId)
      throw new AdminError('unavailable', 'response_invalid')
    try {
      const name = await cryptoCall<string>({
        action: 'decryptName',
        organizationId: orgId,
        encrypted: string(row.Name, 1000),
      })
      return {
        id: collectionId,
        organizationId: orgId,
        name: { status: 'decrypted', value: name },
      }
    } catch (error) {
      if (
        error instanceof AdminError &&
        error.kind === 'crypto' &&
        error.code !== 'locked'
      )
        return {
          id: collectionId,
          organizationId: orgId,
          name: { status: 'unavailable', code: error.code },
        }
      throw error
    }
  }
  const groupDetails = async (orgId: string, groupId: string) => {
    const path = `${orgPath(orgId)}/groups/${id(groupId)}`
    const details = await authorized(`${path}/details`)
    const userResult = await authorized(`${path}/users`)
    const users = array(userResult.value).map(id)
    if (!details.etag || !/^"[^"\r\n]{1,128}"$/.test(details.etag))
      throw new AdminError('unavailable', 'response_invalid')
    if (userResult.etag !== details.etag) {
      throw new AdminError('conflict', 'group_conflict')
    }
    return { row: record(details.value), users, etag: details.etag, path }
  }
  const writeGroup = async (
    orgId: string,
    groupId: string,
    input: GroupInput,
  ) => {
    if (
      !input.revision ||
      !input.revision.startsWith(`"${id(groupId)}:`) ||
      !/^"[^"\r\n]{1,128}"$/.test(input.revision)
    )
      throw new AdminError('validation', 'group_revision_required')
    return group(
      (
        await authorized(`${orgPath(orgId)}/groups/${id(groupId)}`, {
          method: 'PUT',
          ifMatch: input.revision,
          body: {
            name: input.name,
            users: input.memberIds,
            collections: input.collections,
          },
        })
      ).value,
    )
  }
  const auditQuery = (filter: AuditFilter, exporting = false) => {
    const query = new URLSearchParams()
    if (filter.continuationToken) {
      if (exporting) throw new AdminError('validation', 'audit_filter_invalid')
      query.set('continuationToken', filter.continuationToken)
    }
    for (const key of ['from', 'to', 'eventName', 'actorUserId'] as const)
      if (filter[key] !== undefined) query.set(key, filter[key]!)
    if (filter.limit !== undefined && !exporting)
      query.set('limit', String(filter.limit))
    return query.size ? `?${query}` : ''
  }

  const client: AdminClient = {
    getSession: view,
    subscribe(listener) {
      listeners.add(listener)
      listener(view())
      return () => listeners.delete(listener)
    },
    async registerInvitedAccount(input) {
      if (!invitation) throw new AdminError('validation', 'invitation_required')
      if (!['signedOut', 'expired'].includes(state.phase))
        throw new AdminError('conflict', 'registration_unavailable')
      const email = input.email.trim().toLowerCase()
      const displayName = input.displayName.trim()
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        !displayName ||
        displayName.length > 100 ||
        input.password.length < 12 ||
        input.password.length > 256
      )
        throw new AdminError('validation', 'registration_invalid')
      const current = invitation
      reset('signedOut')
      const expected = epoch
      publish({ phase: 'authenticating', email })
      try {
        port = newCrypto()
        const wrapped = await cryptoCall<WrappedAccountRegistration>({
          action: 'createAccount',
          email,
          password: input.password,
        })
        input.password = ''
        assertEpoch(expected)
        const result = record(
          (
            await request(
              '/api/accounts/register-invited',
              {
                method: 'POST',
                body: { email, displayName, ...wrapped, invitation: current },
              },
              false,
            )
          ).value,
        )
        if (result.object !== 'accountRegistration' || result.created !== true)
          throw new AdminError('unavailable', 'response_invalid')
      } finally {
        input.password = ''
        if (epoch === expected) {
          stopCrypto()
          publish({ phase: 'signedOut', email })
        }
      }
    },
    async login(email, password) {
      const keptInvitation = invitation
      reset('signedOut')
      invitation = keptInvitation
      const expected = epoch
      const normalizedEmail = email.trim().toLowerCase()
      if (!normalizedEmail || !password)
        throw new AdminError('validation', 'credentials_required')
      publish({ phase: 'authenticating', email: normalizedEmail })
      try {
        const prelogin = record(
          (
            await request(
              '/identity/accounts/prelogin',
              { method: 'POST', body: { email: normalizedEmail } },
              false,
            )
          ).value,
        )
        if (prelogin.salt !== normalizedEmail)
          throw new AdminError('crypto', 'kdf_settings_invalid')
        const settings = kdf(prelogin)
        port = newCrypto()
        const hash = await cryptoCall<string>({
          action: 'derive',
          email: normalizedEmail,
          password,
          settings,
        })
        password = ''
        const device = crypto.randomUUID()
        const form = new URLSearchParams({
          grant_type: 'password',
          username: normalizedEmail,
          password: hash,
          scope: 'api offline_access',
          deviceIdentifier: device,
          deviceName: 'HonoWarden Administration',
          deviceType: '2',
        })
        try {
          await finishLogin(
            (
              await request(
                '/identity/connect/token',
                { method: 'POST', form },
                false,
              )
            ).value,
            settings,
          )
        } catch (error) {
          if (!(error instanceof TotpChallenge)) throw error
          pending = {
            email: normalizedEmail,
            hash,
            challenge: error.token,
            device,
            settings,
          }
          publish({ phase: 'totpRequired', email: normalizedEmail })
          challengeTimer = setTimeout(() => {
            if (epoch === expected && pending) reset('signedOut')
          }, 5 * 60_000)
        }
      } catch (error) {
        if (epoch === expected) {
          stopCrypto()
          tokens = undefined
          pending = undefined
          publish({ phase: 'signedOut' })
        }
        throw error
      }
    },
    async verifyTotp(code) {
      if (!pending || state.phase !== 'totpRequired' || !/^\d{6}$/.test(code))
        throw new AdminError('validation', 'totp_code_invalid')
      const current = pending
      const form = new URLSearchParams({
        grant_type: 'password',
        username: current.email,
        password: current.hash,
        scope: 'api offline_access',
        deviceIdentifier: current.device,
        deviceName: 'HonoWarden Administration',
        deviceType: '2',
        twoFactorProvider: '0',
        twoFactorToken: current.challenge,
        twoFactorCode: code,
      })
      try {
        await finishLogin(
          (
            await request(
              '/identity/connect/token',
              { method: 'POST', form },
              false,
            )
          ).value,
          current.settings,
        )
      } catch (error) {
        if (pending === current) reset('signedOut')
        throw error instanceof TotpChallenge
          ? new AdminError('authentication', 'totp_code_invalid')
          : error
      }
    },
    async stepUpTotp(code) {
      unlocked()
      if (!/^\d{6}$/.test(code))
        throw new AdminError('validation', 'totp_code_invalid')
      const result = record(
        (
          await authorized('/identity/accounts/totp/step-up', {
            method: 'POST',
            body: { code },
          })
        ).value,
      )
      if (result.verified !== true)
        throw new AdminError('unavailable', 'response_invalid')
      publish({ ...state, mfaRequired: false, mfaVerified: true })
      await mutationReadback(sync)
    },
    async startTotpSetup() {
      unlocked()
      return setupView(
        (await authorized('/identity/accounts/totp/setup', { method: 'POST' }))
          .value,
      )
    },
    async verifyTotpSetup(code) {
      unlocked()
      if (!/^\d{6}$/.test(code))
        throw new AdminError('validation', 'totp_code_invalid')
      const result = record(
        (
          await authorized('/identity/accounts/totp/setup/verify', {
            method: 'POST',
            body: { code },
          })
        ).value,
      )
      if (result.enabled !== true)
        throw new AdminError('unavailable', 'response_invalid')
      await mutationReadback(sync)
    },
    async startTotpChange(currentCode) {
      unlocked()
      if (!/^\d{6}$/.test(currentCode))
        throw new AdminError('validation', 'totp_code_invalid')
      return setupView(
        (
          await authorized('/identity/accounts/totp/change', {
            method: 'POST',
            body: { currentCode },
          })
        ).value,
      )
    },
    async verifyTotpChange(code) {
      unlocked()
      if (!/^\d{6}$/.test(code))
        throw new AdminError('validation', 'totp_code_invalid')
      const result = record(
        (
          await authorized('/identity/accounts/totp/change/verify', {
            method: 'POST',
            body: { code },
          })
        ).value,
      )
      if (result.enabled !== true)
        throw new AdminError('unavailable', 'response_invalid')
      await mutationReadback(sync)
    },
    prepareEmailCodeVerification() {
      unlocked()
      retireEmailVerification()
      const expected = epoch
      const accountId = id(profile?.Id)
      const email = string(profile?.Email, 254)
      const controller = new AbortController()
      let active = true
      let busy = false
      const assertCurrent = () => {
        assertEpoch(expected)
        if (
          !active ||
          state.phase !== 'unlocked' ||
          profile?.Id !== accountId ||
          profile?.Email !== email
        )
          throw new AdminError('cancelled', 'operation_cancelled')
      }
      const dispose = () => {
        if (!active) return
        active = false
        controller.abort(new AdminError('cancelled', 'operation_cancelled'))
        emailVerificationAttempts.delete(dispose)
      }
      emailVerificationAttempts.add(dispose)
      const perform = async (
        path: string,
        input: Omit<ApiRequest, 'signal' | 'token'> = {},
      ) => {
        assertCurrent()
        await ensureToken()
        assertCurrent()
        try {
          const result = await request(path, input, true, controller.signal)
          assertCurrent()
          return result.value
        } catch (error) {
          assertCurrent()
          if (error instanceof AdminError && error.httpStatus === 401)
            reset('expired')
          throw error
        }
      }
      const run = async <T>(operation: () => Promise<T>): Promise<T> => {
        assertCurrent()
        if (busy) throw new AdminError('validation', 'operation_in_progress')
        busy = true
        try {
          return await operation()
        } finally {
          busy = false
        }
      }
      const readback = async (requireVerified: boolean): Promise<boolean> => {
        try {
          return await mutationReadback(async () => {
            const current = record(await perform('/api/accounts/profile'))
            assertCurrent()
            if (
              current.Id !== accountId ||
              current.Email !== email ||
              typeof current.EmailVerified !== 'boolean' ||
              (requireVerified && current.EmailVerified !== true)
            )
              throw new AdminError('unavailable', 'response_invalid')
            // Email ownership never imports account keys, memberships, or MFA proof.
            emailVerificationReadVersion++
            profile = { ...profile, EmailVerified: current.EmailVerified }
            publish({ ...state, emailVerified: current.EmailVerified })
            return current.EmailVerified
          })
        } catch (error) {
          assertCurrent()
          throw error
        }
      }
      return {
        dispose,
        requestCode: () =>
          run(async () => {
            const result = await perform('/api/accounts/verify-email', {
              method: 'POST',
            })
            if (result !== null)
              throw new AdminError('unavailable', 'response_invalid')
          }),
        readback: () => run(() => readback(false)),
        submit: (code) =>
          run(async () => {
            const token = code.trim()
            code = ''
            if (!/^[A-Za-z0-9_-]{43}$/.test(token))
              throw new AdminError(
                'validation',
                'email_verification_code_invalid',
              )
            const result = await perform('/api/accounts/verify-email-token', {
              method: 'POST',
              body: { userId: accountId, token },
            })
            if (result !== null)
              throw new AdminError('unavailable', 'response_invalid')
            await readback(true)
            dispose()
            return { status: 'verified' as const }
          }),
      }
    },
    async prepareEmailVerification(input) {
      unlocked()
      retireEmailVerification()
      const expected = epoch
      const accountId = id(profile?.Id)
      const email = string(profile?.Email, 254)
      const assertCurrent = () => {
        assertEpoch(expected)
        if (
          state.phase !== 'unlocked' ||
          profile?.Id !== accountId ||
          profile?.Email !== email
        )
          throw new AdminError('cancelled', 'operation_cancelled')
      }
      return prepareEmailVerification(input, {
        email,
        now,
        assertCurrent,
        register(dispose) {
          emailVerificationAttempts.add(dispose)
          return () => emailVerificationAttempts.delete(dispose)
        },
        async createChallenge() {
          return (
            await authorized(
              '/identity/accounts/email-verification/challenge',
              { method: 'POST', body: {} },
            )
          ).value
        },
        async verifyAndReadback(challengeId, token) {
          assertCurrent()
          const result = record(
            (
              await authorized('/identity/accounts/email-verification/verify', {
                method: 'POST',
                body: { challengeId, token },
              })
            ).value,
          )
          if (
            result.object !== 'emailVerification' ||
            result.verified !== true ||
            result.method !== 'evp'
          )
            throw new AdminError('unavailable', 'response_invalid')
          try {
            await mutationReadback(async () => {
              const current = await fetchProfile()
              assertCurrent()
              if (
                current.Id !== accountId ||
                current.Email !== email ||
                current.EmailVerified !== true
              )
                throw new AdminError('unavailable', 'response_invalid')
              emailVerificationReadVersion++
              profile = { ...profile, EmailVerified: true }
              publish({ ...state, emailVerified: true })
            })
          } catch (error) {
            assertCurrent()
            throw error
          }
        },
      })
    },
    async unlock(password) {
      if (state.phase !== 'locked' || !profile)
        throw new AdminError('authentication', 'session_required')
      const expected = epoch
      try {
        const current = await fetchProfile()
        const verified = await assurance()
        const options = record(
          record(current.UserDecryptionOptions).MasterPasswordUnlock,
        )
        const settingsRow = record(options.Kdf)
        const settings: KdfSettings = {
          type: settingsRow.KdfType as 0 | 1,
          iterations: settingsRow.Iterations as number,
          memory: settingsRow.Memory as number | null,
          parallelism: settingsRow.Parallelism as number | null,
        }
        const email = string(current.Email, 254)
        if (options.Salt !== email)
          throw new AdminError('crypto', 'kdf_settings_invalid')
        validateKdf(settings)
        port = newCrypto()
        await cryptoCall({ action: 'derive', email, password, settings })
        password = ''
        await cryptoCall({ action: 'unlock', account: account(current) })
        profile = current
        publish({
          phase: 'unlocked',
          email,
          organizations: organizations(current).views,
          mfaVerified: verified,
          totpEnabled: current.TwoFactorEnabled === true,
          emailVerified: current.EmailVerified === true,
        })
        touch()
      } catch (error) {
        if (epoch === expected) stopCrypto()
        throw error
      }
    },
    lock,
    async logout() {
      const departing = tokens
      invitation = undefined
      reset('signedOut')
      if (!departing) return
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(new AdminError('transport', 'request_timeout')),
        30_000,
      )
      try {
        let access = departing.access
        if (departing.expiresAt <= now()) {
          const row = record(
            (
              await api('/identity/connect/token', {
                method: 'POST',
                form: new URLSearchParams({
                  grant_type: 'refresh_token',
                  refresh_token: departing.refresh,
                }),
                signal: controller.signal,
              })
            ).value,
          )
          if (row.token_type !== 'Bearer')
            throw new AdminError('unavailable', 'response_invalid')
          access = string(row.access_token, 16_384)
        }
        await api('/identity/accounts/logout', {
          method: 'POST',
          token: access,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
    },
    dispose() {
      invitation = undefined
      reset('signedOut')
      disposed = true
      listeners.clear()
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', visibility)
      if (typeof window !== 'undefined')
        window.removeEventListener('pagehide', pagehide)
    },
    sync,
    async acceptPendingInvitation() {
      unlocked()
      if (!invitation) throw new AdminError('validation', 'invitation_required')
      const current = invitation
      await authorized(
        `${orgPath(current.organizationId)}/users/${id(current.membershipId)}/accept`,
        { method: 'POST', body: { token: current.token } },
      )
      invitation = undefined
      publish({ ...state })
      await mutationReadback(sync)
    },
    async getCompanySettings(orgId) {
      unlocked()
      return companySettings(
        (await authorized(`${orgPath(orgId)}/admin-settings`)).value,
      )
    },
    async requestCompanyTestMail(orgId, revision) {
      unlocked()
      const response = (
        await authorized(`${orgPath(orgId)}/admin-settings/test-mail`, {
          method: 'POST',
          body: { revision },
        })
      ).value
      const value = record(response)
      if (
        value.object !== 'companyTestMail' ||
        value.status !== 'accepted' ||
        value.mailboxReceipt !== false
      )
        throw new AdminError('transport', 'invalid_response')
    },
    async updateCompanySettings(orgId, input) {
      unlocked()
      const settings = companySettings(
        (
          await authorized(`${orgPath(orgId)}/admin-settings`, {
            method: 'PUT',
            body: input,
          })
        ).value,
      )
      await mutationReadback(sync)
      return settings
    },
    async createOrganization(input) {
      unlocked()
      const payload = await cryptoCall<Record<string, unknown>>({
        action: 'createOrganization',
        input,
      })
      const created = record(
        (
          await authorized('/api/organizations', {
            method: 'POST',
            body: payload,
          })
        ).value,
      )
      return mutationReadback(async () => {
        await sync()
        const result = state.organizations?.find(
          (organization) => organization.id === created.Id,
        )
        if (!result)
          throw new AdminError('unavailable', 'organization_readback_failed')
        return structuredClone(result)
      })
    },
    listMembers,
    async inviteMembers(orgId, input) {
      unlocked(orgId)
      await authorized(`${orgPath(orgId)}/users/invite`, {
        method: 'POST',
        body: input,
      })
      await mutationReadback(() => listMembers(orgId))
    },
    async confirmMember(orgId, memberId) {
      unlocked(orgId)
      const current = await readMember(orgId, memberId)
      if (current.status !== 1 || !current.userId)
        throw new AdminError('conflict', 'membership_conflict')
      const keys = array(
        record(
          (
            await authorized(`${orgPath(orgId)}/users/public-keys`, {
              method: 'POST',
              body: { ids: [memberId] },
            })
          ).value,
        ).data,
      )
      if (keys.length !== 1)
        throw new AdminError('unavailable', 'response_invalid')
      const key = record(keys[0])
      if (key.Id !== memberId || key.UserId !== current.userId)
        throw new AdminError('crypto', 'recipient_key_invalid')
      const publicKey = string(key.Key, 4096)
      const wrapped = await cryptoCall<string>({
        action: 'wrapMember',
        organizationId: orgId,
        publicKey,
      })
      const refreshed = await readMember(orgId, memberId)
      const rechecked = record(
        (await authorized(`/api/users/${id(current.userId)}/public-key`)).value,
      )
      if (
        refreshed.status !== 1 ||
        refreshed.userId !== current.userId ||
        rechecked.UserId !== current.userId ||
        rechecked.PublicKey !== publicKey
      )
        throw new AdminError('conflict', 'recipient_key_changed')
      await authorized(`${memberPath(orgId, memberId)}/confirm`, {
        method: 'POST',
        body: { key: wrapped },
      })
      await mutationReadback(async () => {
        if ((await readMember(orgId, memberId)).status !== 2)
          throw new AdminError('unavailable', 'membership_readback_failed')
      })
    },
    async updateMember(orgId, memberId, input) {
      unlocked(orgId)
      await authorized(memberPath(orgId, memberId), {
        method: 'PUT',
        body: input,
      })
      await mutationReadback(() => listMembers(orgId))
    },
    async reinviteMember(orgId, memberId) {
      unlocked(orgId)
      await authorized(`${memberPath(orgId, memberId)}/reinvite`, {
        method: 'POST',
      })
      await mutationReadback(() => listMembers(orgId))
    },
    async revokeMember(orgId, memberId) {
      unlocked(orgId)
      await authorized(`${memberPath(orgId, memberId)}/revoke`, {
        method: 'PUT',
      })
      await mutationReadback(async () => {
        await sync()
        await listMembers(orgId)
      })
    },
    async removeMember(orgId, memberId) {
      unlocked(orgId)
      await authorized(memberPath(orgId, memberId), { method: 'DELETE' })
      await mutationReadback(async () => {
        await sync()
        if (
          state.organizations?.some((organization) => organization.id === orgId)
        )
          await listMembers(orgId)
      })
    },
    async listCollections(orgId) {
      unlocked(orgId)
      const rows = array(
        record((await authorized(`${orgPath(orgId)}/collections`)).value).data,
      )
      return Promise.all(rows.map((row) => collection(orgId, row)))
    },
    async createCollection(orgId, input) {
      unlocked(orgId)
      const name = await cryptoCall<string>({
        action: 'encryptName',
        organizationId: orgId,
        name: input.name,
      })
      return collection(
        orgId,
        (
          await authorized(`${orgPath(orgId)}/collections`, {
            method: 'POST',
            body: { name },
          })
        ).value,
      )
    },
    async updateCollection(orgId, collectionId, input) {
      unlocked(orgId)
      const name = await cryptoCall<string>({
        action: 'encryptName',
        organizationId: orgId,
        name: input.name,
      })
      return collection(
        orgId,
        (
          await authorized(
            `${orgPath(orgId)}/collections/${id(collectionId)}`,
            { method: 'PUT', body: { name } },
          )
        ).value,
      )
    },
    async deleteCollection(orgId, collectionId) {
      unlocked(orgId)
      await authorized(`${orgPath(orgId)}/collections/${id(collectionId)}`, {
        method: 'DELETE',
      })
      await mutationReadback(async () => {
        if (
          (await client.listCollections(orgId)).some(
            (row) => row.id === collectionId,
          )
        )
          throw new AdminError('unavailable', 'collection_readback_failed')
      })
    },
    async listGroups(orgId) {
      unlocked(orgId)
      return array(
        record((await authorized(`${orgPath(orgId)}/groups`)).value).data,
      ).map(group)
    },
    async getGroup(orgId, groupId) {
      unlocked(orgId)
      const current = await groupDetails(orgId, groupId)
      return {
        ...group(current.row),
        collections: grants(current.row.Collections),
        memberIds: current.users,
        revision: current.etag,
      }
    },
    async createGroup(orgId, input) {
      unlocked(orgId)
      return group(
        (
          await authorized(`${orgPath(orgId)}/groups`, {
            method: 'POST',
            body: {
              name: input.name,
              users: input.memberIds,
              collections: input.collections,
            },
          })
        ).value,
      )
    },
    async updateGroup(orgId, groupId, input) {
      unlocked(orgId)
      return writeGroup(orgId, groupId, input)
    },
    async removeGroup(orgId, groupId) {
      unlocked(orgId)
      const current = await groupDetails(orgId, groupId)
      await authorized(current.path, {
        method: 'DELETE',
        ifMatch: current.etag,
      })
      await mutationReadback(() => client.listGroups(orgId))
    },
    async getGroupMembers(orgId, groupId) {
      unlocked(orgId)
      return (await groupDetails(orgId, groupId)).users
    },
    async setGroupMembers(orgId, groupId, memberIds) {
      unlocked(orgId)
      const current = await groupDetails(orgId, groupId)
      await authorized(current.path, {
        method: 'PUT',
        ifMatch: current.etag,
        body: {
          name: string(current.row.Name, 100),
          users: memberIds,
          collections: grants(current.row.Collections),
        },
      })
    },
    async getGroupCollections(orgId, groupId) {
      unlocked(orgId)
      return grants((await groupDetails(orgId, groupId)).row.Collections)
    },
    async setGroupCollections(orgId, groupId, input) {
      unlocked(orgId)
      const current = await groupDetails(orgId, groupId)
      await authorized(current.path, {
        method: 'PUT',
        ifMatch: current.etag,
        body: {
          name: string(current.row.Name, 100),
          users: current.users,
          collections: input,
        },
      })
    },
    async getPolicy(orgId) {
      unlocked(orgId)
      return policy((await authorized(`${orgPath(orgId)}/policies/0`)).value)
    },
    async updatePolicy(orgId, input) {
      unlocked(orgId)
      return policy(
        (
          await authorized(`${orgPath(orgId)}/policies/0`, {
            method: 'PUT',
            body: { type: 0, enabled: input.required },
          })
        ).value,
      )
    },
    async listAudit(orgId, filter = {}): Promise<AuditPage> {
      unlocked(orgId)
      const result = record(
        (
          await authorized(
            `${orgPath(orgId)}/audit-events${auditQuery(filter)}`,
          )
        ).value,
      )
      const query = record(result.query)
      const availability = record(result.availability)
      if (
        availability.coverage !== 'partial' ||
        !Number.isSafeInteger(query.limit) ||
        !Number.isSafeInteger(availability.retentionDays)
      )
        throw new AdminError('unavailable', 'response_invalid')
      return {
        data: array(result.data).map((value) => {
          const row = record(value)
          if (row.outcome !== 'success')
            throw new AdminError('unavailable', 'response_invalid')
          return {
            id: id(row.id),
            occurredAt: string(row.occurredAt, 40),
            name: string(row.name, 100),
            actorUserId: row.actorUserId === null ? null : id(row.actorUserId),
            targetId: row.targetId === null ? null : id(row.targetId),
            targetType: string(row.targetType, 100),
            outcome: 'success',
          }
        }),
        continuationToken: nullableString(result.continuationToken),
        query: {
          from: string(query.from, 40),
          to: string(query.to, 40),
          eventName: nullableString(query.eventName),
          actorUserId: nullableString(query.actorUserId),
          limit: query.limit as number,
        },
        availability: {
          coverage: 'partial',
          recordedActivity: string(availability.recordedActivity, 100),
          retentionDays: availability.retentionDays as number,
          eventNames: array(availability.eventNames).map((value) =>
            string(value, 100),
          ),
          outcomes: array(availability.outcomes).map((value) =>
            string(value, 100),
          ),
          persistence: string(availability.persistence, 100),
        },
      }
    },
    async exportAudit(orgId, filter = {}) {
      unlocked(orgId)
      return (
        await authorized(
          `${orgPath(orgId)}/audit-events/export${auditQuery(filter, true)}`,
          { csv: true },
        )
      ).value as Blob
    },
  }
  const visibility = () => {
    if (document.visibilityState === 'hidden') lock()
  }
  const pagehide = () => {
    invitation = undefined
    reset('signedOut')
  }
  if (options.lifecycle !== false) {
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', visibility)
    if (typeof window !== 'undefined')
      window.addEventListener('pagehide', pagehide)
  }
  return client
}
