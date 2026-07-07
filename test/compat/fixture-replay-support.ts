import { readFileSync } from 'node:fs'

import app from '../../src/app'
import { signAccessToken } from '../../src/domain/tokens'
import { FakeD1Database, requiredTables } from '../support/fake-d1'

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type JsonType = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string'

type FixtureAssertion = {
  path: string
  type?: JsonType
  value?: JsonValue
  absent?: boolean
  length?: number
  minLength?: number
  notValue?: JsonValue
}

export type CompatFixture = {
  name: string
  endpoint: {
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
    path: string
  }
  request: {
    headers?: Record<string, string>
    body?: JsonValue
    form?: Record<string, string>
  }
  response: {
    status: number
    body: JsonValue
  }
  assertions: FixtureAssertion[]
}

type CompatAuthUserRecord = {
  id: string
  email: string
  emailNormalized: string
  displayName: string
  kdfAlgorithm: 'pbkdf2-sha256'
  kdfIterations: number
  kdfMemory: number | null
  kdfParallelism: number | null
  masterPasswordHash: string
  userKey: string
  publicKey: string
  privateKey: string
  securityStamp: string
  revisionDate: string
  createdAt: string
  disabledAt: string | null
  loginFailedCount: number
  loginFailedAt: string | null
  loginLockedUntil: string | null
  totpEnabled: boolean
  totpEncryptedSecret: string | null
  totpLastAcceptedStep: string | null
}

type CompatFixtureDatabaseSeed = {
  schemaVersion?: string | null
  tables?: readonly string[]
  authUser?: CompatAuthUserRecord
  authUsers?: readonly CompatAuthUserRecord[]
  ciphers?: Record<string, JsonValue>[]
  cipherInsertChanges?: number
  cipherPermanentDeleteChanges?: number
  cipherRestoreChanges?: number
  cipherSoftDeleteChanges?: number
  cipherUpdateChanges?: number
  folders?: Record<string, JsonValue>[]
  folderDeleteChanges?: number
  folderUpdateChanges?: number
  devices?: Record<string, JsonValue>[]
  deviceRevokeChanges?: number
  refreshSession?: Record<string, JsonValue> | null
  refreshRotationChanges?: number
  totpChallenge?: Record<string, JsonValue> | null
  totpChallengeUpdateChanges?: number
  userTotp?: Record<string, JsonValue> | null
}

type FixtureReplayOptions = {
  database?: CompatFixtureDatabaseSeed
  requestHeaders?: Record<string, string>
  validateResponse?: boolean
  allowMutatingFixtures?: boolean
  tokenSecret?: string
  tokenIssuedAt?: number
  tokenExpiresAt?: number
  tokenDeviceIdentifier?: string
  allowedEmails?: string
  totpSecret?: string
}

type BuiltRequest = {
  path: string
  options: {
    method: CompatFixture['endpoint']['method']
    headers: Record<string, string>
    body?: string
  }
}

type FixtureReplayResult = {
  fixture: CompatFixture
  request: BuiltRequest
  response: Response
  responseBody: JsonValue | null
  database: FakeD1Database
  accessToken: string
  tokenSecret: string
}

const syntheticAccessToken = 'synthetic-access-token'
const defaultAuthUser: CompatAuthUserRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'Person@Example.Test',
  emailNormalized: 'person@example.test',
  displayName: 'Fixture User',
  kdfAlgorithm: 'pbkdf2-sha256',
  kdfIterations: 600000,
  kdfMemory: null,
  kdfParallelism: null,
  masterPasswordHash: 'synthetic-master-password-hash',
  userKey: '2.c3ludGhldGljLXVzZXIta2V5',
  publicKey: 'synthetic-public-key',
  privateKey: '2.synthetic-private-key',
  securityStamp: 'fixture-security-stamp',
  revisionDate: '2026-07-06T00:00:00.000Z',
  createdAt: '2026-07-06T00:00:00.000Z',
  disabledAt: null,
  loginFailedCount: 0,
  loginFailedAt: null,
  loginLockedUntil: null,
  totpEnabled: false,
  totpEncryptedSecret: null,
  totpLastAcceptedStep: null,
}

export function loadCompatFixture(path: string): CompatFixture {
  return JSON.parse(readFileSync(path, 'utf8')) as CompatFixture
}

export function isStatelessCompatFixture(fixture: CompatFixture): boolean {
  if (fixture.endpoint.method === 'GET') {
    return true
  }

  return (
    fixture.endpoint.method === 'POST' &&
    (fixture.endpoint.path === '/identity/accounts/prelogin' ||
      fixture.endpoint.path === '/identity/accounts/prelogin/password')
  )
}

