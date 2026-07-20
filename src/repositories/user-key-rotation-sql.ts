export const snapshotSummarySql = `
  SELECT
    users.id,
    users.email_normalized as emailNormalized,
    users.kdf_algorithm as kdfAlgorithm,
    users.kdf_iterations as kdfIterations,
    users.kdf_memory as kdfMemory,
    users.kdf_parallelism as kdfParallelism,
    users.master_password_hash as masterPasswordHash,
    users.user_key as userKey,
    users.public_key as publicKey,
    users.private_key as privateKey,
    users.security_stamp as securityStamp,
    users.revision_date as revisionDate,
    users.disabled_at as disabledAt,
    (SELECT COUNT(*) FROM folders
      WHERE user_id = users.id AND deleted_at IS NULL) as activeFolderCount,
    (SELECT COUNT(*) FROM folders
      WHERE user_id = users.id AND deleted_at IS NOT NULL) as deletedFolderCount,
    (SELECT COALESCE(SUM(length(encrypted_name) + length(revision_date)), 0)
      FROM folders WHERE user_id = users.id) as folderBytes,
    (SELECT COUNT(*) FROM ciphers
      WHERE user_id = users.id
        AND organization_id IS NULL
        AND deleted_at IS NULL) as activeCipherCount,
    (SELECT COUNT(*) FROM ciphers
      WHERE user_id = users.id
        AND organization_id IS NULL
        AND deleted_at IS NOT NULL) as deletedCipherCount,
    (SELECT COUNT(*) FROM ciphers
      WHERE user_id = users.id
        AND organization_id IS NULL
        AND cipher_key IS NOT NULL) as personalCipherKeyCount,
    (SELECT COALESCE(SUM(length(encrypted_json) + length(revision_date)), 0)
      FROM ciphers
      WHERE user_id = users.id AND organization_id IS NULL) as cipherBytes,
    (SELECT COUNT(*)
      FROM cipher_attachments attachment
      INNER JOIN ciphers cipher
        ON cipher.id = attachment.cipher_id
        AND cipher.user_id = attachment.user_id
      WHERE attachment.user_id = users.id
        AND cipher.organization_id IS NULL
        AND attachment.content_type IS NOT NULL) as uploadedAttachmentCount,
    (SELECT COUNT(*)
      FROM cipher_attachments attachment
      INNER JOIN ciphers cipher
        ON cipher.id = attachment.cipher_id
        AND cipher.user_id = attachment.user_id
      WHERE attachment.user_id = users.id
        AND cipher.organization_id IS NULL
        AND attachment.content_type IS NULL) as pendingAttachmentCount,
    (SELECT COALESCE(SUM(
        length(attachment.object_key) +
        length(attachment.file_name) +
        length(attachment.attachment_key) +
        length(COALESCE(attachment.content_type, '')) +
        length(attachment.revision_date)
      ), 0)
      FROM cipher_attachments attachment
      INNER JOIN ciphers cipher
        ON cipher.id = attachment.cipher_id
        AND cipher.user_id = attachment.user_id
      WHERE attachment.user_id = users.id
        AND cipher.organization_id IS NULL) as attachmentBytes,
    (SELECT COUNT(*) FROM devices
      WHERE user_id = users.id
        AND revoked_at IS NULL
        AND encrypted_user_key IS NOT NULL
        AND encrypted_public_key IS NOT NULL
        AND encrypted_private_key IS NOT NULL) as trustedDeviceCount,
    (SELECT COUNT(*) FROM devices
      WHERE user_id = users.id
        AND revoked_at IS NULL
        AND (
          encrypted_user_key IS NOT NULL OR
          encrypted_public_key IS NOT NULL OR
          encrypted_private_key IS NOT NULL
        )
        AND NOT (
          encrypted_user_key IS NOT NULL AND
          encrypted_public_key IS NOT NULL AND
          encrypted_private_key IS NOT NULL
        )) as incompleteTrustedDeviceCount,
    (SELECT COALESCE(SUM(
        length(encrypted_user_key) +
        length(encrypted_public_key) +
        length(encrypted_private_key)
      ), 0)
      FROM devices
      WHERE user_id = users.id
        AND revoked_at IS NULL
        AND encrypted_user_key IS NOT NULL
        AND encrypted_public_key IS NOT NULL
        AND encrypted_private_key IS NOT NULL) as trustedDeviceBytes
  FROM users
  WHERE users.id = ?
  LIMIT 1
`

