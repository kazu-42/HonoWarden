const allowedCodes = new Set([
  'lease_invalid',
  'manifest_path_invalid',
  'local_origin_invalid',
  'cdp_endpoint_invalid',
  'desktop_target_not_unique',
  'process_identity_invalid',
  'held_write_invalid',
  'held_write_consumed',
  'held_write_expired',
  'held_write_cancelled',
  'five_fields_invalid',
  'controller_deadline',
  'manifest_mismatch',
  'native_ui_not_unique',
  'native_ui_disabled',
  'native_ui_timeout',
  'cdp_timeout',
  'cdp_closed',
  'cdp_malformed',
  'cdp_command_failed',
  'request_not_admitted',
  'request_body_bound',
  'mutation_readback_unavailable',
  'windows_helper_failed',
  'windows_helper_timeout',
  'windows_helper_spawn',
  'windows_helper_input',
  'windows_helper_output',
  'windows_helper_output_bound',
  'windows_helper_json',
  'windows_helper_exit',
  'windows_helper_compile',
  'windows_helper_job',
  'windows_helper_process',
  'windows_helper_listener',
  'windows_helper_window',
  'desktop_process_exited',
  'tls_negative_control_failed',
  'guest_preflight_failed',
  'unexpected_controller_failure',
])

export class ControllerFailure extends Error {
  constructor(code) {
    super(allowedCodes.has(code) ? code : 'unexpected_controller_failure')
    this.code = this.message
  }
}
export function ensure(condition, code) {
  if (!condition) throw new ControllerFailure(code)
}
export function safeFailure(error) {
  return allowedCodes.has(error?.code)
    ? error.code
    : 'unexpected_controller_failure'
}

export function requireLease(value, manifestDigest, now = Date.now()) {
  const createdAtMs = Date.parse(value?.machineCreatedAt)
  const expiresAtMs = Date.parse(value?.expiresAt)
  ensure(
    value?.authorized === true &&
      value.purpose === 'windows_vagon_synthetic_acceptance' &&
      /^[A-Za-z0-9_-]{6,100}$/.test(value.id ?? '') &&
      /^[a-f0-9]{64}$/.test(manifestDigest) &&
      value.manifestSha256 === manifestDigest &&
      value.accountPaymentAuthorized === true &&
      value.freshGuestConfirmed === true &&
      value.noHostShareConfirmed === true &&
      value.syntheticOnly === true &&
      Number.isFinite(now) &&
      Number.isFinite(createdAtMs) &&
      Number.isFinite(expiresAtMs) &&
      createdAtMs <= now &&
      expiresAtMs > now &&
      expiresAtMs - createdAtMs <= 3600000,
    'lease_invalid',
  )
  return {
    id: value.id,
    createdAtMs,
    expiresAtMs,
    manifestSha256: manifestDigest,
  }
}

export function writableBudget(lease, now) {
  ensure(
    Number.isFinite(now) && now >= lease.createdAtMs,
    'controller_deadline',
  )
  return {
    writable: now < Math.min(lease.createdAtMs + 45 * 60000, lease.expiresAtMs),
    cleanupRequired:
      now >= Math.min(lease.createdAtMs + 48 * 60000, lease.expiresAtMs),
    expired: now >= lease.expiresAtMs,
  }
}

export function requireRelativePath(value) {
  ensure(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 512 &&
      !/[\\:<>"|?*]/.test(value) &&
      !hasControlCharacter(value),
    'manifest_path_invalid',
  )
  const parts = value.split('/')
  ensure(
    parts.every(
      (part) =>
        part &&
        part !== '.' &&
        part !== '..' &&
        !/[. ]$/.test(part) &&
        !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
    ),
    'manifest_path_invalid',
  )
  ensure(value === value.normalize('NFC'), 'manifest_path_invalid')
  return value
}

export function requireLocalOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new ControllerFailure('local_origin_invalid')
  }
  ensure(
    url.protocol === 'https:' &&
      url.hostname === '127.0.0.1' &&
      !url.username &&
      !url.password &&
      Number(url.port) >= 1024 &&
      Number(url.port) <= 65535 &&
      value === url.origin,
    'local_origin_invalid',
  )
  return url.origin
}

