import { execFile, type ExecFileOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { promisify } from 'node:util'

const matrix = JSON.parse(
  readFileSync(
    new URL('../../compat/client-matrix.json', import.meta.url),
    'utf8',
  ),
) as { checkedAt: string; metadataRefresh: { staleAfterDays: number } }
const execFileAsync = promisify(execFile)

// Freeze only child-process clocks. Nested packet CLIs inherit the same clock;
// neither production scripts nor the checked-in matrix gain a clock override.
export function releaseClockEnv(
  state: 'fresh' | 'stale',
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const observedAt =
    Date.parse(matrix.checkedAt) +
    (state === 'stale'
      ? (matrix.metadataRefresh.staleAfterDays + 1) * 86_400_000
      : 0)
  const preload = `
const NativeDate = Date;
const observedAt = ${observedAt};
globalThis.Date = new Proxy(NativeDate, {
  construct(target, args) {
    return Reflect.construct(target, args.length ? args : [observedAt]);
  },
  apply() { return new NativeDate(observedAt).toString(); },
  get(target, key) {
    return key === 'now' ? () => observedAt : Reflect.get(target, key);
  }
});
`
  const url = `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`
  return {
    ...base,
    NODE_OPTIONS: [base.NODE_OPTIONS, `--import=${url}`]
      .filter(Boolean)
      .join(' '),
  }
}

export function execFileWithStaleMatrixClock(
  file: string,
  args: string[],
  options: ExecFileOptions = {},
) {
  return execFileAsync(file, args, {
    ...options,
    encoding: 'utf8',
    env: releaseClockEnv('stale', options.env),
  })
}
