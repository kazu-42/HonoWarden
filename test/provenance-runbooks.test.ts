import { readFileSync } from 'node:fs'

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
    'docs/operations/cloudflare-access-control.md',
    [
      '- `pnpm cloudflare:tokens -- apply --auth global --execute --expires-on 2026-10-07T23:59:59Z`',
    ],
  ],
])

describe('build provenance operator runbooks', () => {
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
  const deployCommands = [
    ...text.matchAll(/\bwrangler\s+deploy\b(?<arguments>[^`|]*)(?:`|\||$)/gu),
  ]

  return (
    deployCommands.length > 0 &&
    deployCommands.every(({ groups }) => {
      const commandArguments = groups?.arguments ?? ''
      return (
        commandArguments.includes('--dry-run') &&
        !/[;&]|\|\|/u.test(commandArguments)
      )
    })
  )
}
