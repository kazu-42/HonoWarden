PRAGMA foreign_keys = ON;

CREATE TABLE account_kdf_population (
  kdf_algorithm TEXT NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  kdf_memory INTEGER NOT NULL,
  kdf_memory_is_null INTEGER NOT NULL CHECK (kdf_memory_is_null IN (0, 1)),
  kdf_parallelism INTEGER NOT NULL,
  kdf_parallelism_is_null INTEGER NOT NULL CHECK (kdf_parallelism_is_null IN (0, 1)),
  account_count INTEGER NOT NULL CHECK (account_count > 0),
  PRIMARY KEY (
    kdf_algorithm,
    kdf_iterations,
    kdf_memory,
    kdf_memory_is_null,
    kdf_parallelism,
    kdf_parallelism_is_null
  ),
  CHECK (kdf_memory_is_null = 0 OR kdf_memory = 0),
  CHECK (kdf_parallelism_is_null = 0 OR kdf_parallelism = 0)
) WITHOUT ROWID;

INSERT INTO account_kdf_population (
  kdf_algorithm,
  kdf_iterations,
  kdf_memory,
  kdf_memory_is_null,
  kdf_parallelism,
  kdf_parallelism_is_null,
  account_count
)
SELECT
  kdf_algorithm,
  kdf_iterations,
  COALESCE(kdf_memory, 0),
  kdf_memory IS NULL,
  COALESCE(kdf_parallelism, 0),
  kdf_parallelism IS NULL,
  COUNT(*)
FROM users
GROUP BY
  kdf_algorithm,
  kdf_iterations,
  kdf_memory,
  kdf_parallelism;

CREATE TRIGGER trg_users_kdf_population_insert
AFTER INSERT ON users
BEGIN
  INSERT INTO account_kdf_population (
    kdf_algorithm,
    kdf_iterations,
    kdf_memory,
    kdf_memory_is_null,
    kdf_parallelism,
    kdf_parallelism_is_null,
    account_count
  ) VALUES (
    NEW.kdf_algorithm,
    NEW.kdf_iterations,
    COALESCE(NEW.kdf_memory, 0),
    NEW.kdf_memory IS NULL,
    COALESCE(NEW.kdf_parallelism, 0),
    NEW.kdf_parallelism IS NULL,
    1
  )
  ON CONFLICT (
    kdf_algorithm,
    kdf_iterations,
    kdf_memory,
    kdf_memory_is_null,
    kdf_parallelism,
    kdf_parallelism_is_null
  ) DO UPDATE SET account_count = account_count + 1;
END;

CREATE TRIGGER trg_users_kdf_population_delete
AFTER DELETE ON users
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM account_kdf_population
    WHERE kdf_algorithm = OLD.kdf_algorithm
      AND kdf_iterations = OLD.kdf_iterations
      AND kdf_memory = COALESCE(OLD.kdf_memory, 0)
      AND kdf_memory_is_null = (OLD.kdf_memory IS NULL)
      AND kdf_parallelism = COALESCE(OLD.kdf_parallelism, 0)
      AND kdf_parallelism_is_null = (OLD.kdf_parallelism IS NULL)
  ) THEN RAISE(ABORT, 'missing old KDF population during user delete') END;

  DELETE FROM account_kdf_population
  WHERE kdf_algorithm = OLD.kdf_algorithm
    AND kdf_iterations = OLD.kdf_iterations
    AND kdf_memory = COALESCE(OLD.kdf_memory, 0)
    AND kdf_memory_is_null = (OLD.kdf_memory IS NULL)
    AND kdf_parallelism = COALESCE(OLD.kdf_parallelism, 0)
    AND kdf_parallelism_is_null = (OLD.kdf_parallelism IS NULL)
    AND account_count = 1;

  UPDATE account_kdf_population
  SET account_count = account_count - 1
  WHERE kdf_algorithm = OLD.kdf_algorithm
    AND kdf_iterations = OLD.kdf_iterations
    AND kdf_memory = COALESCE(OLD.kdf_memory, 0)
    AND kdf_memory_is_null = (OLD.kdf_memory IS NULL)
    AND kdf_parallelism = COALESCE(OLD.kdf_parallelism, 0)
    AND kdf_parallelism_is_null = (OLD.kdf_parallelism IS NULL)
    AND account_count > 1;
END;

CREATE TRIGGER trg_users_kdf_population_update
AFTER UPDATE OF kdf_algorithm, kdf_iterations, kdf_memory, kdf_parallelism ON users
WHEN OLD.kdf_algorithm IS NOT NEW.kdf_algorithm
  OR OLD.kdf_iterations IS NOT NEW.kdf_iterations
  OR OLD.kdf_memory IS NOT NEW.kdf_memory
  OR OLD.kdf_parallelism IS NOT NEW.kdf_parallelism
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM account_kdf_population
    WHERE kdf_algorithm = OLD.kdf_algorithm
      AND kdf_iterations = OLD.kdf_iterations
      AND kdf_memory = COALESCE(OLD.kdf_memory, 0)
      AND kdf_memory_is_null = (OLD.kdf_memory IS NULL)
      AND kdf_parallelism = COALESCE(OLD.kdf_parallelism, 0)
      AND kdf_parallelism_is_null = (OLD.kdf_parallelism IS NULL)
  ) THEN RAISE(ABORT, 'missing old KDF population during user update') END;

  DELETE FROM account_kdf_population
  WHERE kdf_algorithm = OLD.kdf_algorithm
    AND kdf_iterations = OLD.kdf_iterations
    AND kdf_memory = COALESCE(OLD.kdf_memory, 0)
    AND kdf_memory_is_null = (OLD.kdf_memory IS NULL)
    AND kdf_parallelism = COALESCE(OLD.kdf_parallelism, 0)
    AND kdf_parallelism_is_null = (OLD.kdf_parallelism IS NULL)
    AND account_count = 1;

  UPDATE account_kdf_population
  SET account_count = account_count - 1
  WHERE kdf_algorithm = OLD.kdf_algorithm
    AND kdf_iterations = OLD.kdf_iterations
    AND kdf_memory = COALESCE(OLD.kdf_memory, 0)
    AND kdf_memory_is_null = (OLD.kdf_memory IS NULL)
    AND kdf_parallelism = COALESCE(OLD.kdf_parallelism, 0)
    AND kdf_parallelism_is_null = (OLD.kdf_parallelism IS NULL)
    AND account_count > 1;

  INSERT INTO account_kdf_population (
    kdf_algorithm,
    kdf_iterations,
    kdf_memory,
    kdf_memory_is_null,
    kdf_parallelism,
    kdf_parallelism_is_null,
    account_count
  ) VALUES (
    NEW.kdf_algorithm,
    NEW.kdf_iterations,
    COALESCE(NEW.kdf_memory, 0),
    NEW.kdf_memory IS NULL,
    COALESCE(NEW.kdf_parallelism, 0),
    NEW.kdf_parallelism IS NULL,
    1
  )
  ON CONFLICT (
    kdf_algorithm,
    kdf_iterations,
    kdf_memory,
    kdf_memory_is_null,
    kdf_parallelism,
    kdf_parallelism_is_null
  ) DO UPDATE SET account_count = account_count + 1;
END;

INSERT INTO schema_migrations (version)
VALUES ('0014a')
ON CONFLICT(version) DO NOTHING;
