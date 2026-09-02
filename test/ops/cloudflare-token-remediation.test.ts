import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const scriptPath = join(
  repoRoot,
  'scripts/honowarden-cloudflare-token-remediation.mjs',
)
const nonDeployTokenEnvVars = [
  'CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN',
  'CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN',
  'CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN',
  'CLOUDFLARE_HONOWARDEN_READONLY_TOKEN',
] as const

describe('Cloudflare scoped token remediation', () => {
  it('plans scoped tokens without printing configured secret values', () => {
    const secretValues = {
      CLOUDFLARE_GLOBAL_API_KEY: 'secret_global_key_should_not_print',
      CLOUDFLARE_API_EMAIL: 'operator@example.test',
    }
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        'plan',
        '--secrets-out',
        '~/.config/honowarden/cloudflare-scoped.env',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...secretValues,
          CLOUDFLARE_API_TOKEN: '',
          CLOUDFLARE_ACCOUNT_ID: 'account_id_for_test',
          CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone_id_for_test',
        },
      },
    )
    const report = JSON.parse(output)

    expect(report).toMatchObject({
      action: 'cloudflare_token_remediation_plan',
      status: 'ready',
      executeRequiredForMutation: true,
      secretsOut: '~/.config/honowarden/cloudflare-scoped.env',
    })
    expect(report.tokenClasses).toHaveLength(5)
    expect(output).toContain('CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN')
    expect(output).toContain('CLOUDFLARE_HONOWARDEN_READONLY_TOKEN')
    expect(output).not.toContain(secretValues.CLOUDFLARE_GLOBAL_API_KEY)
    expect(output).not.toContain(secretValues.CLOUDFLARE_API_EMAIL)
    expect(report.safetyBoundaries).toEqual(
      expect.arrayContaining([
        expect.stringContaining('non-deploy token classes only'),
        expect.stringMatching(/^STOP: automated deploy-token/),
      ]),
    )
    expect(
      report.tokenClasses.find(
        (tokenClass: { id: string }) => tokenClass.id === 'deploy',
      ),
    ).toMatchObject({ mutationPolicy: 'stopped' })
    expect(
      report.tokenClasses
        .filter((tokenClass: { id: string }) => tokenClass.id !== 'deploy')
        .every(
          (tokenClass: { mutationPolicy: string }) =>
            tokenClass.mutationPolicy === 'execute_required',
        ),
    ).toBe(true)
  })

  it('stops deploy-token mutation before POST while creating non-deploy tokens', () => {
    const fixture = createCloudflareApiFixture()

    try {
      const execution = runApplyExecute(fixture)
      const report = JSON.parse(execution.stdout)
      const deployResult = report.tokenResults.find(
        (result: { id: string }) => result.id === 'deploy',
      )

      expect(execution.status).toBe(1)
      expect(execution.stderr).toBe('')
      expect(report).toMatchObject({
        action: 'cloudflare_token_remediation_apply',
        executed: true,
        status: 'not_ready',
      })
      expect(deployResult).toMatchObject({
        id: 'deploy',
        action: 'stopped',
        status: 'not_ready',
        detail: expect.stringContaining('STOP'),
      })
      expect(
        report.tokenResults
          .filter((result: { id: string }) => result.id !== 'deploy')
          .map((result: { action: string; id: string }) => ({
            id: result.id,
            action: result.action,
          })),
      ).toEqual([
        { id: 'dns_routes', action: 'created' },
        { id: 'email_routing', action: 'created' },
        { id: 'd1_r2', action: 'created' },
        { id: 'readonly', action: 'created' },
      ])

      const requests = readRequestLog(fixture.requestLog)
      const tokenPosts = requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.path === '/accounts/account_id_for_test/tokens',
      )

      expect(tokenPosts).toHaveLength(4)
      expect(tokenPosts.map((request) => request.body?.name)).not.toContain(
        deployResult.name,
      )
      expect(requests.filter((request) => request.method !== 'GET')).toEqual(
        tokenPosts,
      )
      expect(
        JSON.stringify(tokenPosts.map((request) => request.body)),
      ).not.toContain('Workers Scripts Write')

      const secretFile = readFileSync(fixture.secretFile, 'utf8')
      expect(secretFile).not.toContain('CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN')
      for (const envVar of nonDeployTokenEnvVars) {
        expect(secretFile).toContain(`export ${envVar}=`)
      }
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('stops replacement of an existing deploy token and secret', () => {
    const fixture = createCloudflareApiFixture({ existingDeployToken: true })
    const existingDeploySecret =
      "export CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN='existing-deploy-secret'"
    writeFileSync(fixture.secretFile, `${existingDeploySecret}\n`, 'utf8')

    try {
      const execution = runApplyExecute(fixture)
      const report = JSON.parse(execution.stdout)
      const deployResult = report.tokenResults.find(
        (result: { id: string }) => result.id === 'deploy',
      )
      const requests = readRequestLog(fixture.requestLog)
      const tokenPosts = requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.path === '/accounts/account_id_for_test/tokens',
      )

      expect(execution.status).toBe(1)
      expect(execution.stderr).toBe('')
      expect(deployResult).toMatchObject({
        id: 'deploy',
        action: 'stopped',
        status: 'not_ready',
        existingTokenDetected: true,
        detail: expect.stringContaining('STOP'),
      })
      expect(tokenPosts).toHaveLength(4)
      expect(tokenPosts.map((request) => request.body?.name)).not.toContain(
        deployResult.name,
      )

      const secretFile = readFileSync(fixture.secretFile, 'utf8')
      expect(secretFile).toContain(existingDeploySecret)
      expect(
        secretFile.match(/CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN/g),
      ).toHaveLength(1)
      for (const envVar of nonDeployTokenEnvVars) {
        expect(secretFile).toContain(`export ${envVar}=`)
      }
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('retains read-only verification for every token class', () => {
    const fixture = createCloudflareApiFixture()

    try {
      const output = execFileSync(
        process.execPath,
        [
          '--import',
          fixture.preloadPath,
          scriptPath,
          'verify',
          '--secrets-out',
          fixture.secretFile,
        ],
        {
          encoding: 'utf8',
          env: cloudflareTestEnv({
            HONOWARDEN_TEST_FETCH_LOG: fixture.requestLog,
            CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN: 'deploy_verify_token',
            CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN: 'dns_routes_verify_token',
            CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN:
              'email_routing_verify_token',
            CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN: 'd1_r2_verify_token',
            CLOUDFLARE_HONOWARDEN_READONLY_TOKEN: 'readonly_verify_token',
          }),
        },
      )
      const report = JSON.parse(output)
      const requests = readRequestLog(fixture.requestLog)

      expect(report).toMatchObject({
        action: 'cloudflare_token_remediation_verify',
        status: 'ready',
      })
      expect(report.tokenResults).toHaveLength(5)
      expect(requests.every((request) => request.method === 'GET')).toBe(true)
      expect(existsSync(fixture.secretFile)).toBe(false)
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('documents the scoped-token workflow and non-automated 2FA boundary', () => {
    const accessReview = readRepoFile(
      'docs/operations/cloudflare-access-control.md',
    )
    const operatorDocs = readRepoFile('docs/operations/operator-environment.md')
    const envExample = readRepoFile('.env.example')
    const packageJson = JSON.parse(readRepoFile('package.json'))

    expect(packageJson.scripts['cloudflare:tokens']).toBe(
      'node scripts/honowarden-cloudflare-token-remediation.mjs',
    )
    for (const envVar of [
      'CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN',
      'CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN',
      'CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN',
      'CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN',
      'CLOUDFLARE_HONOWARDEN_READONLY_TOKEN',
    ]) {
      expect(envExample).toMatch(new RegExp(`^${envVar}=$`, 'm'))
      expect(accessReview).toContain(envVar)
    }

    expect(accessReview).toContain('Scoped Token Remediation Workflow')
    expect(accessReview).toContain(
      'Account-level 2FA enforcement is intentionally not automated',
    )
    expect(operatorDocs).toContain('~/.config/honowarden/cloudflare-scoped.env')
    expect(operatorDocs).toContain('pnpm cloudflare:tokens -- verify')
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

type CloudflareRequest = {
  method: string
  path: string
  body: Record<string, unknown> | null
}

function createCloudflareApiFixture(
  options: { existingDeployToken?: boolean } = {},
): {
  directory: string
  preloadPath: string
  requestLog: string
  secretFile: string
} {
  const directory = mkdtempSync(
    join(tmpdir(), 'honowarden-cloudflare-token-test-'),
  )
  const preloadPath = join(directory, 'mock-cloudflare-fetch.mjs')
  const requestLog = join(directory, 'requests.jsonl')
  const secretFile = join(directory, 'cloudflare-scoped.env')
  const permissionNames = [
    'Zone Read',
    'Workers Routes Write',
    'DNS Write',
    'Email Routing Addresses Read',
    'Email Routing Addresses Write',
    'DNS Read',
    'Email Routing Rules Write',
    'D1 Metadata Read',
    'D1 Read',
    'D1 Write',
    'Workers R2 Storage Metadata Read',
    'Workers R2 Storage Read',
    'Workers R2 Storage Write',
    'Account API Tokens Read',
    'Account Settings Read',
    'Workers Observability Read',
    'Workers Scripts Read',
    'Email Routing Rules Read',
    'Workers Routes Read',
  ]

  writeFileSync(
    preloadPath,
    `import { appendFileSync } from 'node:fs'

const requestLog = process.env.HONOWARDEN_TEST_FETCH_LOG
const permissionNames = ${JSON.stringify(permissionNames)}
const existingDeployToken = ${JSON.stringify(
      options.existingDeployToken ?? false,
    )}
let createdTokenCount = 0

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input))
  if (url.origin !== 'https://api.cloudflare.com') {
    throw new Error(\`Unexpected network target: \${url.origin}\`)
  }

  const method = options.method ?? 'GET'
  const path = \`\${url.pathname}\${url.search}\`.replace(
    '/client/v4',
    '',
  )
  const body = options.body ? JSON.parse(options.body) : null
  appendFileSync(requestLog, \`\${JSON.stringify({ method, path, body })}\\n\`)

  let result = []
  if (path === '/user/tokens/permission_groups') {
    result = permissionNames.map((name, index) => ({
      id: \`permission-\${index}\`,
      name,
    }))
  } else if (
    path === '/accounts/account_id_for_test/tokens' &&
    method === 'GET'
  ) {
    result = existingDeployToken
      ? [
          {
            id: 'existing-deploy-token-id',
            name: 'HonoWarden deploy worker scoped token',
            status: 'active',
            expires_on: '2026-12-01T00:00:00Z',
          },
        ]
      : []
  } else if (
    path === '/accounts/account_id_for_test/tokens' &&
    method === 'POST'
  ) {
    createdTokenCount += 1
    result = {
      id: \`created-token-\${createdTokenCount}\`,
      name: body.name,
      value: \`one-time-secret-\${createdTokenCount}\`,
      status: 'active',
      expires_on: body.expires_on,
    }
  }

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, result }),
  }
}
`,
    'utf8',
  )

  return { directory, preloadPath, requestLog, secretFile }
}

function cloudflareTestEnv(
  overrides: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: 'account_id_for_test',
    CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone_id_for_test',
    CLOUDFLARE_API_TOKEN: 'bootstrap_api_token_for_test',
    CLOUDFLARE_GLOBAL_API_KEY: '',
    CLOUDFLARE_API_KEY: '',
    CLOUDFLARE_API_EMAIL: '',
    CLOUDFLARE_EMAIL: '',
    ...overrides,
  }
}

function runApplyExecute(fixture: {
  preloadPath: string
  requestLog: string
  secretFile: string
}): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  return spawnSync(
    process.execPath,
    [
      '--import',
      fixture.preloadPath,
      scriptPath,
      'apply',
      '--execute',
      '--auth',
      'token',
      '--secrets-out',
      fixture.secretFile,
    ],
    {
      encoding: 'utf8',
      env: cloudflareTestEnv({
        HONOWARDEN_TEST_FETCH_LOG: fixture.requestLog,
      }),
    },
  ) as ReturnType<typeof spawnSync> & { stderr: string; stdout: string }
}

function readRequestLog(path: string): CloudflareRequest[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CloudflareRequest)
}
