import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const databaseName = 'honowarden'

type D1Execution = {
  results?: Array<Record<string, unknown>>
}

describe('KDF population migration', () => {
  it('backfills existing users and maintains exact counts with fail-loud triggers', async () => {
    const persistTo = await mkdtemp(
      join(tmpdir(), 'honowarden-kdf-population-'),
    )

    try {
      await executeD1(persistTo, [
        '--file',
        'migrations/0001_initial_schema.sql',
        '--yes',
        '--json',
      ])
      await executeD1(persistTo, [
        '--command',
        seedUsersSql(),
        '--yes',
        '--json',
      ])
      await executeD1(persistTo, [
        '--file',
        'migrations/0014a_kdf_population.sql',
        '--yes',
        '--json',
      ])

      const backfill = await executeD1(persistTo, [
        '--command',
        populationSelectSql(),
        '--yes',
        '--json',
      ])
      expect(backfill[0]?.results).toEqual([
        {
          kdf_algorithm: 'pbkdf2-sha256',
          kdf_iterations: 600000,
          kdf_memory: null,
          kdf_parallelism: null,
          account_count: 2,
        },
      ])

      const maintained = await executeD1(persistTo, [
        '--command',
        maintainPopulationSql(),
        '--yes',
        '--json',
      ])
      expect(maintained.at(-1)?.results).toEqual([
        {
          kdf_algorithm: 'argon2id',
          kdf_iterations: 6,
          kdf_memory: 32,
          kdf_parallelism: 4,
          account_count: 1,
        },
      ])

      await executeD1(persistTo, [
        '--command',
        'DELETE FROM account_kdf_population;',
        '--yes',
        '--json',
      ])
      await expect(
        executeD1(persistTo, [
          '--command',
          "UPDATE users SET kdf_iterations = 7 WHERE id = 'existing-one';",
          '--yes',
          '--json',
        ]),
      ).rejects.toThrow(/missing old KDF population during user update/)

      const userReadback = await executeD1(persistTo, [
        '--command',
        "SELECT kdf_iterations FROM users WHERE id = 'existing-one';",
        '--yes',
        '--json',
      ])
      expect(userReadback[0]?.results).toEqual([{ kdf_iterations: 6 }])
    } finally {
      await rm(persistTo, { recursive: true, force: true })
    }
  }, 60_000)
})

async function executeD1(
  persistTo: string,
  operation: string[],
): Promise<D1Execution[]> {
  try {
    const result = await execFileAsync(
      'pnpm',
      [
        'exec',
        'wrangler',
        'd1',
        'execute',
        databaseName,
        '--local',
        '--persist-to',
        persistTo,
        ...operation,
      ],
      {
        cwd: repoRoot,
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    )

    return JSON.parse(result.stdout) as D1Execution[]
  } catch (error) {
    const commandError = error as { stdout?: unknown; stderr?: unknown }
    const output = [commandError.stdout, commandError.stderr]
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      )
      .map((value) => value.trim())
      .join('\n')
    throw new Error(output || String(error), { cause: error })
  }
}

function seedUsersSql(): string {
  return `
    INSERT INTO users (
      id,
      email,
      email_normalized,
      kdf_algorithm,
      kdf_iterations,
      master_password_hash,
      security_stamp,
      revision_date
    ) VALUES
      (
        'existing-one',
        'existing-one@example.test',
        'existing-one@example.test',
        'pbkdf2-sha256',
        600000,
        'synthetic-hash-one',
        'synthetic-stamp-one',
        '2026-07-19T00:00:00.000Z'
      ),
      (
        'existing-two',
        'existing-two@example.test',
        'existing-two@example.test',
        'pbkdf2-sha256',
        600000,
        'synthetic-hash-two',
        'synthetic-stamp-two',
        '2026-07-19T00:00:00.000Z'
      );
  `
}

function maintainPopulationSql(): string {
  return `
    INSERT INTO users (
      id,
      email,
      email_normalized,
      kdf_algorithm,
      kdf_iterations,
      kdf_memory,
      kdf_parallelism,
      master_password_hash,
      security_stamp,
      revision_date
    ) VALUES (
      'inserted-three',
      'inserted-three@example.test',
      'inserted-three@example.test',
      'argon2id',
      6,
      32,
      4,
      'synthetic-hash-three',
      'synthetic-stamp-three',
      '2026-07-19T00:00:00.000Z'
    );
    UPDATE users
    SET
      kdf_algorithm = 'argon2id',
      kdf_iterations = 6,
      kdf_memory = 32,
      kdf_parallelism = 4
    WHERE id = 'existing-one';
    DELETE FROM users WHERE id = 'existing-two';
    DELETE FROM users WHERE id = 'inserted-three';
    ${populationSelectSql()}
  `
}

function populationSelectSql(): string {
  return `
    SELECT
      kdf_algorithm,
      kdf_iterations,
      CASE WHEN kdf_memory_is_null = 1 THEN NULL ELSE kdf_memory END AS kdf_memory,
      CASE WHEN kdf_parallelism_is_null = 1 THEN NULL ELSE kdf_parallelism END AS kdf_parallelism,
      account_count
    FROM account_kdf_population
    ORDER BY
      kdf_algorithm,
      kdf_iterations,
      kdf_memory,
      kdf_parallelism;
  `
}