export const snapshotFoldersSql = `
  SELECT
    id,
    user_id as userId,
    encrypted_name as name,
    revision_date as revisionDate
  FROM folders
  WHERE user_id = ? AND deleted_at IS NULL
  ORDER BY id ASC
`

export const snapshotCiphersSql = `
  SELECT
    id,
    user_id as userId,
    folder_id as folderId,
    type,
    favorite,
    encrypted_json as encryptedJson,
    revision_date as revisionDate
  FROM ciphers
  WHERE user_id = ?
    AND organization_id IS NULL
    AND deleted_at IS NULL
  ORDER BY id ASC
`

export const snapshotAttachmentsSql = `
  SELECT
    attachment.id,
    attachment.user_id as userId,
    attachment.cipher_id as cipherId,
    attachment.object_key as objectKey,
    attachment.file_name as fileName,
    attachment.attachment_key as attachmentKey,
    attachment.size,
    attachment.content_type as contentType,
    attachment.revision_date as revisionDate
  FROM cipher_attachments attachment
  INNER JOIN ciphers cipher
    ON cipher.id = attachment.cipher_id
    AND cipher.user_id = attachment.user_id
  WHERE attachment.user_id = ?
    AND cipher.organization_id IS NULL
    AND cipher.deleted_at IS NULL
    AND attachment.content_type IS NOT NULL
  ORDER BY attachment.id ASC
`

export const snapshotTrustedDevicesSql = `
  SELECT
    id,
    user_id as userId,
    encrypted_user_key as encryptedUserKey,
    encrypted_public_key as encryptedPublicKey,
    encrypted_private_key as encryptedPrivateKey
  FROM devices
  WHERE user_id = ?
    AND revoked_at IS NULL
    AND encrypted_user_key IS NOT NULL
    AND encrypted_public_key IS NOT NULL
    AND encrypted_private_key IS NOT NULL
  ORDER BY id ASC
`

