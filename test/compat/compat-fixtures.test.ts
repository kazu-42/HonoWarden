import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type JsonType = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string'

type FixtureAssertion = {
  path: string
  type: JsonType
  value?: JsonValue
}

type CompatFixture = {
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

const fixturesRoot = fileURLToPath(
  new URL('../../compat/fixtures', import.meta.url).toString(),
)

describe('compatibility fixtures', () => {
  const fixtureFiles = findJsonFiles(fixturesRoot)

  it('discovers fixture files', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(3)
  })

  for (const fixtureFile of fixtureFiles) {
    const label = relative(fixturesRoot, fixtureFile)

    it(`validates ${label}`, () => {
      const fixture = readFixture(fixtureFile)

      expect(fixture.name).toMatch(/^[a-z0-9-]+$/)
      expect(fixture.endpoint.path).toMatch(/^\/[A-Za-z0-9/_-]+$/)
      expect(fixture.response.status).toBeGreaterThanOrEqual(100)
      expect(fixture.response.status).toBeLessThan(600)
      expect(fixture.assertions.length).toBeGreaterThan(0)

      for (const assertion of fixture.assertions) {
        const actual = getJsonPath(fixture.response.body, assertion.path)
        expect(
          hasJsonType(actual, assertion.type),
          `${fixture.name} ${assertion.path} should be ${assertion.type}`,
        ).toBe(true)

        if ('value' in assertion) {
          expect(actual).toEqual(assertion.value)
        }
      }
    })
  }
})

function findJsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(directory, entry.name)

      if (entry.isDirectory()) {
        return findJsonFiles(entryPath)
      }

      return entry.isFile() && entry.name.endsWith('.json') ? [entryPath] : []
    })
    .sort()
}

function readFixture(path: string): CompatFixture {
  return JSON.parse(readFileSync(path, 'utf8')) as CompatFixture
}

function getJsonPath(value: JsonValue, path: string): JsonValue {
  expect(path).toMatch(/^\$(\.[A-Za-z0-9_]+)+$/)

  const parts = path.slice(2).split('.')
  let current: JsonValue = value

  for (const part of parts) {
    expect(
      current !== null &&
        typeof current === 'object' &&
        !Array.isArray(current),
      `${path} cannot read ${part} from non-object value`,
    ).toBe(true)

    const objectValue = current as Record<string, JsonValue>
    expect(Object.hasOwn(objectValue, part), `${path} missing ${part}`).toBe(
      true,
    )
    current = objectValue[part] as JsonValue
  }

  return current
}

function hasJsonType(value: JsonValue, type: JsonType): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value)
    case 'null':
      return value === null
    case 'object':
      return (
        value !== null && typeof value === 'object' && !Array.isArray(value)
      )
    default:
      return typeof value === type
  }
}
