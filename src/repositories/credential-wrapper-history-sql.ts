export const insertCredentialWrapperHistorySql = `
  WITH wrappers AS (
    SELECT
      json_extract(value, '$.kind') as wrapper_kind,
      json_extract(value, '$.sha256') as wrapper_sha256
    FROM json_each(?)
  )
  INSERT OR IGNORE INTO user_key_rotation_wrapper_history (
    user_id,
    wrapper_kind,
    wrapper_sha256,
    recorded_at
  )
  SELECT ?, wrapper_kind, wrapper_sha256, ?
  FROM wrappers
  WHERE EXISTS (
    SELECT 1 FROM users
    WHERE id = ? AND security_stamp = ? AND revision_date = ?
  )
  RETURNING
    wrapper_kind as wrapperKind,
    wrapper_sha256 as wrapperSha256
`

export const insertInitializedAccountWrapperHistorySql = `
  WITH wrappers AS (
    SELECT
      json_extract(value, '$.kind') as wrapper_kind,
      json_extract(value, '$.sha256') as wrapper_sha256
    FROM json_each(?)
  )
  INSERT OR IGNORE INTO user_key_rotation_wrapper_history (
    user_id,
    wrapper_kind,
    wrapper_sha256,
    recorded_at
  )
  SELECT ?, wrapper_kind, wrapper_sha256, ?
  FROM wrappers
  WHERE EXISTS (
    SELECT 1 FROM users
    WHERE id = ?
      AND user_key = ?
      AND public_key = ?
      AND private_key = ?
      AND security_stamp = ?
      AND revision_date = ?
  )
  RETURNING
    wrapper_kind as wrapperKind,
    wrapper_sha256 as wrapperSha256
`
