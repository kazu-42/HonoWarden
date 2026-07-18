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
  externalId: string | null
  readOnly: boolean
  hidePasswords: boolean
  manage: boolean
  type: number
  revisionDate: string
}

export type OrganizationCollectionUserRecord = {
  organizationUserId: string
  readOnly: boolean
  hidePasswords: boolean
  manage: boolean
}

export type OrganizationOwnerMembershipRecord = {
  organizationUserId: string
  organizationId: string
  userId: string
}

export type OrganizationCollectionWriteInput = {
  id: string
  organizationId: string
  organizationUserId: string
  userId: string
  encryptedName: string
  externalId: string | null
  now: string
}

export type OrganizationCollectionUpdateInput = {
  id: string
  organizationId: string
  userId: string
  encryptedName: string | null
  externalId: string | null | undefined
  now: string
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

type OrganizationCollectionUserRow = Omit<
  OrganizationCollectionUserRecord,
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
      externalId: null,
      readOnly: false,
      hidePasswords: false,
      manage: true,
      type: 0,
      revisionDate: input.now,
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
          collection.external_id as externalId,
          collection.type,
          collection.revision_date as revisionDate,
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

  return result.results.map(collectionFromRow)
}

export async function findConfirmedOrganizationOwner(
  database: OrganizationReadDatabase,
  input: { organizationId: string; userId: string },
): Promise<OrganizationOwnerMembershipRecord | null> {
  return database
    .prepare(
      `
        SELECT
          membership.id as organizationUserId,
          membership.organization_id as organizationId,
          membership.user_id as userId
        FROM organization_users membership
        WHERE membership.organization_id = ?
          AND membership.user_id = ?
          AND membership.status = 2
          AND membership.type = 0
        LIMIT 1
      `,
    )
    .bind(input.organizationId, input.userId)
    .first<OrganizationOwnerMembershipRecord>()
}

export async function listAccessibleOrganizationCollectionsByOrganization(
  database: OrganizationReadDatabase,
  input: { organizationId: string; userId: string },
): Promise<OrganizationCollectionRecord[]> {
  const result = await database
    .prepare(
      `
        SELECT
          collection.id,
          collection.organization_id as organizationId,
          collection.encrypted_name as encryptedName,
          collection.external_id as externalId,
          collection.type,
          collection.revision_date as revisionDate,
          collection_user.read_only as readOnly,
          collection_user.hide_passwords as hidePasswords,
          collection_user.manage
        FROM collections collection
        INNER JOIN collection_users collection_user
          ON collection_user.collection_id = collection.id
        INNER JOIN organization_users membership
          ON membership.id = collection_user.organization_user_id
          AND membership.organization_id = collection.organization_id
        WHERE collection.organization_id = ?
          AND membership.user_id = ?
          AND membership.status = 2
        ORDER BY collection.id ASC
      `,
    )
    .bind(input.organizationId, input.userId)
    .all<OrganizationCollectionRow>()

  return result.results.map(collectionFromRow)
}

export async function findAccessibleOrganizationCollection(
  database: OrganizationReadDatabase,
  input: { organizationId: string; collectionId: string; userId: string },
): Promise<OrganizationCollectionRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          collection.id,
          collection.organization_id as organizationId,
          collection.encrypted_name as encryptedName,
          collection.external_id as externalId,
          collection.type,
          collection.revision_date as revisionDate,
          collection_user.read_only as readOnly,
          collection_user.hide_passwords as hidePasswords,
          collection_user.manage
        FROM collections collection
        INNER JOIN collection_users collection_user
          ON collection_user.collection_id = collection.id
        INNER JOIN organization_users membership
          ON membership.id = collection_user.organization_user_id
          AND membership.organization_id = collection.organization_id
        WHERE collection.organization_id = ?
          AND collection.id = ?
          AND membership.user_id = ?
          AND membership.status = 2
        LIMIT 1
      `,
    )
    .bind(input.organizationId, input.collectionId, input.userId)
    .first<OrganizationCollectionRow>()

  return row ? collectionFromRow(row) : null
}

export async function findOwnerOrganizationCollection(
  database: OrganizationReadDatabase,
  input: { organizationId: string; collectionId: string; userId: string },
): Promise<OrganizationCollectionRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          collection.id,
          collection.organization_id as organizationId,
          collection.encrypted_name as encryptedName,
          collection.external_id as externalId,
          collection.type,
          collection.revision_date as revisionDate,
          collection_user.read_only as readOnly,
          collection_user.hide_passwords as hidePasswords,
          collection_user.manage
        FROM collections collection
        INNER JOIN organization_users membership
          ON membership.organization_id = collection.organization_id
        INNER JOIN collection_users collection_user
          ON collection_user.collection_id = collection.id
          AND collection_user.organization_user_id = membership.id
        WHERE collection.organization_id = ?
          AND collection.id = ?
          AND membership.user_id = ?
          AND membership.status = 2
          AND membership.type = 0
          AND collection_user.manage = 1
        LIMIT 1
      `,
    )
    .bind(input.organizationId, input.collectionId, input.userId)
    .first<OrganizationCollectionRow>()

  return row ? collectionFromRow(row) : null
}

