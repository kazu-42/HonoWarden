export type DomainSettings = {
  equivalentDomains: string[][]
  excludedGlobalEquivalentDomains: number[]
}

export type DomainSettingsUpdateInput = DomainSettings & {
  userId: string
  revisionDate: string
}

export type DomainSettingsUpdateResult =
  | {
      status: 'updated'
      settings: DomainSettings
      revisionDate: string
    }
  | {
      status: 'not_found'
    }

type DomainSettingsDatabase = Pick<D1Database, 'prepare'>

type DomainSettingsRow = {
  equivalentDomainsJson?: string | null
  excludedGlobalEquivalentDomainsJson?: string | null
}

export async function getDomainSettingsForUser(
  database: DomainSettingsDatabase,
  userId: string,
): Promise<DomainSettings> {
  const row = await database
    .prepare(
      `
        SELECT
          equivalent_domains as equivalentDomainsJson,
          excluded_global_equivalent_domains as excludedGlobalEquivalentDomainsJson
        FROM users
        WHERE id = ? AND disabled_at IS NULL
        LIMIT 1
      `,
    )
    .bind(userId)
    .first<DomainSettingsRow>()

  return {
    equivalentDomains: parseEquivalentDomainsJson(row?.equivalentDomainsJson),
    excludedGlobalEquivalentDomains: parseExcludedGlobalDomainsJson(
      row?.excludedGlobalEquivalentDomainsJson,
    ),
  }
}

export async function updateDomainSettingsForUser(
  database: DomainSettingsDatabase,
  input: DomainSettingsUpdateInput,
): Promise<DomainSettingsUpdateResult> {
  const result = await database
    .prepare(
      `
        UPDATE users
        SET
          equivalent_domains = ?,
          excluded_global_equivalent_domains = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND disabled_at IS NULL
      `,
    )
    .bind(
      JSON.stringify(input.equivalentDomains),
      JSON.stringify(input.excludedGlobalEquivalentDomains),
      input.revisionDate,
      input.revisionDate,
      input.userId,
    )
    .run()

  if (result.meta.changes !== 1) {
    return {
      status: 'not_found',
    }
  }

  return {
    status: 'updated',
    settings: {
      equivalentDomains: input.equivalentDomains,
      excludedGlobalEquivalentDomains: input.excludedGlobalEquivalentDomains,
    },
    revisionDate: input.revisionDate,
  }
}

function parseEquivalentDomainsJson(
  value: string | null | undefined,
): string[][] {
  const parsed = parseJsonArrayOrDefault(value)
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid equivalent domains JSON.')
  }

  return parsed.map((group) => {
    if (
      !Array.isArray(group) ||
      group.some((domain) => typeof domain !== 'string')
    ) {
      throw new Error('Invalid equivalent domains JSON.')
    }

    return group
  })
}

function parseExcludedGlobalDomainsJson(
  value: string | null | undefined,
): number[] {
  const parsed = parseJsonArrayOrDefault(value)
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid excluded global equivalent domains JSON.')
  }

  const excludedGlobalDomains: number[] = []

  for (const item of parsed) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) {
      throw new Error('Invalid excluded global equivalent domains JSON.')
    }

    excludedGlobalDomains.push(item)
  }

  return excludedGlobalDomains
}

function parseJsonArrayOrDefault(value: string | null | undefined): unknown[] {
  if (!value) {
    return []
  }

  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Domain settings JSON must be an array.')
  }

  return parsed
}