export async function runCompatFixture(
  input: string | CompatFixture,
  options: FixtureReplayOptions = {},
): Promise<FixtureReplayResult> {
  const fixture = typeof input === 'string' ? loadCompatFixture(input) : input

  if (!options.allowMutatingFixtures && !isStatelessCompatFixture(fixture)) {
    throw new Error(
      `Refusing to run mutating fixture "${fixture.name}" in stateless mode.`,
    )
  }

  const tokenSecret = options.tokenSecret ?? 'fixture-token-secret'
  const requestHeaders = mergeHeaders(
    fixture.request.headers,
    options.requestHeaders,
  )
  const databaseSeed = buildDatabaseSeed(options.database)
  const subjectUser = databaseSeed.authUsers[0] ?? defaultAuthUser
  const accessToken = await signAccessToken(tokenSecret, {
    sub: subjectUser.id,
    email: subjectUser.emailNormalized,
    device: options.tokenDeviceIdentifier ?? 'fixture-device',
    securityStamp: subjectUser.securityStamp,
    iat: options.tokenIssuedAt ?? 1,
    exp: options.tokenExpiresAt ?? 4_102_444_800,
    authMethod: 'password',
  })

  if (requestHeaders.authorization === `Bearer ${syntheticAccessToken}`) {
    requestHeaders.authorization = `Bearer ${accessToken}`
  }

  const request = buildRequest(fixture, requestHeaders)
  const database = new FakeD1Database(
    databaseSeed.schemaVersion ?? null,
    [...(databaseSeed.tables ?? requiredTables)],
    databaseSeed,
  )
  const requestInit: {
    method: CompatFixture['endpoint']['method']
    headers: Record<string, string>
    body?: string
  } = {
    method: request.options.method,
    headers: request.options.headers,
  }

  if (request.options.body !== undefined) {
    requestInit.body = request.options.body
  }

  const response = await app.request(request.path, requestInit, {
    DB: database,
    HONOWARDEN_TOKEN_SECRET: tokenSecret,
    HONOWARDEN_TOTP_SECRET: options.totpSecret ?? tokenSecret,
    HONOWARDEN_ALLOWED_EMAILS: options.allowedEmails ?? 'person@example.test',
  })

  const responseBody = await parseResponseBody(response)
  const replayResult: FixtureReplayResult = {
    fixture,
    request,
    response,
    responseBody,
    database,
    accessToken,
    tokenSecret,
  }

  if (options.validateResponse !== false) {
    assertFixtureResponse(fixture, response, responseBody)
  }

  return replayResult
}

export function assertFixtureResponse(
  fixture: CompatFixture,
  response: Response,
  responseBody: JsonValue | null,
): void {
  if (response.status !== fixture.response.status) {
    throw new Error(
      `Fixture "${fixture.name}" expected status ${fixture.response.status} but got ${response.status}`,
    )
  }

  for (const assertion of fixture.assertions ?? []) {
    const actual = readJsonPath(responseBody, assertion.path)

    if (assertion.absent === true) {
      if (actual.exists) {
        throw new Error(
          `Fixture "${fixture.name}" assertion ${assertion.path} expected to be absent`,
        )
      }

      continue
    }

    if (!actual.exists) {
      throw new Error(
        `Fixture "${fixture.name}" assertion ${assertion.path} was expected`,
      )
    }

    const actualValue = actual.value

    if (
      assertion.type !== undefined &&
      !hasJsonType(actualValue, assertion.type)
    ) {
      throw new Error(
        `Fixture "${fixture.name}" assertion ${assertion.path} has wrong type`,
      )
    }

    if (assertion.length !== undefined) {
      if (!Array.isArray(actualValue)) {
        throw new Error(
          `Fixture "${fixture.name}" assertion ${assertion.path} should be an array`,
        )
      }

      if (actualValue.length !== assertion.length) {
        throw new Error(
          `Fixture "${fixture.name}" assertion ${assertion.path} expected array length ${assertion.length} but got ${actualValue.length}`,
        )
      }
    }

    if (assertion.minLength !== undefined) {
      if (!Array.isArray(actualValue)) {
        throw new Error(
          `Fixture "${fixture.name}" assertion ${assertion.path} should be an array`,
        )
      }

      if (actualValue.length < assertion.minLength) {
        throw new Error(
          `Fixture "${fixture.name}" assertion ${assertion.path} expected min length ${assertion.minLength} but got ${actualValue.length}`,
        )
      }
    }

    if (
      Object.hasOwn(assertion, 'value') &&
      !deepEqual(actualValue, assertion.value)
    ) {
      throw new Error(
        `Fixture "${fixture.name}" assertion ${assertion.path} expected ${String(
          assertion.value,
        )} but got ${String(actualValue)}`,
      )
    }

    if (
      Object.hasOwn(assertion, 'notValue') &&
      deepEqual(actualValue, assertion.notValue)
    ) {
      throw new Error(
        `Fixture "${fixture.name}" assertion ${assertion.path} expected different value`,
      )
    }
  }
}