export async function listOrganizationCollectionUsersForOwner(
  database: OrganizationReadDatabase,
  input: { organizationId: string; collectionId: string; userId: string },
): Promise<OrganizationCollectionUserRecord[]> {
  const result = await database
    .prepare(
      `
        SELECT
          assigned_membership.id as organizationUserId,
          collection_user.read_only as readOnly,
          collection_user.hide_passwords as hidePasswords,
          collection_user.manage
        FROM collections collection
        INNER JOIN organization_users owner_membership
          ON owner_membership.organization_id = collection.organization_id
        INNER JOIN collection_users collection_user
          ON collection_user.collection_id = collection.id
        INNER JOIN organization_users assigned_membership
          ON assigned_membership.id = collection_user.organization_user_id
          AND assigned_membership.organization_id = collection.organization_id
        WHERE collection.organization_id = ?
          AND collection.id = ?
          AND owner_membership.user_id = ?
          AND owner_membership.status = 2
          AND owner_membership.type = 0
        ORDER BY assigned_membership.id ASC
      `,
    )
    .bind(input.organizationId, input.collectionId, input.userId)
    .all<OrganizationCollectionUserRow>()

  return result.results.map(collectionUserFromRow)
}

export async function createOrganizationCollection(
  database: OrganizationDatabase,
  input: OrganizationCollectionWriteInput,
): Promise<OrganizationCollectionRecord> {
  const statements = [
    database
      .prepare(
        `
          UPDATE organizations
          SET revision_date = ?, updated_at = ?
          WHERE id = ?
            AND EXISTS (
              SELECT 1
              FROM organization_users owner_membership
              WHERE owner_membership.id = ?
                AND owner_membership.organization_id = organizations.id
                AND owner_membership.user_id = ?
                AND owner_membership.status = 2
                AND owner_membership.type = 0
            )
        `,
      )
      .bind(
        input.now,
        input.now,
        input.organizationId,
        input.organizationUserId,
        input.userId,
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
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE changes() = 1
        `,
      )
      .bind(
        input.id,
        input.organizationId,
        input.encryptedName,
        input.externalId,
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
          SELECT ?, ?, ?, ?, ?
          WHERE changes() = 1
        `,
      )
      .bind(input.id, input.organizationUserId, 0, 0, 1),
  ]
  const results = await database.batch(statements)

  if (
    results.length !== statements.length ||
    results.some((result) => !result.success || result.meta.changes !== 1)
  ) {
    throw new Error('Organization collection batch did not fully apply.')
  }

  return {
    id: input.id,
    organizationId: input.organizationId,
    encryptedName: input.encryptedName,
    externalId: input.externalId,
    readOnly: false,
    hidePasswords: false,
    manage: true,
    type: 0,
    revisionDate: input.now,
  }
}

export async function updateOrganizationCollection(
  database: OrganizationDatabase,
  input: OrganizationCollectionUpdateInput,
): Promise<OrganizationCollectionRecord | null> {
  const statements = [
    database
      .prepare(
        `
          UPDATE organizations
          SET revision_date = ?, updated_at = ?
          WHERE id = ?
            AND EXISTS (
              SELECT 1
              FROM collections candidate
              INNER JOIN organization_users owner_membership
                ON owner_membership.organization_id = candidate.organization_id
              INNER JOIN collection_users owner_access
                ON owner_access.organization_user_id = owner_membership.id
                AND owner_access.collection_id = candidate.id
              WHERE candidate.id = ?
                AND candidate.organization_id = organizations.id
                AND owner_membership.user_id = ?
                AND owner_membership.status = 2
                AND owner_membership.type = 0
                AND owner_access.manage = 1
            )
        `,
      )
      .bind(input.now, input.now, input.organizationId, input.id, input.userId),
    database
      .prepare(
        `
          UPDATE collections
          SET
            encrypted_name = COALESCE(?, encrypted_name),
            external_id = CASE WHEN ? = 1 THEN ? ELSE external_id END,
            revision_date = ?
          WHERE id = ?
            AND organization_id = ?
            AND changes() = 1
        `,
      )
      .bind(
        input.encryptedName,
        input.externalId === undefined ? 0 : 1,
        input.externalId ?? null,
        input.now,
        input.id,
        input.organizationId,
      ),
  ]
  const results = await database.batch(statements)

  if (
    results.length !== statements.length ||
    results.some((result) => !result.success || result.meta.changes !== 1)
  ) {
    return null
  }

  const updated = await findOwnerOrganizationCollection(database, {
    organizationId: input.organizationId,
    collectionId: input.id,
    userId: input.userId,
  })
  if (!updated) {
    throw new Error('Updated organization collection could not be read back.')
  }

  return updated
}