export const updateUserGenerationSql = `
  WITH
    expected_folders AS (
      SELECT
        json_extract(value, '$.id') as id,
        json_extract(value, '$.name') as name,
        json_extract(value, '$.revisionDate') as revision_date
      FROM json_each(?)
    ),
    expected_ciphers AS (
      SELECT
        json_extract(value, '$.id') as id,
        json_extract(value, '$.folderId') as folder_id,
        json_extract(value, '$.type') as type,
        json_extract(value, '$.favorite') as favorite,
        json_extract(value, '$.encryptedJson') as encrypted_json,
        json_extract(value, '$.revisionDate') as revision_date
      FROM json_each(?)
    ),
    expected_attachments AS (
      SELECT
        json_extract(value, '$.id') as id,
        json_extract(value, '$.cipherId') as cipher_id,
        json_extract(value, '$.objectKey') as object_key,
        json_extract(value, '$.fileName') as file_name,
        json_extract(value, '$.attachmentKey') as attachment_key,
        json_extract(value, '$.size') as size,
        json_extract(value, '$.contentType') as content_type,
        json_extract(value, '$.revisionDate') as revision_date
      FROM json_each(?)
    ),
    expected_devices AS (
      SELECT
        json_extract(value, '$.id') as id,
        json_extract(value, '$.encryptedUserKey') as encrypted_user_key,
        json_extract(value, '$.encryptedPublicKey') as encrypted_public_key,
        json_extract(value, '$.encryptedPrivateKey') as encrypted_private_key
      FROM json_each(?)
    )
  UPDATE users
  SET
    master_password_hash = ?,
    user_key = ?,
    private_key = ?,
    security_stamp = ?,
    revision_date = ?,
    updated_at = ?
  WHERE users.id = ?
    AND users.disabled_at IS NULL
    AND users.master_password_hash = ?
    AND users.email_normalized = ?
    AND users.kdf_algorithm = ?
    AND users.kdf_iterations = ?
    AND users.kdf_memory IS ?
    AND users.kdf_parallelism IS ?
    AND users.user_key = ?
    AND users.public_key = ?
    AND users.private_key = ?
    AND users.security_stamp = ?
    AND users.revision_date = ?
    AND (SELECT COUNT(*) FROM folders WHERE user_id = users.id) =
      (SELECT COUNT(*) FROM expected_folders)
    AND NOT EXISTS (
      SELECT 1
      FROM folders row
      LEFT JOIN expected_folders expected ON expected.id = row.id
      WHERE row.user_id = users.id
        AND (
          row.deleted_at IS NOT NULL OR
          expected.id IS NULL OR
          expected.name IS NOT row.encrypted_name OR
          expected.revision_date IS NOT row.revision_date
        )
    )
    AND (SELECT COUNT(*) FROM ciphers
      WHERE user_id = users.id AND organization_id IS NULL) =
      (SELECT COUNT(*) FROM expected_ciphers)
    AND NOT EXISTS (
      SELECT 1
      FROM ciphers row
      LEFT JOIN expected_ciphers expected ON expected.id = row.id
      WHERE row.user_id = users.id
        AND row.organization_id IS NULL
        AND (
          row.deleted_at IS NOT NULL OR
          row.cipher_key IS NOT NULL OR
          expected.id IS NULL OR
          expected.folder_id IS NOT row.folder_id OR
          expected.type IS NOT row.type OR
          expected.favorite IS NOT row.favorite OR
          expected.encrypted_json IS NOT row.encrypted_json OR
          expected.revision_date IS NOT row.revision_date
        )
    )
    AND (SELECT COUNT(*)
      FROM cipher_attachments attachment
      INNER JOIN ciphers cipher
        ON cipher.id = attachment.cipher_id
        AND cipher.user_id = attachment.user_id
      WHERE attachment.user_id = users.id
        AND cipher.organization_id IS NULL) =
      (SELECT COUNT(*) FROM expected_attachments)
    AND NOT EXISTS (
      SELECT 1
      FROM cipher_attachments row
      INNER JOIN ciphers cipher
        ON cipher.id = row.cipher_id
        AND cipher.user_id = row.user_id
      LEFT JOIN expected_attachments expected ON expected.id = row.id
      WHERE row.user_id = users.id
        AND cipher.organization_id IS NULL
        AND (
          row.content_type IS NULL OR
          expected.id IS NULL OR
          expected.cipher_id IS NOT row.cipher_id OR
          expected.object_key IS NOT row.object_key OR
          expected.file_name IS NOT row.file_name OR
          expected.attachment_key IS NOT row.attachment_key OR
          expected.size IS NOT row.size OR
          expected.content_type IS NOT row.content_type OR
          expected.revision_date IS NOT row.revision_date
        )
    )
    AND (SELECT COUNT(*) FROM devices
      WHERE user_id = users.id
        AND revoked_at IS NULL
        AND encrypted_user_key IS NOT NULL
        AND encrypted_public_key IS NOT NULL
        AND encrypted_private_key IS NOT NULL) =
      (SELECT COUNT(*) FROM expected_devices)
    AND NOT EXISTS (
      SELECT 1
      FROM devices row
      LEFT JOIN expected_devices expected ON expected.id = row.id
      WHERE row.user_id = users.id
        AND row.revoked_at IS NULL
        AND (
          (
            row.encrypted_user_key IS NOT NULL OR
            row.encrypted_public_key IS NOT NULL OR
            row.encrypted_private_key IS NOT NULL
          )
          AND (
            expected.id IS NULL OR
            expected.encrypted_user_key IS NOT row.encrypted_user_key OR
            expected.encrypted_public_key IS NOT row.encrypted_public_key OR
            expected.encrypted_private_key IS NOT row.encrypted_private_key
          )
        )
    )
  RETURNING id
`

