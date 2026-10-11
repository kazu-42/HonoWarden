import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const deployBoundaryDocs = [
  'docs/operations/deploy-provenance-runbook.md',
  'docs/operations/operator-environment.md',
  'docs/operations/operator-quickstart.md',
  'docs/release/fresh-deploy-guide.md',
  'docs/release/rollback-guide.md',
  'docs/release/upgrade-guide.md',
] as const

const currentAuthorityDocs = [
  ...deployBoundaryDocs,
  'README.md',
  'docs/dogfood-runbook.md',
  'docs/security/incident-response.md',
  'docs/security/secrets-inventory.md',
  'docs/operations/access-token-key-rotation.md',
  'docs/operations/audit-events.md',
  'docs/operations/cloudflare-access-control.md',
  'docs/operations/totp-secret-rotation.md',
] as const

const historicalWorkerEvidenceDocs = [
  'docs/release/worker-live-smoke-evidence.md',
  'docs/release/staging-deploy-evidence.md',
  'docs/release/ops-rollback-evidence.md',
  'docs/release/retention-cron-evidence.md',
] as const

const stopMarker = 'REAL WORKER/VERSION/TRAFFIC WRITE STOP'
const historicalAuthorityBanner =
  'HISTORICAL EVIDENCE — NOT CURRENT EXECUTION AUTHORITY.'

const forbiddenCurrentCommandPatterns = [
  /\bwrangler\s+(?:d1\s+create|r2\s+bucket\s+create)\b/u,
  /\bpnpm(?:\s+run)?\s+deploy\b/u,
  /scripts\/honowarden-deploy(?:\.mjs)?\b/u,
  /\b(?:(?:pnpm(?:\s+exec)?|npx)\s+)?wrangler\s+deploy\b/u,
  /\b(?:(?:pnpm(?:\s+exec)?|npx)\s+)?wrangler\s+versions\s+(?:upload|deploy)\b/u,
  /\b(?:(?:pnpm(?:\s+exec)?|npx)\s+)?wrangler\s+rollback\b/u,
  /\b(?:(?:pnpm(?:\s+exec)?|npx)\s+)?wrangler\s+secret\s+(?:put|bulk|delete)\b/u,
  /\b(?:(?:pnpm(?:\s+exec)?|npx)\s+)?wrangler\s+versions\s+secret\s+(?:put|delete)\b/u,
  /\b(?:(?:pnpm(?:\s+exec)?|npx)\s+)?wrangler\s+dev\b[^\n]*--remote\b/u,
  /\b(?:(?:pnpm(?:\s+exec)?|npx)\s+)?wrangler\s+d1\s+migrations\s+apply\b(?=[^\n]*(?:--remote\b|--env\b))/u,
  /\bpnpm(?:\s+run)?\s+cloudflare:tokens\b(?=[^\n]*\bapply\b)(?=[^\n]*--execute\b)/u,
  /\bpnpm(?:\s+run)?\s+totp:rotate-secret\b(?=[^\n]*--mode\s+remote\b)(?=[^\n]*--execute\b)/u,
] as const

const exactInquiryRepositoryCommands = [
  'env -u CLOUDFLARE_API_TOKEN npx wrangler deploy --env staging # honowarden-inquiry-inbox-staging',
  `printf '%s' "$SECRET_VALUE" | env -u CLOUDFLARE_API_TOKEN npx wrangler secret put NAME --env staging # HonoWarden-inquiry-inbox only`,
] as const

const exactHistoricalCommandRecords = new Map<string, readonly string[]>([
  [
    'docs/release/cloudflare-resource-evidence.md',
    [
      'pnpm wrangler d1 create honowarden-staging --location apac',
      'pnpm wrangler d1 create honowarden --location apac',
      'pnpm wrangler r2 bucket create honowarden-staging-vault-objects --location apac',
      'pnpm wrangler r2 bucket create honowarden-vault-objects --location apac',
      "printf 'y\\n' | pnpm wrangler d1 migrations apply honowarden-staging --env staging --remote",
      "printf 'y\\n' | pnpm exec wrangler d1 migrations apply DB --env production --remote",
    ],
  ],
  [
    'docs/release/website-live-evidence.md',
    [
      '- Deployment command: `pnpm deploy`',
      'pnpm exec wrangler rollback eef4ab71-d6e8-401f-93c3-27e7bd2bcd91 --name honowarden-website --yes',
    ],
  ],
  [
    'docs/operations/cloudflare-access-control.md',
    [
      '- `pnpm cloudflare:tokens -- apply --auth global --execute --expires-on 2026-10-07T23:59:59Z`',
    ],
  ],
])