export async function deleteOrganizationCollection(
  database: OrganizationDatabase,
  input: {
    organizationId: string
    collectionId: string
    userId: string
    now: string
  },
): Promise<boolean> {
  return deleteOrganizationCollections(database, {
    organizationId: input.organizationId,
    collectionIds: [input.collectionId],
    userId: input.userId,
    now: input.now,
  })
}

export async function deleteOrganizationCollections(
  database: OrganizationDatabase,
  input: {
    organizationId: string
    collectionIds: string[]
    userId: string
    now: string
  },
): Promise<boolean> {
  const placeholders = input.collectionIds.map(() => '?').join(', ')
  const statements = [
    database
      .prepare(
        `
          UPDATE organizations
          SET revision_date = ?, updated_at = ?
          WHERE id = ?
            AND (
              SELECT COUNT(DISTINCT candidate.id)
              FROM collections candidate
              INNER JOIN organization_users owner_membership
                ON owner_membership.organization_id = candidate.organization_id
              INNER JOIN collection_users owner_access
                ON owner_access.organization_user_id = owner_membership.id
                AND owner_access.collection_id = candidate.id
              WHERE owner_membership.user_id = ?
                AND owner_membership.status = 2
                AND owner_membership.type = 0
                AND owner_access.manage = 1
                AND candidate.organization_id = organizations.id
                AND candidate.id IN (${placeholders})
            ) = ?
            AND NOT EXISTS (
              SELECT 1
              FROM collection_ciphers selected_mapping
              INNER JOIN ciphers selected_cipher
                ON selected_cipher.id = selected_mapping.cipher_id
              WHERE selected_cipher.organization_id = organizations.id
                AND selected_mapping.collection_id IN (${placeholders})
                AND NOT EXISTS (
                  SELECT 1
                  FROM collection_ciphers surviving_mapping
                  INNER JOIN collections surviving_collection
                    ON surviving_collection.id = surviving_mapping.collection_id
                  WHERE surviving_mapping.cipher_id = selected_cipher.id
                    AND surviving_collection.organization_id = organizations.id
                    AND surviving_mapping.collection_id NOT IN (${placeholders})
                )
            )
        `,
      )
      .bind(
        input.now,
        input.now,
        input.organizationId,
        input.userId,
        ...input.collectionIds,
        input.collectionIds.length,
        ...input.collectionIds,
        ...input.collectionIds,
      ),
    database
      .prepare(
        `
        DELETE FROM collections
        WHERE organization_id = ?
          AND id IN (${placeholders})
          AND changes() = 1
      `,
      )
      .bind(input.organizationId, ...input.collectionIds),
  ]
  const results = await database.batch(statements)

  return (
    results.length === statements.length &&
    results[0]?.success === true &&
    results[0].meta.changes === 1 &&
    results[1]?.success === true &&
    results[1].meta.changes === input.collectionIds.length
  )
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

function collectionFromRow(
  row: OrganizationCollectionRow,
): OrganizationCollectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    encryptedName: row.encryptedName,
    externalId: row.externalId ?? null,
    readOnly: Boolean(row.readOnly),
    hidePasswords: Boolean(row.hidePasswords),
    manage: Boolean(row.manage),
    type: row.type,
    revisionDate: row.revisionDate,
  }
}

function collectionUserFromRow(
  row: OrganizationCollectionUserRow,
): OrganizationCollectionUserRecord {
  return {
    organizationUserId: row.organizationUserId,
    readOnly: Boolean(row.readOnly),
    hidePasswords: Boolean(row.hidePasswords),
    manage: Boolean(row.manage),
  }
}