export const updateFoldersSql = `
  WITH rotated AS (
    SELECT
      json_extract(value, '$.id') as id,
      json_extract(value, '$.name') as name
    FROM json_each(?)
  )
  UPDATE folders
  SET
    encrypted_name = (SELECT name FROM rotated WHERE rotated.id = folders.id),
    revision_date = ?,
    updated_at = ?
  WHERE user_id = ?
    AND deleted_at IS NULL
    AND id IN (SELECT id FROM rotated)
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = ? AND security_stamp = ? AND revision_date = ?
    )
`

export const updateCiphersSql = `
  WITH rotated AS (
    SELECT
      json_extract(value, '$.id') as id,
      json_extract(value, '$.encryptedJson') as encrypted_json
    FROM json_each(?)
  )
  UPDATE ciphers
  SET
    encrypted_json = (
      SELECT encrypted_json FROM rotated WHERE rotated.id = ciphers.id
    ),
    revision_date = ?,
    updated_at = ?
  WHERE user_id = ?
    AND organization_id IS NULL
    AND deleted_at IS NULL
    AND id IN (SELECT id FROM rotated)
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = ? AND security_stamp = ? AND revision_date = ?
    )
`

export const updateAttachmentsSql = `
  WITH rotated AS (
    SELECT
      json_extract(value, '$.id') as id,
      json_extract(value, '$.fileName') as file_name,
      json_extract(value, '$.attachmentKey') as attachment_key
    FROM json_each(?)
  )
  UPDATE cipher_attachments
  SET
    file_name = (SELECT file_name FROM rotated WHERE rotated.id = cipher_attachments.id),
    attachment_key = (
      SELECT attachment_key FROM rotated WHERE rotated.id = cipher_attachments.id
    ),
    revision_date = ?,
    updated_at = ?
  WHERE user_id = ?
    AND content_type IS NOT NULL
    AND id IN (SELECT id FROM rotated)
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = ? AND security_stamp = ? AND revision_date = ?
    )
`

export const updateTrustedDevicesSql = `
  WITH rotated AS (
    SELECT
      json_extract(value, '$.id') as id,
      json_extract(value, '$.encryptedPublicKey') as encrypted_public_key,
      json_extract(value, '$.encryptedUserKey') as encrypted_user_key
    FROM json_each(?)
  )
  UPDATE devices
  SET
    encrypted_public_key = (
      SELECT encrypted_public_key FROM rotated WHERE rotated.id = devices.id
    ),
    encrypted_user_key = (
      SELECT encrypted_user_key FROM rotated WHERE rotated.id = devices.id
    ),
    updated_at = ?
  WHERE user_id = ?
    AND revoked_at IS NULL
    AND encrypted_user_key IS NOT NULL
    AND encrypted_public_key IS NOT NULL
    AND encrypted_private_key IS NOT NULL
    AND id IN (SELECT id FROM rotated)
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = ? AND security_stamp = ? AND revision_date = ?
    )
`

export const revokeDevicesSql = `
  UPDATE devices
  SET revoked_at = ?, updated_at = ?
  WHERE user_id = ?
    AND revoked_at IS NULL
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = ? AND security_stamp = ? AND revision_date = ?
    )
`

export const revokeRefreshTokensSql = `
  UPDATE refresh_tokens
  SET revoked_at = ?
  WHERE user_id = ?
    AND revoked_at IS NULL
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = ? AND security_stamp = ? AND revision_date = ?
    )
`

export const invalidateAuthRequestsSql = `
  UPDATE auth_requests
  SET
    status = 'superseded',
    request_approved = 0,
    encrypted_response_key = NULL,
    updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = ? AND security_stamp = ? AND revision_date = ?
    )
`

export const insertAuditEventSql = `
  INSERT INTO audit_events (
    id,
    schema_version,
    name,
    outcome,
    request_id,
    occurred_at,
    actor_user_id,
    actor_device_identifier,
    target_type,
    target_id,
    context_json
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  FROM users
  WHERE id = ?
    AND disabled_at IS NULL
    AND security_stamp = ?
    AND revision_date = ?
`