describe('build provenance operator runbooks', () => {
  it('rejects unclassified mutation recipes across all operator documentation', () => {
    const violations = ['README.md', ...markdownPaths('docs')].flatMap((path) =>
      logicalLines(readFileSync(path, 'utf8'))
        .filter(({ text }) => isUnclassifiedMutationRecipe(path, text))
        .map(({ line, text }) => `${path}:${line}: ${text}`),
    )

    expect(violations).toEqual([])
  })

  it('defaults new documents to no mutation authority', () => {
    expect(
      isUnclassifiedMutationRecipe(
        'docs/operations/new-runbook.md',
        'pnpm exec wrangler deploy --env production',
      ),
    ).toBe(true)
    expect(
      isUnclassifiedMutationRecipe(
        'docs/operations/new-runbook.md',
        'pnpm exec wrangler deploy --dry-run',
      ),
    ).toBe(true)
    expect(
      isUnclassifiedMutationRecipe(
        'docs/operations/new-runbook.md',
        'pnpm exec wrangler d1 create new-production-db',
      ),
    ).toBe(true)
  })

  it.each([
    'docs/release/cloudflare-resource-evidence.md',
    'docs/release/website-live-evidence.md',
    'docs/release/auth-request-staging-evidence.md',
    'docs/release/durable-notification-staging-evidence.md',
  ])('labels earlier staging evidence as historical in %s', (path) => {
    expect(
      readFileSync(path, 'utf8').split('\n').slice(0, 8).join('\n'),
    ).toContain(historicalAuthorityBanner)
  })

  it.each(deployBoundaryDocs)(
    'keeps current HonoWarden deploy authority stopped in %s',
    (path) => {
      expect(readFileSync(path, 'utf8')).toContain(stopMarker)
    },
  )

  it.each(currentAuthorityDocs)(
    'contains no current HonoWarden Worker mutation recipe in %s',
    (path) => {
      const violations = logicalLines(readFileSync(path, 'utf8'))
        .filter(({ text }) =>
          forbiddenCurrentCommandPatterns.some((pattern) => pattern.test(text)),
        )
        .filter(({ text }) => !isExactAllowedCommandRecord(path, text))
        .map(({ line, text }) => `${path}:${line}: ${text}`)

      expect(violations).toEqual([])
    },
  )

  it.each(historicalWorkerEvidenceDocs)(
    'marks historical Worker evidence as non-authoritative in %s',
    (path) => {
      const evidence = readFileSync(path, 'utf8')

      expect(evidence).toContain(historicalAuthorityBanner)
      expect(evidence).toMatch(/^Historical status:\s*passed\.?\s*$/m)
    },
  )

  it.each(historicalWorkerEvidenceDocs)(
    'keeps live Worker mutation recipes out of historical evidence in %s',
    (path) => {
      const violations = logicalLines(readFileSync(path, 'utf8'))
        .filter(({ text }) =>
          forbiddenCurrentCommandPatterns.some((pattern) => pattern.test(text)),
        )
        .filter(({ text }) => !containsOnlyHistoricalDeployDryRuns(text))
        .map(({ line, text }) => `${path}:${line}: ${text}`)

      expect(violations).toEqual([])
    },
  )

  it('keeps fresh bootstrap remote writes behind the static stop', () => {
    const guide = readFileSync('docs/release/fresh-deploy-guide.md', 'utf8')

    for (const forbidden of [
      /wrangler whoami/u,
      /wrangler d1 create/u,
      /wrangler r2 bucket create/u,
      /wrangler secret put/u,
      /wrangler d1 migrations apply[^\n]*--env/u,
      /wrangler d1 execute[^\n]*--env/u,
    ]) {
      expect(guide).not.toMatch(forbidden)
    }
    expect(guide).toContain('partial-success classification')
    expect(guide).toContain('separate staging and production decisions')
  })

  it('preserves the runtime provenance and post-deployment acceptance ceiling', () => {
    const combined = deployBoundaryDocs
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    for (const value of [
      '/health',
      '/healthz',
      '/health/db',
      '/api/config',
      'build.gitSha',
      'workerVersionId',
      'createdAt',
      'environment',
      'synthetic login',
      'source',
      'traffic',
      'non-versioned',
      'partial-success',
      'recovery',
    ]) {
      expect(combined).toContain(value)
    }
  })

  it('states that credentials and approval do not bypass the execution boundary', () => {
    const runbook = readFileSync(
      'docs/operations/deploy-provenance-runbook.md',
      'utf8',
    )

    expect(runbook).toMatch(/Credential\s+availability[^.]*cannot turn/u)
    expect(runbook).toContain('Direct Wrangler use is not an approved bypass.')
    expect(runbook).toContain('Historical deployment evidence')
    expect(runbook).toContain('trusted executable and closed credential')
    expect(runbook).toContain('independent recovery proof')
  })

  it('preserves immutable dry-run evidence and the exact separate inquiry-repo commands', () => {
    const rollbackEvidence = readFileSync(
      'docs/release/ops-rollback-evidence.md',
      'utf8',
    )
    const quickstart = readFileSync(
      'docs/operations/operator-quickstart.md',
      'utf8',
    )

    expect(rollbackEvidence).toContain(
      'pnpm exec wrangler deploy --env staging --dry-run',
    )
    expect(rollbackEvidence).toContain(
      'pnpm exec wrangler deploy --env production --dry-run',
    )
    const inquiryCommandRecords = logicalLines(quickstart)
      .map(({ text }) => text)
      .filter((text) =>
        exactInquiryRepositoryCommands.includes(
          text as (typeof exactInquiryRepositoryCommands)[number],
        ),
      )

    expect(inquiryCommandRecords).toEqual(exactInquiryRepositoryCommands)
  })

  it('allows the old token writer command only as one exact historical record', () => {
    const path = 'docs/operations/cloudflare-access-control.md'
    const accessControl = readFileSync(path, 'utf8')
    const expectedRecords = exactHistoricalCommandRecords.get(path) ?? []
    const actualRecords = logicalLines(accessControl)
      .map(({ text }) => text)
      .filter((text) => expectedRecords.includes(text))

    expect(accessControl).toContain(
      'This section is immutable historical evidence from the 2026-07-09 remediation.',
    )
    expect(actualRecords).toEqual(expectedRecords)
  })

  it('joins shell continuations before checking remote writer commands', () => {
    const wrappedRemoteWriter = logicalLines(
      [
        'pnpm totp:rotate-secret -- \\',
        '  --mode remote \\',
        '  --execute',
      ].join('\n'),
    )

    expect(
      wrappedRemoteWriter.some(({ text }) =>
        forbiddenCurrentCommandPatterns.some((pattern) => pattern.test(text)),
      ),
    ).toBe(true)
    expect(
      containsOnlyHistoricalDeployDryRuns(
        '`wrangler deploy --env staging --dry-run && wrangler deploy --env production`',
      ),
    ).toBe(false)
    expect(
      isUnclassifiedMutationRecipe(
        'docs/release/ops-rollback-evidence.md',
        '`wrangler deploy --dry-run` then `wrangler secret put NAME`',
      ),
    ).toBe(true)
  })
})

