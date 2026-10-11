import { Buffer } from 'node:buffer'
import { publicControlFailureCode } from './preflight-policy.mjs'

export const PUBLIC_PHASES = Object.freeze([
  'ENTRY',
  'VERSION_OK',
  'PARSER_BEGIN',
  'PARSER_RETURNED',
  'FUNCTION_SELECTION_BEGIN',
  'FUNCTION_SELECTION_RETURNED',
  'FUNCTION_UNIQUE_BEGIN',
  'FUNCTION_UNIQUE_RETURNED',
  'FUNCTION_DEFINITION_BEGIN',
  'FUNCTION_DEFINITION_RETURNED',
  'FUNCTION_EVAL_BEGIN',
  'FUNCTION_EVAL_RETURNED',
  'LEGACY_JSON_BEGIN',
  'LEGACY_JSON_RETURNED',
  'DIRECT_JSON_BEGIN',
  'DIRECT_JSON_RETURNED',
  'SINGLE_JSON_BEGIN',
  'SINGLE_JSON_RETURNED',
  'OBJECT_JSON_BEGIN',
  'OBJECT_JSON_RETURNED',
  'PAYLOAD_BEGIN',
  'PAYLOAD_RETURNED',
  'MEMBERS_BEGIN',
  'MEMBERS_RETURNED',
  'EXECUTABLE_BEGIN',
  'EXECUTABLE_RETURNED',
])
export const PUBLIC_SUCCESS =
  '{"object":"windowsPayloadControl","legacyWrapperCount":1,"directCount":2,"members":85,"parserErrors":0}'
const GENERIC = 'powershell_public_payload_control_failed'
export function decodePublicControlStream(value) {
  const invalid = {
    phase: 'NONE',
    prefixValid: false,
    success: false,
    failureCode: GENERIC,
  }
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 4096)
    return invalid
  let remaining = value
  let count = 0
  for (const phase of PUBLIC_PHASES) {
    if (!remaining.startsWith(phase + '\n')) break
    remaining = remaining.slice(phase.length + 1)
    count++
  }
  const phase = count ? PUBLIC_PHASES[count - 1] : 'NONE'
  const result = {
    phase,
    prefixValid: true,
    success: false,
    failureCode: GENERIC,
  }
  if (remaining === '') return result
  if (count === PUBLIC_PHASES.length && remaining === PUBLIC_SUCCESS)
    return { ...result, success: true }
  const failureCode = publicControlFailureCode(remaining)
  const oldPhase =
    count <= 2
      ? 'version'
      : count <= 4
        ? 'parser'
        : count <= 12
          ? 'functions'
          : count <= 14
            ? 'legacy_array'
            : count <= 16
              ? 'direct_array'
              : count <= 18
                ? 'single_array'
                : count <= 20
                  ? 'object_array'
                  : count <= 22
                    ? 'manifest'
                    : count <= 24
                      ? 'members'
                      : 'executable'
  if (
    !count ||
    failureCode === GENERIC ||
    !remaining.startsWith(
      '{"object":"windowsPayloadControlFailure","phase":"' + oldPhase + '",',
    )
  )
    return invalid
  return { ...result, failureCode }
}
export function decodePublicControlError(error) {
  let stdout
  try {
    if (error && typeof error === 'object') {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'stdout')
      if (descriptor && Object.hasOwn(descriptor, 'value'))
        stdout = descriptor.value
    }
  } catch {
    return decodePublicControlStream(undefined)
  }
  return decodePublicControlStream(stdout)
}
export function publicControlPhase(error) {
  const { phase, prefixValid } = decodePublicControlError(error)
  return { object: 'windowsPublicControlPhase', phase, prefixValid }
}
