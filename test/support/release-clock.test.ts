import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { releaseClockEnv } from './release-clock'

const execFileAsync = promisify(execFile)
const matrix = JSON.parse(
  readFileSync(
    new URL('../../compat/client-matrix.json', import.meta.url),
    'utf8',
  ),
)

describe('release child-process clock', () => {
  it.each(['fresh', 'stale'] as const)(
    'reproduces %s time across nested CLIs without changing explicit dates',
    async (state) => {
      const observedAt =
        Date.parse(matrix.checkedAt) +
        (state === 'stale'
          ? (matrix.metadataRefresh.staleAfterDays + 1) * 86_400_000
          : 0)
      const env = releaseClockEnv(state, {
        ...process.env,
        NODE_OPTIONS: '--no-warnings',
        HONOWARDEN_TEST_CLOCK_SENTINEL: 'preserved',
      })
      const result = await execFileAsync(
        process.execPath,
        [
          '-e',
          `const {execFileSync} = require('node:child_process');
console.log(JSON.stringify({
  now: Date.now(), constructed: new Date().getTime(),
  explicit: new Date('2000-01-01T00:00:00Z').toISOString(),
  parsed: Date.parse('2000-01-01T00:00:00Z'),
  nested: Number(execFileSync(process.execPath, ['-e', 'console.log(Date.now())'])),
  sentinel: process.env.HONOWARDEN_TEST_CLOCK_SENTINEL
}));`,
        ],
        { env },
      )
      expect(JSON.parse(result.stdout)).toEqual({
        now: observedAt,
        constructed: observedAt,
        explicit: '2000-01-01T00:00:00.000Z',
        parsed: 946684800000,
        nested: observedAt,
        sentinel: 'preserved',
      })
      expect(env.NODE_OPTIONS).toMatch(/^--no-warnings --import=/)
      expect(new Date('2000-01-01T00:00:00Z').getTime()).toBe(946684800000)
    },
  )
})
