import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('user-key rotation operator policy', () => {
  it('keeps every tracked configuration default-off', () => {
    const envExample = readFileSync('.env.example', 'utf8')
    const generatedBindings = readFileSync('worker-configuration.d.ts', 'utf8')

    expect(envExample).toMatch(/^HONOWARDEN_USER_KEY_ROTATION_ENABLED=false$/m)
    expect(
      generatedBindings.match(/HONOWARDEN_USER_KEY_ROTATION_ENABLED/g),
    ).toHaveLength(3)
  })

  it('documents activation, status, incident, and forward-recovery boundaries', () => {
    const operatorDocs = readFileSync(
      'docs/operations/operator-environment.md',
      'utf8',
    )
    const dataFlow = readFileSync('docs/security/data-flow.md', 'utf8')
    const rollback = readFileSync('docs/release/rollback-guide.md', 'utf8')
    const currentState = readFileSync('docs/current-state.md', 'utf8')
    const auditEvents = readFileSync('docs/operations/audit-events.md', 'utf8')

    expect(operatorDocs).toContain('User-Key Rotation Rollout')
    expect(operatorDocs).toContain('HONOWARDEN_USER_KEY_ROTATION_ENABLED')
    expect(operatorDocs).toContain(
      '/api/accounts/key-management/rotate-user-account-keys',
    )
    expect(operatorDocs).toContain('D1-free `501 unsupported_feature`')
    expect(operatorDocs).toContain('user_key_rotation_over_budget')
    expect(dataFlow).toContain('## Atomic User-Key Rotation')
    expect(dataFlow).toContain('five snapshot queries')
    expect(dataFlow).toMatch(/nine transactional statements/i)
    expect(dataFlow).toContain('R2 object keys and bytes remain unchanged')
    expect(rollback).toContain('## User-Key Rotation Rollback')
    expect(rollback).toContain('forward generation')
    expect(rollback).toContain('Never restore')
    expect(currentState).toContain('## Week 26 Atomic User-Key Rotation')
    expect(currentState).toContain('fixture-only')
    expect(currentState).toContain('every tracked Wrangler environment')
    expect(auditEvents).toContain('`account.keys.rotate`')
    expect(auditEvents).toContain('R2 objects are unchanged')
    expect(auditEvents).toContain(
      '`account_notification_session_invalidation_failed`',
    )
  })
})