function logicalLines(source: string): { line: number; text: string }[] {
  const result: { line: number; text: string }[] = []
  let continued = ''
  let continuedAt = 0

  for (const [index, rawLine] of source.split('\n').entries()) {
    const line = index + 1
    const text = normalizeWhitespace(rawLine)
    if (text.length === 0) {
      continue
    }

    result.push({ line, text })

    if (text.endsWith('\\')) {
      if (continued.length === 0) {
        continuedAt = line
      }
      continued = `${continued} ${text.slice(0, -1)}`.trim()
      continue
    }

    if (continued.length > 0) {
      result.push({
        line: continuedAt,
        text: normalizeWhitespace(`${continued} ${text}`),
      })
      continued = ''
      continuedAt = 0
    }
  }

  if (continued.length > 0) {
    result.push({ line: continuedAt, text: normalizeWhitespace(continued) })
  }

  return result
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

function markdownPaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return markdownPaths(path)
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  })
}

function isUnclassifiedMutationRecipe(path: string, text: string): boolean {
  if (!forbiddenCurrentCommandPatterns.some((pattern) => pattern.test(text))) {
    return false
  }
  if (isExactAllowedCommandRecord(path, text)) return false
  const historicalDryRunDocs: readonly string[] = [
    ...historicalWorkerEvidenceDocs,
    'docs/current-state.md',
    'docs/release/account-lifecycle-local-evidence.md',
  ]
  return !(
    historicalDryRunDocs.includes(path) &&
    containsOnlyHistoricalDeployDryRuns(text)
  )
}

function isExactAllowedCommandRecord(path: string, text: string): boolean {
  if (
    path === 'docs/operations/operator-quickstart.md' &&
    exactInquiryRepositoryCommands.includes(
      text as (typeof exactInquiryRepositoryCommands)[number],
    )
  ) {
    return true
  }

  return (exactHistoricalCommandRecords.get(path) ?? []).includes(text)
}

function containsOnlyHistoricalDeployDryRuns(text: string): boolean {
  const deployPattern = /\bwrangler\s+deploy\b(?<arguments>[^`|]*)(?:`|\||$)/gu
  const deployCommands = [...text.matchAll(deployPattern)]

  return (
    deployCommands.length > 0 &&
    deployCommands.every(({ groups }) => {
      const commandArguments = groups?.arguments ?? ''
      return (
        commandArguments.includes('--dry-run') &&
        !/[;&]|\|\|/u.test(commandArguments)
      )
    }) &&
    !forbiddenCurrentCommandPatterns.some((pattern) =>
      pattern.test(text.replace(deployPattern, '')),
    )
  )
}