function buildDatabaseSeed(
  seed: CompatFixtureDatabaseSeed = {},
): Required<CompatFixtureDatabaseSeed> & {
  authUsers: CompatAuthUserRecord[]
} {
  const authUsers =
    seed.authUsers && seed.authUsers.length > 0
      ? [...seed.authUsers]
      : [seed.authUser ?? defaultAuthUser]

  return {
    schemaVersion: seed.schemaVersion ?? '0001',
    tables: seed.tables ?? requiredTables,
    authUsers,
    authUser: seed.authUser ?? authUsers[0] ?? defaultAuthUser,
    ciphers: seed.ciphers ?? [],
    cipherInsertChanges: seed.cipherInsertChanges ?? 1,
    cipherPermanentDeleteChanges: seed.cipherPermanentDeleteChanges ?? 1,
    cipherRestoreChanges: seed.cipherRestoreChanges ?? 1,
    cipherSoftDeleteChanges: seed.cipherSoftDeleteChanges ?? 1,
    cipherUpdateChanges: seed.cipherUpdateChanges ?? 1,
    folders: seed.folders ?? [],
    folderDeleteChanges: seed.folderDeleteChanges ?? 1,
    folderUpdateChanges: seed.folderUpdateChanges ?? 1,
    devices: seed.devices ?? [],
    deviceRevokeChanges: seed.deviceRevokeChanges ?? 1,
    refreshSession: seed.refreshSession ?? null,
    refreshRotationChanges: seed.refreshRotationChanges ?? 1,
    totpChallenge: seed.totpChallenge ?? null,
    totpChallengeUpdateChanges: seed.totpChallengeUpdateChanges ?? 1,
    userTotp: seed.userTotp ?? null,
  }
}

function buildRequest(
  fixture: CompatFixture,
  headers: Record<string, string>,
): BuiltRequest {
  const method = fixture.endpoint.method

  const path = fixture.endpoint.path
  const request: {
    method: CompatFixture['endpoint']['method']
    headers: Record<string, string>
    body?: string
  } = { method, headers: { ...headers } }

  if (
    fixture.request.body !== undefined &&
    fixture.request.form !== undefined
  ) {
    throw new Error(
      `Fixture "${fixture.name}" has both request body and form payload; only one may be used`,
    )
  }

  if (fixture.request.body !== undefined) {
    request.body = JSON.stringify(fixture.request.body)
    request.headers['content-type'] ??= 'application/json'
  }

  if (fixture.request.form !== undefined) {
    request.body = new URLSearchParams(fixture.request.form).toString()
    request.headers['content-type'] ??= 'application/x-www-form-urlencoded'
  }

  return { path, options: request }
}

async function parseResponseBody(
  response: Response,
): Promise<JsonValue | null> {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return null
  }
}

function hasJsonType(value: JsonValue, type: JsonType): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value)
    case 'null':
      return value === null
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      )
    default:
      return typeof value === type
  }
}

function readJsonPath(
  value: JsonValue | null,
  path: string,
): { exists: true; value: JsonValue } | { exists: false } {
  if (!path.match(/^\$(\.[A-Za-z0-9_]+|\[\d+\])*$/)) {
    throw new Error(`Invalid JSON fixture path: ${path}`)
  }

  if (value === null) {
    return { exists: false }
  }

  if (path === '$') {
    return { exists: true, value }
  }

  const parts = path
    .slice(1)
    .match(/(?:\.([A-Za-z0-9_]+)|\[(\d+)\])/g)
    ?.map((part) => (part.startsWith('.') ? part.slice(1) : part.slice(1, -1)))

  if (!parts || parts.length === 0) {
    return { exists: false }
  }

  let current: JsonValue = value

  for (const part of parts) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) {
        return { exists: false }
      }

      const index = Number(part)
      if (index >= current.length) {
        return { exists: false }
      }

      current = current[index] as JsonValue
      continue
    }

    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current)
    ) {
      return { exists: false }
    }

    const record = current as Record<string, JsonValue>
    if (!Object.hasOwn(record, part)) {
      return { exists: false }
    }

    const nextValue = record[part]
    if (nextValue === undefined) {
      return { exists: false }
    }

    current = nextValue
  }

  return { exists: true, value: current }
}

function deepEqual(
  a: JsonValue | undefined,
  b: JsonValue | undefined,
): boolean {
  if (a === b) {
    return true
  }

  if (a === null || b === null || typeof a !== typeof b) {
    return false
  }

  if (typeof a !== 'object') {
    return false
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) {
      return false
    }

    if (a.length !== b.length) {
      return false
    }

    return a.every((item, index) => deepEqual(item, b[index]))
  }

  if (Array.isArray(b)) {
    return false
  }

  const aRecord = a as Record<string, JsonValue>
  const bRecord = b as Record<string, JsonValue>
  const keys = Object.keys(aRecord)
  if (keys.length !== Object.keys(bRecord).length) {
    return false
  }

  return keys.every(
    (key) =>
      Object.hasOwn(bRecord, key) && deepEqual(aRecord[key], bRecord[key]),
  )
}

function mergeHeaders(
  ...parts: Array<Record<string, string> | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {}

  for (const part of parts) {
    if (!part) {
      continue
    }

    for (const [key, value] of Object.entries(part)) {
      merged[key.toLowerCase()] = value
    }
  }

  return merged
}
