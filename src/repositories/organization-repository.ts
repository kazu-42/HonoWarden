export type OrganizationRecord = {
  id: string
  name: string
  billingEmail: string | null
  planType: number
  publicKey: string | null
  privateKey: string | null
  enabled: boolean
  useTotp: boolean
  revisionDate: string
}

export type OrganizationMembershipRecord = OrganizationRecord & {
  organizationUserId: string
  orgKey: string | null
  status: number
  type: number
  permissions: string | null
}

export type OrganizationCollectionRecord = {
  id: string
  organizationId: string
  encryptedName: string
  readOnly: boolean
  hidePasswords: boolean
  manage: boolean
  type: number
}

export type OrganizationFoundationInput = {
  organizationId: string
  organizationUserId: string
  collectionId: string
  userId: string
  email: string
  name: string
  billingEmail: string | null
  planType: number
  orgKey: string
  publicKey: string
  privateKey: string
  encryptedCollectionName: string
  now: string
}

export type OrganizationFoundation = {
  organization: OrganizationRecord
  organizationUserId: string
  collection: OrganizationCollectionRecord
}

type OrganizationDatabase = Pick<D1Database, 'batch' | 'prepare'>
type OrganizationReadDatabase = Pick<D1Database, 'prepare'>

type OrganizationRow = Omit<OrganizationRecord, 'enabled' | 'useTotp'> & {
  enabled: number | boolean
  useTotp: number | boolean
}

type OrganizationMembershipRow = OrganizationRow & {
  organizationUserId: string
  orgKey: string | null
  status: number
  type: number
  permissions: string | null
}

type OrganizationCollectionRow = Omit<
  OrganizationCollectionRecord,
  'readOnly' | 'hidePasswords' | 'manage'
> & {
  readOnly: number | boolean
  hidePasswords: number | boolean
  manage: number | boolean
}

export async function createOrganizationFoundation(
  database: OrganizationDatabase,
  input: OrganizationFoundationInput,
): Promise<OrganizationFoundation> {
  const statements = [
    database
      .prepare(
        `
          INSERT INTO organizations (
            id,
            name,
            billing_email,
            plan_type,
            public_key,
            private_key,
            enabled,
            use_totp,
            revision_date,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.organizationId,
        input.name,
        input.billingEmail,
        input.planType,
        input.publicKey,
        input.privateKey,
        1,
        1,
        input.now,
        input.now,
        input.now,
      ),
    database
      .prepare(
        `
          INSERT INTO organization_users (
            id,
            organization_id,
            user_id,
            email,
            org_key,
            status,
            type,
            permissions,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.organizationUserId,
        input.organizationId,
        input.userId,
        input.email,
        input.orgKey,
        2,
        0,
        null,
        input.now,
        input.now,
      ),
    database
      .prepare(
        `
          INSERT INTO collections (
            id,
            organization_id,
            encrypted_name,
            external_id,
            type,
            revision_date,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.collectionId,
        input.organizationId,
        input.encryptedCollectionName,
        null,
        0,
        input.now,
        input.now,
      ),
    database
      .prepare(
        `
          INSERT INTO collection_users (
            collection_id,
            organization_user_id,
            read_only,
            hide_passwords,
            manage
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .bind(input.collectionId, input.organizationUserId, 0, 0, 1),
  ]
  const results = await database.batch(statements)

  if (
    results.length !== statements.length ||
    results.some((result) => !result.success || result.meta.changes !== 1)
  ) {
    throw new Error('Organization foundation batch did not fully apply.')
  }

  return {
    organization: {
      id: input.organizationId,
      name: input.name,
      billingEmail: input.billingEmail,
      planType: input.planType,
      publicKey: input.publicKey,
      privateKey: input.privateKey,
      enabled: true,
      useTotp: true,
      revisionDate: input.now,
    },
    organizationUserId: input.organizationUserId,
    collection: {
      id: input.collectionId,
      organizationId: input.organizationId,
      encryptedName: input.encryptedCollectionName,
      readOnly: false,
      hidePasswords: false,
      manage: true,
      type: 0,
    },
  }
}

export async function findOrganizationForConfirmedMember(
  database: OrganizationReadDatabase,
  input: { organizationId: string; userId: string },
): Promise<OrganizationRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          organization.id,
          organization.name,
          organization.billing_email as billingEmail,
          organization.plan_type as planType,
          organization.public_key as publicKey,
          organization.private_key as privateKey,
          organization.enabled,
          organization.use_totp as useTotp,
          organization.revision_date as revisionDate
        FROM organizations organization
        INNER JOIN organization_users membership
          ON membership.organization_id = organization.id
        WHERE organization.id = ?
          AND membership.user_id = ?
          AND membership.status = 2
        LIMIT 1
      `,
    )
    .bind(input.organizationId, input.userId)
    .first<OrganizationRow>()

  return row ? organizationFromRow(row) : null
}

export async function listConfirmedOrganizationMemberships(
  database: OrganizationReadDatabase,
  userId: string,
): Promise<OrganizationMembershipRecord[]> {
  const result = await database
    .prepare(
      `
        SELECT
          organization.id,
          organization.name,
          organization.billing_email as billingEmail,
          organization.plan_type as planType,
          organization.public_key as publicKey,
          organization.private_key as privateKey,
          organization.enabled,
          organization.use_totp as useTotp,
          organization.revision_date as revisionDate,
          membership.id as organizationUserId,
          membership.org_key as orgKey,
          membership.status,
          membership.type,
          membership.permissions
        FROM organization_users membership
        INNER JOIN organizations organization
          ON organization.id = membership.organization_id
        WHERE membership.user_id = ?
          AND membership.status = 2
        ORDER BY organization.id ASC
      `,
    )
    .bind(userId)
    .all<OrganizationMembershipRow>()

  return result.results.map((row) => ({
    ...organizationFromRow(row),
    organizationUserId: row.organizationUserId,
    orgKey: row.orgKey,
    status: row.status,
    type: row.type,
    permissions: row.permissions,
  }))
}

export async function listAccessibleOrganizationCollections(
  database: OrganizationReadDatabase,
  userId: string,
): Promise<OrganizationCollectionRecord[]> {
  const result = await database
    .prepare(
      `
        SELECT
          collection.id,
          collection.organization_id as organizationId,
          collection.encrypted_name as encryptedName,
          collection.type,
          collection_user.read_only as readOnly,
          collection_user.hide_passwords as hidePasswords,
          collection_user.manage
        FROM collections collection
        INNER JOIN collection_users collection_user
          ON collection_user.collection_id = collection.id
        INNER JOIN organization_users membership
          ON membership.id = collection_user.organization_user_id
          AND membership.organization_id = collection.organization_id
        WHERE membership.user_id = ?
          AND membership.status = 2
        ORDER BY collection.id ASC
      `,
    )
    .bind(userId)
    .all<OrganizationCollectionRow>()

  return result.results.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    encryptedName: row.encryptedName,
    readOnly: Boolean(row.readOnly),
    hidePasswords: Boolean(row.hidePasswords),
    manage: Boolean(row.manage),
    type: row.type,
  }))
}

function organizationFromRow(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    billingEmail: row.billingEmail,
    planType: row.planType,
    publicKey: row.publicKey,
    privateKey: row.privateKey,
    enabled: Boolean(row.enabled),
    useTotp: Boolean(row.useTotp),
    revisionDate: row.revisionDate,
  }
}
