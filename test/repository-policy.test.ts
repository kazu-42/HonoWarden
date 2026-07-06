import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const externalBrand = ['bit', 'warden'].join('')

const ignoredPaths = new Set([
  'LICENSE',
  'pnpm-lock.yaml',
  'worker-configuration.d.ts',
])

describe('repository policy', () => {
  it('does not keep the upstream provider brand in tracked source text', () => {
    const trackedFiles = execFileSync(
      'git',
      ['ls-files', '--cached', '--modified', '--others', '--exclude-standard'],
      {
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter(
        (path) =>
          path.length > 0 && existsSync(path) && !ignoredPaths.has(path),
      )

    const offenders = trackedFiles.filter((path) =>
      readFileSync(path, 'utf8').toLowerCase().includes(externalBrand),
    )

    expect(offenders).toEqual([])
  })
})
