import {
  organizationAccessActorCte,
  organizationAccessActorValues,
  organizationCollectionAccessCte,
  type OrganizationAccessContext,
} from './organization-collection-access-sql'
import type { OrganizationPolicyActor } from './organization-policy-sql'

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

export type OrganizationCollectionWriteInput = OrganizationAccessContext & {
  id: string
  organizationId: string
  organizationUserId: string
  userId: string
  encryptedName: string
  externalId: string | null
  now: string
}

export type OrganizationCollectionUpdateInput = OrganizationAccessContext & {
  id: string
  organizationId: string
  userId: string
  encryptedName: string | null
  externalId: string | null | undefined
  now: string
}

export type OrganizationFoundationInput = OrganizationAccessContext & {
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
          WITH ${organizationAccessActorCte}
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
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM active_organization_actor)
        `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
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
          WITH ${organizationAccessActorCte}
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
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE changes() = 1
            AND EXISTS (SELECT 1 FROM active_organization_actor)
            AND EXISTS (
              SELECT 1 FROM organizations created_organization
              WHERE created_organization.id = ?
                AND created_organization.revision_date = ?
                AND created_organization.created_at = ?
            )
        `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
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
        input.organizationId,
        input.now,
        input.now,
      ),
    database
      .prepare(
        `
          WITH ${organizationAccessActorCte}
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
            AND EXISTS (SELECT 1 FROM active_organization_actor)
            AND EXISTS (
              SELECT 1 FROM organizations created_organization
              INNER JOIN organization_users created_owner
                ON created_owner.organization_id = created_organization.id
              WHERE created_organization.id = ?
                AND created_organization.revision_date = ?
                AND created_organization.created_at = ?
                AND created_owner.id = ? AND created_owner.user_id = ?
                AND created_owner.status = 2 AND created_owner.type = 0
            )
        `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.collectionId,
        input.organizationId,
        input.encryptedCollectionName,
        null,
        0,
        input.now,
        input.now,
        input.organizationId,
        input.now,
        input.now,
        input.organizationUserId,
        input.userId,
      ),
    database
      .prepare(
        `
          WITH ${organizationAccessActorCte}
          INSERT INTO collection_users (
            collection_id,
            organization_user_id,
            read_only,
            hide_passwords,
            manage
          )
          SELECT ?, ?, ?, ?, ?
          WHERE changes() = 1
            AND EXISTS (SELECT 1 FROM active_organization_actor)
            AND EXISTS (
              SELECT 1 FROM organizations created_organization
              INNER JOIN organization_users created_owner
                ON created_owner.organization_id = created_organization.id
              INNER JOIN collections created_collection
                ON created_collection.organization_id = created_organization.id
              WHERE created_organization.id = ?
                AND created_organization.revision_date = ?
                AND created_organization.created_at = ?
                AND created_owner.id = ? AND created_owner.user_id = ?
                AND created_owner.status = 2 AND created_owner.type = 0
                AND created_collection.id = ? AND created_collection.revision_date = ?
            )
        `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.collectionId,
        input.organizationUserId,
        0,
        0,
        1,
        input.organizationId,
        input.now,
        input.now,
        input.organizationUserId,
        input.userId,
        input.collectionId,
        input.now,
      ),
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

type OrganizationMemberInput = OrganizationAccessContext & {
  organizationId: string
  userId: string
}
type OrganizationCollectionMemberInput = OrganizationMemberInput & {
  collectionId: string
}

const collectionSelect = `
  SELECT collection.id, collection.organization_id AS organizationId,
    collection.encrypted_name AS encryptedName, collection.external_id AS externalId,
    collection.type, collection.revision_date AS revisionDate,
    access.readOnly, access.hidePasswords, access.manage
  FROM collections collection
  INNER JOIN accessible_organization_collections access
    ON access.collectionId = collection.id
    AND access.organizationId = collection.organization_id
`

