import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

export const sourceReadyCommentMarker =
  '<!-- honowarden-managed:HON-202:source-ready -->'

export function renderSourceReadyCheckpoint() {
  return [
    sourceReadyCommentMarker,
    '',
    '## AUTH-2A source-ready checkpoint',
    '',
    'Status: source-ready on the local branch; HON-202 remains In Progress.',
    '',
    '### Implemented',
    '',
    '- Added `POST /api/accounts/security-stamp` behind recent password authentication and exact current client-derived authentication-hash proof.',
    '- One guarded D1 batch rotates the security stamp and revision, revokes every active owner device and refresh token, and persists one redacted required audit event.',
    '- Malformed, invalid, stale, disabled-user, partial-failure, and concurrent stale requests fail without a partial credential generation.',
    '- Password, KDF, account-key, and user-key mutation routes remain absent and belong to later children.',
    '',
    '### Verification',
    '',
    '- Focused domain/repository: 2 files, 11 tests passed; focused route: 5 tests passed; scheduled retention: 9 tests passed.',
    '- Full host suite: 80 files, 787 tests passed.',
    '- TypeScript, ESLint, Prettier, brand policy, 17 workflow Node tests, and `git diff --check` passed.',
    '- Fresh local D1 smoke passed migrations, success, old-token rejection, owner-wide revocation, relogin/sync, forced-audit rollback, cross-account isolation, and one-winner concurrency.',
    '- Independent complete-diff review reported no actionable findings after correcting unconditional retention cleanup for mandatory credential audit rows.',
    '',
    '### Boundary',
    '',
    '- This is a local source-ready checkpoint only. No commit, PR, CI, merge, main-branch readback, deploy, production mutation, or compatibility promotion is claimed.',
    '- HON-202 must remain In Progress until reviewed merge and exact post-merge Linear closeout; HON-203 through HON-205 remain blocked by it.',
  ].join('\n')
}

export function sourceReadyCheckpointIdentity(
  body = renderSourceReadyCheckpoint(),
) {
  return {
    bytes: Buffer.byteLength(body, 'utf8'),
    sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
  }
}
