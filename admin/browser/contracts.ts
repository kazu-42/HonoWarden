export type Role = 0 | 1 | 2
export type MemberStatus = -1 | 0 | 1 | 2
export type CollectionGrant = {
  id: string
  readOnly: boolean
  hidePasswords: boolean
  manage: boolean
}
export type OrganizationView = {
  id: string
  name: string
  role: Role
}
export type CollectionView = {
  id: string
  organizationId: string
  name:
    | { status: 'decrypted'; value: string }
    | { status: 'unavailable'; code: string }
}
export type MemberView = {
  id: string
  userId: string | null
  name: string | null
  email: string
  status: MemberStatus
  type: Role
  collections: readonly CollectionGrant[]
}
export type GroupView = { id: string; organizationId: string; name: string }
export type GroupEditorView = GroupView & {
  memberIds: readonly string[]
  collections: readonly CollectionGrant[]
  revision: string
}
export type GroupInput = {
  name: string
  memberIds: readonly string[]
  collections: readonly CollectionGrant[]
  revision?: string
}
export type PolicyView = { required: boolean; revision: string | null }
export type AuditFilter = {
  from?: string
  to?: string
  eventName?: string
  actorUserId?: string
  continuationToken?: string
  limit?: number
}
export type AuditEventView = {
  id: string
  occurredAt: string
  name: string
  actorUserId: string | null
  targetId: string | null
  targetType: string
  outcome: 'success'
}
export type AuditPage = {
  data: readonly AuditEventView[]
  continuationToken: string | null
  query: {
    from: string
    to: string
    eventName: string | null
    actorUserId: string | null
    limit: number
  }
  availability: {
    coverage: 'partial'
    recordedActivity: string
    retentionDays: number
    eventNames: readonly string[]
    outcomes: readonly string[]
    persistence: string
  }
}
export type SessionView = {
  phase:
    | 'signedOut'
    | 'authenticating'
    | 'totpRequired'
    | 'locked'
    | 'unlocked'
    | 'expired'
  email?: string
  organizations?: readonly OrganizationView[]
  pendingInvitation?: { organizationId: string; membershipId: string }
  mfaRequired?: boolean
  mfaVerified?: boolean
  totpEnabled?: boolean
}
export type TotpSetupView = { secret: string; uri: string }
export type AdminErrorKind =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'conflict'
  | 'unavailable'
  | 'rateLimit'
  | 'transport'
  | 'crypto'
  | 'cancelled'
export class AdminError extends Error {
  override readonly name = 'AdminError'
  readonly kind: AdminErrorKind
  readonly code: string
  readonly httpStatus?: number
  readonly requestId?: string
  readonly persisted?: true
  readonly membershipIds?: readonly string[]
  readonly retryAfterSeconds?: number
  constructor(
    kind: AdminErrorKind,
    code: string,
    detail: {
      httpStatus?: number
      requestId?: string
      persisted?: true
      membershipIds?: readonly string[]
      retryAfterSeconds?: number
    } = {},
  ) {
    super(code)
    this.kind = kind
    this.code = code
    Object.assign(this, detail)
  }
}
export interface AdminClient {
  getSession(): SessionView
  subscribe(listener: (state: SessionView) => void): () => void
  login(email: string, password: string): Promise<void>
  verifyTotp(code: string): Promise<void>
  stepUpTotp(code: string): Promise<void>
  startTotpSetup(): Promise<TotpSetupView>
  verifyTotpSetup(code: string): Promise<void>
  startTotpChange(currentCode: string): Promise<TotpSetupView>
  verifyTotpChange(code: string): Promise<void>
  unlock(password: string): Promise<void>
  lock(): void
  logout(): Promise<void>
  dispose(): void
  sync(): Promise<void>
  acceptPendingInvitation(): Promise<void>
  createOrganization(input: {
    name: string
    collectionName: string
    billingEmail?: string
  }): Promise<OrganizationView>
  listMembers(orgId: string): Promise<readonly MemberView[]>
  inviteMembers(
    orgId: string,
    input: {
      emails: readonly string[]
      type: Role
      collections: readonly CollectionGrant[]
    },
  ): Promise<void>
  confirmMember(orgId: string, memberId: string): Promise<void>
  updateMember(
    orgId: string,
    memberId: string,
    input: { type: Role; collections: readonly CollectionGrant[] },
  ): Promise<void>
  reinviteMember(orgId: string, memberId: string): Promise<void>
  revokeMember(orgId: string, memberId: string): Promise<void>
  removeMember(orgId: string, memberId: string): Promise<void>
  listCollections(orgId: string): Promise<readonly CollectionView[]>
  createCollection(
    orgId: string,
    input: { name: string },
  ): Promise<CollectionView>
  updateCollection(
    orgId: string,
    collectionId: string,
    input: { name: string },
  ): Promise<CollectionView>
  deleteCollection(orgId: string, collectionId: string): Promise<void>
  listGroups(orgId: string): Promise<readonly GroupView[]>
  getGroup(orgId: string, groupId: string): Promise<GroupEditorView>
  createGroup(orgId: string, input: GroupInput): Promise<GroupView>
  updateGroup(
    orgId: string,
    groupId: string,
    input: GroupInput,
  ): Promise<GroupView>
  removeGroup(orgId: string, groupId: string): Promise<void>
  getGroupMembers(orgId: string, groupId: string): Promise<readonly string[]>
  setGroupMembers(
    orgId: string,
    groupId: string,
    memberIds: readonly string[],
  ): Promise<void>
  getGroupCollections(
    orgId: string,
    groupId: string,
  ): Promise<readonly CollectionGrant[]>
  setGroupCollections(
    orgId: string,
    groupId: string,
    grants: readonly CollectionGrant[],
  ): Promise<void>
  getPolicy(orgId: string): Promise<PolicyView>
  updatePolicy(orgId: string, input: { required: boolean }): Promise<PolicyView>
  listAudit(orgId: string, filter?: AuditFilter): Promise<AuditPage>
  exportAudit(orgId: string, filter?: AuditFilter): Promise<Blob>
}