export function requireCdpEndpoint(value, port) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new ControllerFailure('cdp_endpoint_invalid')
  }
  ensure(
    Number.isSafeInteger(port) &&
      port >= 1024 &&
      port <= 65535 &&
      url.protocol === 'ws:' &&
      url.hostname === '127.0.0.1' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      Number(url.port) === port &&
      /^\/devtools\/page\/[A-Za-z0-9._-]{1,100}$/.test(url.pathname) &&
      value === url.href,
    'cdp_endpoint_invalid',
  )
  return url
}

export function selectDesktopTarget(targets, expected, port) {
  ensure(
    Array.isArray(targets) &&
      targets.length <= 50 &&
      typeof expected === 'string' &&
      /^file:\/\/\/[A-Za-z]:\/[^?#]+\/desktop\/resources\/app\.asar\/index\.html$/.test(
        expected,
      ),
    'desktop_target_not_unique',
  )
  const candidates = targets.filter((t) => {
    if (t?.type !== 'page' || typeof t.url !== 'string') return false
    try {
      const url = new URL(t.url)
      const hash = url.hash
      url.hash = ''
      return (
        url.href === expected &&
        (hash === '' ||
          (/^#\//.test(hash) &&
            hash.length <= 2048 &&
            !hasControlCharacter(hash, true)))
      )
    } catch {
      return false
    }
  })
  ensure(
    candidates.length === 1 && typeof candidates[0].id === 'string',
    'desktop_target_not_unique',
  )
  requireCdpEndpoint(candidates[0].webSocketDebuggerUrl, port)
  return candidates[0]
}

export function requireProcessProof(proof, desktopHash, desktopPid, createdAt) {
  ensure(
    Array.isArray(proof?.jobProcessIds) &&
      proof.jobProcessIds.length > 0 &&
      proof.jobProcessIds.length <= 128 &&
      proof.jobProcessIds.every((id) => Number.isSafeInteger(id) && id > 0) &&
      proof.jobProcessIds.includes(desktopPid) &&
      proof.desktopPid === desktopPid &&
      proof.desktopCreatedAt === createdAt &&
      proof.desktopHash === desktopHash &&
      proof.desktopPathMatches === true &&
      proof.desktopAppdataMatches === true &&
      proof.listenerProcessId === desktopPid &&
      proof.listenerOnlyLoopback === true,
    'process_identity_invalid',
  )
  return true
}

export function requireFiveFields(value) {
  const expected = ['name', 'notes', 'username', 'password', 'uri']
  ensure(
    value &&
      Object.keys(value).length === expected.length &&
      expected.every(
        (k) =>
          typeof value[k] === 'string' &&
          value[k].length > 0 &&
          value[k].length <= 5000,
      ),
    'five_fields_invalid',
  )
  return value
}

export function createHeldWrite(
  cipherId,
  { timeoutMs = 20000, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  ensure(
    /^[A-Za-z0-9_-]{1,100}$/.test(cipherId) &&
      Number.isFinite(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= 30000,
    'held_write_invalid',
  )
  let phase = 'armed',
    timer,
    resolve,
    reject
  const settle = (next, error) => {
    ensure(phase === 'waiting', 'held_write_consumed')
    phase = next
    clearTimer(timer)
    if (error) reject(new ControllerFailure(error))
    else resolve(true)
  }
  return {
    matches: (method, path) =>
      phase === 'armed' &&
      method === 'PUT' &&
      path === `/api/ciphers/${cipherId}`,
    wait() {
      ensure(phase === 'armed', 'held_write_consumed')
      phase = 'waiting'
      return new Promise((yes, no) => {
        resolve = yes
        reject = no
        timer = setTimer(
          () => settle('expired', 'held_write_expired'),
          timeoutMs,
        )
      })
    },
    release() {
      settle('released')
    },
    dispose() {
      if (phase === 'waiting') settle('cancelled', 'held_write_cancelled')
      else if (phase === 'armed') phase = 'cancelled'
    },
    get phase() {
      return phase
    },
  }
}

export async function runCleanup(steps) {
  const failures = []
  for (const [name, operation] of steps) {
    ensure(
      /^[a-z_]{1,30}$/.test(name) && typeof operation === 'function',
      'unexpected_controller_failure',
    )
    try {
      await operation()
    } catch {
      failures.push(`cleanup_${name}_failed`)
    }
  }
  return { ok: failures.length === 0, failures }
}
import { URL } from 'node:url'
import { setTimeout, clearTimeout } from 'node:timers'

export function hasControlCharacter(value, includeSpace = false) {
  return [...value].some((character) => {
    const code = character.codePointAt(0)
    return code <= (includeSpace ? 32 : 31) || code === 127
  })
}