export async function findOrganizationForConfirmedMember(
  database: OrganizationReadDatabase,
  input: OrganizationMemberInput,
): Promise<OrganizationRecord | null> {
  const row = await database
    .prepare(
      `
    ${organizationCollectionAccessCte}
    SELECT organization.id, organization.name,
      organization.billing_email AS billingEmail, organization.plan_type AS planType,
      organization.public_key AS publicKey, organization.private_key AS privateKey,
      organization.enabled, organization.use_totp AS useTotp,
      organization.revision_date AS revisionDate
    FROM organizations organization
    INNER JOIN confirmed_memberships membership ON membership.organizationId = organization.id
    WHERE organization.id = ? LIMIT 1
  `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.organizationId,
    )
    .first<OrganizationRow>()
  return row ? organizationFromRow(row) : null
}

export async function listConfirmedOrganizationMemberships(
  database: OrganizationReadDatabase,
  userId: string,
  actor?: OrganizationPolicyActor,
): Promise<OrganizationMembershipRecord[]> {
  const result = await database
    .prepare(
      `
    ${organizationCollectionAccessCte}
    SELECT organization.id, organization.name,
      organization.billing_email AS billingEmail, organization.plan_type AS planType,
      organization.public_key AS publicKey, organization.private_key AS privateKey,
      organization.enabled, organization.use_totp AS useTotp,
      organization.revision_date AS revisionDate,
      membership.organizationUserId, membership.orgKey, 2 AS status,
      membership.type, membership.permissions
    FROM organizations organization
    INNER JOIN confirmed_memberships membership ON membership.organizationId = organization.id
    ORDER BY organization.id ASC
  `,
    )
    .bind(...organizationAccessActorValues(userId, actor))
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
  actor?: OrganizationPolicyActor,
): Promise<OrganizationCollectionRecord[]> {
  const result = await database
    .prepare(
      `
    ${organizationCollectionAccessCte}
    ${collectionSelect}
    ORDER BY collection.id ASC
  `,
    )
    .bind(...organizationAccessActorValues(userId, actor))
    .all<OrganizationCollectionRow>()
  return result.results.map(collectionFromRow)
}

export async function findConfirmedOrganizationOwner(
  database: OrganizationReadDatabase,
  input: OrganizationMemberInput,
): Promise<OrganizationOwnerMembershipRecord | null> {
  return database
    .prepare(
      `
    ${organizationCollectionAccessCte}
    SELECT membership.organizationUserId, membership.organizationId, membership.userId
    FROM confirmed_memberships membership
    WHERE membership.organizationId = ? AND membership.type = 0 LIMIT 1
  `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.organizationId,
    )
    .first<OrganizationOwnerMembershipRecord>()
}

export async function listAccessibleOrganizationCollectionsByOrganization(
  database: OrganizationReadDatabase,
  input: OrganizationMemberInput,
): Promise<OrganizationCollectionRecord[]> {
  const result = await database
    .prepare(
      `
    ${organizationCollectionAccessCte}
    ${collectionSelect}
    WHERE collection.organization_id = ? ORDER BY collection.id ASC
  `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.organizationId,
    )
    .all<OrganizationCollectionRow>()
  return result.results.map(collectionFromRow)
}

export async function findAccessibleOrganizationCollection(
  database: OrganizationReadDatabase,
  input: OrganizationCollectionMemberInput,
): Promise<OrganizationCollectionRecord | null> {
  const row = await database
    .prepare(
      `
    ${organizationCollectionAccessCte}
    ${collectionSelect}
    WHERE collection.organization_id = ? AND collection.id = ? LIMIT 1
  `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.organizationId,
      input.collectionId,
    )
    .first<OrganizationCollectionRow>()
  return row ? collectionFromRow(row) : null
}

export async function findOwnerOrganizationCollection(
  database: OrganizationReadDatabase,
  input: OrganizationCollectionMemberInput,
): Promise<OrganizationCollectionRecord | null> {
  const row = await database
    .prepare(
      `
    ${organizationCollectionAccessCte}
    ${collectionSelect}
    INNER JOIN confirmed_memberships membership
      ON membership.organizationUserId = access.organizationUserId
      AND membership.organizationId = collection.organization_id
    WHERE collection.organization_id = ? AND collection.id = ?
      AND membership.type = 0 AND access.manage = 1 AND access.readOnly = 0 LIMIT 1
  `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.organizationId,
      input.collectionId,
    )
    .first<OrganizationCollectionRow>()
  return row ? collectionFromRow(row) : null
}

