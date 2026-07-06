import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type JsonValue =
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
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(16)
  })

  for (const fixtureFile of fixtureFiles) {
    const label = relative(fixturesRoot, fixtureFile)

    it(`validates ${label}`, () => {
      const fixture = readFixture(fixtureFile)

      expect(fixture.name).toMatch(/^[a-z0-9-]+$/)
      expect(fixture.endpoint.path).toMatch(/^\/[A-Za-z0-9/_:%.-]+$/)
      expect(fixture.response.status).toBeGreaterThanOrEqual(100)
      expect(fixture.response.status).toBeLessThan(600)
      expect(fixture.assertions.length).toBeGreaterThan(0)

      for (const assertion of fixture.assertions) {
        const actual = readJsonPath(fixture.response.body, assertion.path)
        if (assertion.absent === true) {
          expect(actual.exists, `${fixture.name} ${assertion.path}`).toBe(false)
          continue
        }

        expect(actual.exists, `${fixture.name} ${assertion.path}`).toBe(true)
        if (!actual.exists) {
          throw new Error(`${fixture.name} ${assertion.path} is missing`)
        }

        const actualValue = actual.value
        if (assertion.type) {
          expect(
            hasJsonType(actualValue, assertion.type),
            `${fixture.name} ${assertion.path} should be ${assertion.type}`,
          ).toBe(true)
        }

        if ('length' in assertion) {
          expect(
            Array.isArray(actualValue),
            `${fixture.name} ${assertion.path} should have a length`,
          ).toBe(true)
          expect(actualValue).toHaveLength(assertion.length as number)
        }

        if ('minLength' in assertion) {
          expect(
            Array.isArray(actualValue),
            `${fixture.name} ${assertion.path} should have a length`,
          ).toBe(true)
          expect((actualValue as JsonValue[]).length).toBeGreaterThanOrEqual(
            assertion.minLength as number,
          )
        }

        if ('value' in assertion) {
          expect(actualValue).toEqual(assertion.value)
        }

        if ('notValue' in assertion) {
          expect(actualValue).not.toEqual(assertion.notValue)
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

function readJsonPath(
  value: JsonValue,
  path: string,
): { exists: true; value: JsonValue } | { exists: false } {
  expect(path).toMatch(/^\$(\.[A-Za-z0-9_]+|\[\d+\])+$/)

  const parts = path
    .slice(1)
    .match(/(?:\.([A-Za-z0-9_]+)|\[(\d+)\])/g)
    ?.map((part) => (part.startsWith('.') ? part.slice(1) : part.slice(1, -1)))
  expect(parts, `${path} should contain at least one path part`).toBeDefined()
  let current: JsonValue = value

  for (const part of parts ?? []) {
    if (Array.isArray(current)) {
      expect(part).toMatch(/^\d+$/)

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

    const objectValue = current as Record<string, JsonValue>
    if (!Object.hasOwn(objectValue, part)) {
      return { exists: false }
    }
    current = objectValue[part] as JsonValue
  }

  return { exists: true, value: current }
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
