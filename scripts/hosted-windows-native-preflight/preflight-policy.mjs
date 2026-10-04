import { createHash } from 'node:crypto';

export const COMPANY = '2deeee0cf159da92babc86e09de44c12eea2aa93';
const PAYLOAD_SHA256 = '7baaf42799ec914f5e0f08cffca3641d97b3c4b98bd02da06ec678c7cedbd2a8';
const EXECUTABLE_SHA256 = '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a';

export function decodeExternalUtf8(value, maximum = 16384) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4 * Math.ceil(maximum / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw Error('external_data_encoding');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximum || bytes.toString('base64') !== value) throw Error('external_data_encoding');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

export function requirePayloadPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 2048 ||
    /[:\\\u0000-\u001f\u007f]/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    throw Error('asset_path');
  return value;
}

export function decodeDesktopPayload(value) {
  if (value?.schemaVersion !== 1 || value.encoding !== 'canonical-base64-utf8')
    throw Error('payload_encoding');
  const text = decodeExternalUtf8(value.payloadBase64);
  if (createHash('sha256').update(text, 'utf8').digest('hex') !== PAYLOAD_SHA256)
    throw Error('payload_equivalence');
  const files = JSON.parse(text);
  if (!Array.isArray(files) || files.length !== 85) throw Error('asset_members');
  const paths = new Set();
  for (const file of files) {
    requirePayloadPath(file.path);
    const canonical = file.path.toLowerCase();
    if (
      paths.has(canonical) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw Error('asset_member');
    paths.add(canonical);
  }
  const executable = files.filter((file) => file.sha256 === EXECUTABLE_SHA256);
  if (executable.length !== 1) throw Error('asset_executable');
  const assetUrl = decodeExternalUtf8(value.assetUrlBase64, 2048);
  const url = new URL(assetUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw Error('asset_url');
  const appDataVariable = decodeExternalUtf8(value.appDataVariableBase64, 128);
  if (!/^[A-Z][A-Z0-9_]*$/.test(appDataVariable)) throw Error('asset_environment');
  return { files, assetUrl, appDataVariable, executablePath: executable[0].path };
}
export function admitProbe(value, now = Date.now()) {
  if (
    value?.companyCommit !== COMPANY ||
    value.platform !== 'win32' ||
    value.arch !== 'x64' ||
    value.nodeVersion !== '22.22.0' ||
    value.freshHostedGuest !== true ||
    !Number.isSafeInteger(value.freeBytes) ||
    value.freeBytes < 2 ** 30 ||
    !Number.isSafeInteger(value.createdAtMs) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    value.createdAtMs > now ||
    value.expiresAtMs <= now ||
    value.expiresAtMs - value.createdAtMs > 300000
  )
    throw Error('preauth_admission_failed');
  return true;
}
export function remainingBudget(deadline, now = Date.now(), maximum = 10000) {
  const remaining = deadline - now;
  if (!Number.isFinite(remaining) || remaining <= 0) throw Error('preauth_deadline');
  return Math.min(remaining, maximum);
}
export function projectedResult(value) {
  return {
    object: 'windowsHostedPreauth',
    worker: value.worker === true,
    gui: value.gui === true,
    dpapi: value.dpapi === true,
    credentialMarker: value.credentialMarker === true,
    cleanup: value.cleanup === true,
    authenticated: false,
    windows11Acceptance: false,
  };
}