export async function listOrganizationCollectionUsersForOwner(
  database: OrganizationReadDatabase,
  input: OrganizationCollectionMemberInput,
): Promise<OrganizationCollectionUserRecord[]> {
  const result = await database
    .prepare(
      `
    ${organizationCollectionAccessCte}
    SELECT assigned_membership.id AS organizationUserId,
      collection_user.read_only AS readOnly,
      collection_user.hide_passwords AS hidePasswords, collection_user.manage
    FROM collections collection
    INNER JOIN confirmed_memberships owner_membership
      ON owner_membership.organizationId = collection.organization_id AND owner_membership.type = 0
    INNER JOIN collection_users collection_user ON collection_user.collection_id = collection.id
    INNER JOIN organization_users assigned_membership
      ON assigned_membership.id = collection_user.organization_user_id
      AND assigned_membership.organization_id = collection.organization_id
    WHERE collection.organization_id = ? AND collection.id = ?
    ORDER BY assigned_membership.id ASC
  `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.organizationId,
      input.collectionId,
    )
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
      ${organizationCollectionAccessCte}
      UPDATE organizations SET revision_date = ?, updated_at = ?
      WHERE id = ? AND enabled = 1 AND EXISTS (
        SELECT 1 FROM confirmed_memberships membership
        WHERE membership.organizationUserId = ? AND membership.organizationId = organizations.id
          AND membership.type = 0
      )
    `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.now,
        input.now,
        input.organizationId,
        input.organizationUserId,
      ),
    database
      .prepare(
        `
      ${organizationCollectionAccessCte}
      INSERT INTO collections (id, organization_id, encrypted_name, external_id, type, revision_date, created_at)
      SELECT ?, ?, ?, ?, 0, ?, ? WHERE changes() = 1
        AND EXISTS (SELECT 1 FROM confirmed_memberships membership
          WHERE membership.organizationId = ? AND membership.organizationUserId = ? AND membership.type = 0)
    `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.id,
        input.organizationId,
        input.encryptedName,
        input.externalId,
        input.now,
        input.now,
        input.organizationId,
        input.organizationUserId,
      ),
    database
      .prepare(
        `
      ${organizationCollectionAccessCte}
      INSERT INTO collection_users (collection_id, organization_user_id, read_only, hide_passwords, manage)
      SELECT ?, ?, 0, 0, 1 WHERE changes() = 1
        AND EXISTS (SELECT 1 FROM confirmed_memberships membership
          WHERE membership.organizationId = ? AND membership.organizationUserId = ? AND membership.type = 0)
    `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.id,
        input.organizationUserId,
        input.organizationId,
        input.organizationUserId,
      ),
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
  const ownerPredicate = `
    EXISTS (SELECT 1 FROM accessible_organization_collections access
      INNER JOIN confirmed_memberships membership
        ON membership.organizationUserId = access.organizationUserId
        AND membership.organizationId = access.organizationId
      WHERE access.collectionId = ? AND access.organizationId = ?
        AND membership.type = 0 AND access.manage = 1 AND access.readOnly = 0)
  `
  const statements = [
    database
      .prepare(
        `
      ${organizationCollectionAccessCte}
      UPDATE organizations SET revision_date = ?, updated_at = ?
      WHERE id = ? AND enabled = 1 AND ${ownerPredicate}
    `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.now,
        input.now,
        input.organizationId,
        input.id,
        input.organizationId,
      ),
    database
      .prepare(
        `
      ${organizationCollectionAccessCte}
      UPDATE collections SET encrypted_name = COALESCE(?, encrypted_name),
        external_id = CASE WHEN ? = 1 THEN ? ELSE external_id END, revision_date = ?
      WHERE id = ? AND organization_id = ? AND changes() = 1 AND ${ownerPredicate}
    `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.encryptedName,
        input.externalId === undefined ? 0 : 1,
        input.externalId ?? null,
        input.now,
        input.id,
        input.organizationId,
        input.id,
        input.organizationId,
      ),
  ]
  const results = await database.batch(statements)
  if (
    results.length !== statements.length ||
    results.some((result) => !result.success || result.meta.changes !== 1)
  )
    return null
  const updated = await findOwnerOrganizationCollection(database, {
    organizationId: input.organizationId,
    collectionId: input.id,
    userId: input.userId,
    actor: input.actor,
  })
  if (!updated)
    throw new Error('Updated organization collection could not be read back.')
  return updated
}

export async function deleteOrganizationCollection(
  database: OrganizationDatabase,
  input: OrganizationCollectionMemberInput & { now: string },
): Promise<boolean> {
  return deleteOrganizationCollections(database, {
    organizationId: input.organizationId,
    collectionIds: [input.collectionId],
    userId: input.userId,
    now: input.now,
    actor: input.actor,
  })
}

export async function deleteOrganizationCollections(
  database: OrganizationDatabase,
  input: OrganizationMemberInput & { collectionIds: string[]; now: string },
): Promise<boolean> {
  if (
    input.collectionIds.length === 0 ||
    input.collectionIds.length > 100 ||
    new Set(input.collectionIds).size !== input.collectionIds.length
  )
    return false
  const collectionIdsJson = JSON.stringify(input.collectionIds)
  const statements = [
    database
      .prepare(
        `
      ${organizationCollectionAccessCte}
      UPDATE organizations SET revision_date = ?, updated_at = ?
      WHERE id = ? AND enabled = 1 AND (
        SELECT COUNT(DISTINCT access.collectionId)
        FROM accessible_organization_collections access
        INNER JOIN confirmed_memberships membership
          ON membership.organizationUserId = access.organizationUserId
          AND membership.organizationId = access.organizationId
        WHERE access.organizationId = organizations.id AND membership.type = 0
          AND access.manage = 1 AND access.readOnly = 0 AND access.collectionId IN (SELECT value FROM json_each(?))
      ) = ?
      AND NOT EXISTS (
        SELECT 1 FROM collection_ciphers selected_mapping
        INNER JOIN ciphers selected_cipher ON selected_cipher.id = selected_mapping.cipher_id
        WHERE selected_cipher.organization_id = organizations.id
          AND selected_mapping.collection_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (
            SELECT 1 FROM collection_ciphers surviving_mapping
            INNER JOIN collections surviving_collection ON surviving_collection.id = surviving_mapping.collection_id
            WHERE surviving_mapping.cipher_id = selected_cipher.id
              AND surviving_collection.organization_id = organizations.id
              AND surviving_mapping.collection_id NOT IN (SELECT value FROM json_each(?))
          )
      )
    `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.now,
        input.now,
        input.organizationId,
        collectionIdsJson,
        input.collectionIds.length,
        collectionIdsJson,
        collectionIdsJson,
      ),
    database
      .prepare(
        `
      ${organizationCollectionAccessCte}
      DELETE FROM collections WHERE organization_id = ? AND id IN (SELECT value FROM json_each(?)) AND changes() = 1
        AND EXISTS (SELECT 1 FROM accessible_organization_collections access
          INNER JOIN confirmed_memberships membership ON membership.organizationUserId = access.organizationUserId
            AND membership.organizationId = access.organizationId
          WHERE access.organizationId = collections.organization_id AND access.collectionId = collections.id
            AND membership.type = 0 AND access.manage = 1 AND access.readOnly = 0)
      RETURNING id
    `,
      )
      .bind(
        ...organizationAccessActorValues(input.userId, input.actor),
        input.organizationId,
        collectionIdsJson,
      ),
  ]
  const results = await database.batch(statements)
  // D1 meta.changes includes cascades; RETURNING counts only collection rows.
  return (
    results.length === statements.length &&
    results[0]?.success === true &&
    results[0].meta.changes === 1 &&
    results[1]?.success === true &&
    results[1].results.length === input.collectionIds.length
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
