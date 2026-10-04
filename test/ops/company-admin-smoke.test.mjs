import { describe, expect, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import {
  mkdtemp,
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setImmediate } from 'node:timers'
import { URL } from 'node:url'
import {
  auditRunWindow,
  logoutFromUiAndAwaitRevocation,
  searchRunAuditFromUi,
  assertDistinctBrowserFamilies,
  completeDistinctFamilyStepUpUi,
  verifyEnrollmentAssurance,
  childEnvironment,
  classifyNativeStderr,
  closeOwnedBrowserServer,
  beforeDeadline,
  migrationStatements,
  nativeCommandAction,
  ownedRunPath,
  parseOptions,
  refreshWorkspaceFromUi,
  safeErrorClassification,
  writeSupervisorProof,
  verifyNativeBootstrapFile,
} from '../../scripts/honowarden-company-admin-smoke.mjs'

function absentProcess() {
  const error = new Error('owned process absent')
  error.code = 'ESRCH'
  throw error
}

describe('company administration acceptance execution boundary', () => {
  it('allows only exact owned-profile bootstrap bytes on the first version action', () => {
    const path = '/owned/private/profile/data.json'
    const notice = Buffer.from(
      'Could not find data file, "' + path + '"; creating it instead.\n',
    )
    assert.equal(
      classifyNativeStderr(notice, path, true),
      'official_cli_first_profile_bootstrap',
    )
    assert.equal(classifyNativeStderr(notice, path, false), 'unexpected_stderr')
    assert.equal(
      classifyNativeStderr(notice, '/other/profile/data.json', true),
      'unexpected_stderr',
    )
    const extra = Buffer.concat([notice, Buffer.from('private-canary-token\n')])
    const classification = classifyNativeStderr(extra, path, true)
    assert.equal(classification, 'unexpected_stderr')
    assert.ok(!classification.includes('private-canary'))
    assert.equal(classifyNativeStderr(Buffer.alloc(0), path, false), 'empty')
  })

  it('native action projection excludes login codes, passwords and server URLs', () => {
    assert.equal(nativeCommandAction(['--version']), 'version')
    assert.equal(
      nativeCommandAction([
        'login',
        'private-canary@example.invalid',
        '--code',
        '123456',
      ]),
      'login',
    )
    assert.equal(
      nativeCommandAction([
        'config',
        'server',
        'https://private.invalid/#canary',
      ]),
      'configure_server',
    )
    assert.equal(nativeCommandAction(['eval', 'private-canary']), 'unsupported')
  })

  it('bootstrap readback rejects public files and symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'company-bootstrap-private-'))
    try {
      const data = join(root, 'data.json')
      await writeFile(data, '{}', { mode: 0o600 })
      await verifyNativeBootstrapFile(data)
      await chmod(data, 0o644)
      await assert.rejects(
        verifyNativeBootstrapFile(data),
        /native_bootstrap_file_not_private/,
      )
      await chmod(data, 0o600)
      const linked = join(root, 'linked.json')
      await symlink(data, linked)
      await assert.rejects(
        verifyNativeBootstrapFile(linked),
        /native_bootstrap_file_not_private/,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('hung graceful close is bounded, forcibly terminates only the owned browser, and reports escalation', async () => {
    let kills = 0
    const result = await closeOwnedBrowserServer(
      {
        process: () => ({ pid: 123 }),
        close: () => new Promise(() => {}),
        kill: async () => {
          kills += 1
        },
      },
      { gracefulMs: 10, forceMs: 10, processKill: absentProcess },
    )
    assert.equal(kills, 1)
    assert.equal(result.graceful, false)
    assert.equal(result.publicKillCompleted, true)
    assert.equal(result.processGroupAbsent, true)
  })

  it('public kill hanging still performs mandatory owned-process termination and readback', async () => {
    let probes = 0
    const result = await closeOwnedBrowserServer(
      {
        process: () => ({ pid: 123 }),
        close: () => new Promise(() => {}),
        kill: () => new Promise(() => {}),
      },
      {
        gracefulMs: 10,
        forceMs: 10,
        processKill: () => {
          probes += 1
          absentProcess()
        },
      },
    )
    assert.equal(result.graceful, false)
    assert.equal(result.publicKillCompleted, false)
    assert.equal(result.processGroupAbsent, true)
    assert.ok(probes >= 2)
  })

  it('successful graceful close never invokes force close', async () => {
    let kills = 0
    const result = await closeOwnedBrowserServer(
      {
        process: () => ({ pid: 123 }),
        close: async () => {},
        kill: async () => {
          kills += 1
        },
      },
      { gracefulMs: 10, processKill: absentProcess },
    )
    assert.equal(kills, 0)
    assert.equal(result.graceful, true)
    assert.equal(result.processGroupAbsent, true)
  })
  it('waits for a disabled refresh action even when an organization-less view has no loading status', async () => {
    vi.useFakeTimers()
    let enabled = true
    let statusCount = 0
    let completed = false
    const refresh = {
      click: vi.fn(async () => {
        enabled = false
      }),
      isEnabled: vi.fn(async () => enabled),
    }
    const statuses = {
      filter: () => ({ count: async () => statusCount }),
    }
    const page = {
      getByRole: (role) => (role === 'button' ? refresh : statuses),
    }
    try {
      const pending = refreshWorkspaceFromUi(page).then(() => {
        completed = true
      })
      await vi.advanceTimersByTimeAsync(50)
      expect(refresh.click).toHaveBeenCalledTimes(1)
      expect(completed).toBe(false)
      enabled = true
      statusCount = 1
      await vi.advanceTimersByTimeAsync(100)
      expect(completed).toBe(false)
      statusCount = 0
      await vi.advanceTimersByTimeAsync(100)
      await pending
      expect(completed).toBe(true)
      expect(refresh.isEnabled).toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not write an artifact when the child never acquired the fresh run root', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'company-smoke-unowned-'))
    try {
      const root = await realpath(temporary)
      await writeFile(join(root, 'supervisor.json'), 'existing-proof', {
        mode: 0o600,
      })
      await expect(
        writeSupervisorProof(root, undefined, { terminalCode: 'failed' }),
      ).resolves.toEqual({ saved: false, reason: 'run_root_not_owned' })
      expect(await readFile(join(root, 'supervisor.json'), 'utf8')).toBe(
        'existing-proof',
      )
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('uses exclusive proof creation and refuses a symlink or an incorrect ownership nonce', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'company-smoke-proof-'))
    try {
      const parent = await realpath(temporary)
      const root = join(parent, 'owned')
      await mkdir(root, { mode: 0o700 })
      await writeFile(
        join(root, 'ownership.json'),
        JSON.stringify({ uid: process.getuid(), nonce: 'owned-nonce' }),
        { mode: 0o600 },
      )
      await expect(
        writeSupervisorProof(root, 'wrong-nonce', {}),
      ).rejects.toThrow('supervisor_run_ownership_invalid')
      const outside = join(parent, 'sentinel')
      await writeFile(outside, 'unchanged', { mode: 0o600 })
      await symlink(outside, join(root, 'supervisor.json'))
      await expect(
        writeSupervisorProof(root, 'owned-nonce', {}),
      ).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(outside, 'utf8')).toBe('unchanged')
      await rm(join(root, 'supervisor.json'))
      await expect(
        writeSupervisorProof(root, 'owned-nonce', {
          terminalCode: 'completed',
        }),
      ).resolves.toEqual({ saved: true })
      expect(
        JSON.parse(await readFile(join(root, 'supervisor.json'), 'utf8')),
      ).toEqual({ terminalCode: 'completed' })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
  it('classifies navigation and locator failures without exposing URL fragments or input values', () => {
    const network = safeErrorClassification(
      new Error(
        'page.goto: net::ERR_NAME_NOT_RESOLVED at https://local.test/#token=private-canary',
      ),
    )
    expect(network).toEqual({
      kind: 'browser_network',
      operation: 'page.goto',
      network: 'ERR_NAME_NOT_RESOLVED',
    })
    const locator = safeErrorClassification(
      new Error(
        'locator.fill: strict mode violation private-canary@example.test',
      ),
    )
    expect(locator).toEqual({
      kind: 'ambiguous_locator',
      operation: 'locator.fill',
    })
    expect(JSON.stringify([network, locator])).not.toContain('private-canary')
  })
  it('escalates a hung cleanup once and returns only its fixed safe failure code', async () => {
    vi.useFakeTimers()
    try {
      const escalate = vi.fn()
      const pending = beforeDeadline(
        new Promise(() => {}),
        20000,
        'cleanup_deadline_exceeded',
        escalate,
      )
      const rejected = expect(pending).rejects.toThrow(
        'cleanup_deadline_exceeded',
      )
      await vi.advanceTimersByTimeAsync(20000)
      await rejected
      expect(escalate).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels escalation when cleanup completes before its deadline', async () => {
    vi.useFakeTimers()
    try {
      const escalate = vi.fn()
      await expect(
        beforeDeadline(
          Promise.resolve('closed'),
          20000,
          'cleanup_deadline_exceeded',
          escalate,
        ),
      ).resolves.toBe('closed')
      await vi.advanceTimersByTimeAsync(20000)
      expect(escalate).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('refuses execution without both explicit confirmation and an exact source pin', () => {
    expect(() => parseOptions(['run'])).toThrow(
      'execution_confirmation_required',
    )
    expect(() =>
      parseOptions(['run', '--execute', '--confirm', 'company-admin-smoke']),
    ).toThrow('source_pin_required')
    expect(() => parseOptions(['plan', '--execute'])).toThrow(
      'plan_cannot_execute',
    )
    expect(() =>
      parseOptions([
        'run',
        '--execute',
        '--confirm',
        'company-admin-smoke',
        '--source-sha256',
        'a'.repeat(64),
      ]),
    ).not.toThrow()
  })

  it('rejects remote, sibling, nested and traversal run roots', () => {
    for (const path of [
      'https://vault.example.test',
      '/tmp/company-admin',
      'test/.tmp/../escaped',
      'test/.tmp/nested/profile',
      '../HonoWarden-integration-2026-09-06/test/.tmp/reused',
    ]) {
      expect(() => ownedRunPath(path, '/synthetic/repository')).toThrow()
    }
    expect(
      ownedRunPath('test/.tmp/company-admin-fresh', '/synthetic/repository'),
    ).toBe('/synthetic/repository/test/.tmp/company-admin-fresh')
  })

  it('excludes ambient credentials, injected Node options and global TLS bypasses from native children', () => {
    const environment = childEnvironment(
      '/synthetic/run',
      '/synthetic/run/certificate.pem',
      {
        PATH: '/usr/bin:/bin',
        HOME: '/normal-home',
        BW_PASSWORD: 'must-be-excluded',
        BW_SESSION: 'must-be-excluded',
        CLOUDFLARE_API_TOKEN: 'must-be-excluded',
        NODE_OPTIONS: '--require untrusted',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        HTTPS_PROXY: 'https://untrusted.example.test',
      },
    )
    expect(environment.HOME).toBe('/synthetic/run/native/home')
    expect(environment.NODE_EXTRA_CA_CERTS).toBe(
      '/synthetic/run/certificate.pem',
    )
    for (const key of [
      'BW_PASSWORD',
      'BW_SESSION',
      'CLOUDFLARE_API_TOKEN',
      'NODE_OPTIONS',
      'NODE_TLS_REJECT_UNAUTHORIZED',
      'HTTPS_PROXY',
    ])
      expect(environment).not.toHaveProperty(key)
  })

  it('keeps trigger bodies in one D1 statement and rejects truncated migrations', () => {
    const statements = migrationStatements(
      "CREATE TABLE example(id TEXT);\nCREATE TRIGGER guard BEFORE INSERT ON example\nBEGIN\nSELECT RAISE(ABORT, 'synthetic');\nEND;\nINSERT INTO example VALUES ('row');\n",
    )
    expect(statements).toHaveLength(3)
    expect(statements[1]).toContain('SELECT RAISE')
    expect(statements[1]).toContain('END;')
    expect(() =>
      migrationStatements(
        'CREATE TRIGGER guard BEFORE INSERT ON example\nBEGIN\nSELECT 1;',
      ),
    ).toThrow('incomplete_migration')
  })

  it('successful enrollment already assures its exact family without requiring an absent step-up control', async () => {
    let roleLookups = 0
    const result = await verifyEnrollmentAssurance(
      {
        locator: () => ({ count: async () => 0 }),
        getByRole: () => {
          roleLookups++
          throw new Error(
            'step-up control is correctly absent after enrollment',
          )
        },
      },
      async () => ({ verified: true }),
    )
    assert.deepEqual(result, { enrollmentAssured: true, explicitStepUp: false })
    assert.equal(roleLookups, 0)
  })

  it('enrollment fails if a secret remains or canonical assurance is false; it cannot heal by step-up', async () => {
    let reads = 0
    await assert.rejects(
      verifyEnrollmentAssurance(
        { locator: () => ({ count: async () => 1 }) },
        async () => {
          reads++
          return { verified: true }
        },
      ),
      /setup_seed_dom_retained/,
    )
    assert.equal(reads, 0)
    await assert.rejects(
      verifyEnrollmentAssurance(
        { locator: () => ({ count: async () => 0 }) },
        async () => ({ verified: false }),
      ),
      /enrollment_family_not_assured/,
    )
  })

  const token = (claims) =>
    'header.' +
    Buffer.from(JSON.stringify(claims)).toString('base64url') +
    '.signature'

  it('step-up family requires the same account and distinct immutable session and device identifiers', () => {
    const first = token({
      sub: 'same-user',
      device: 'first-device',
      sessionId: 'first-session',
    })
    const second = token({
      sub: 'same-user',
      device: 'second-device',
      sessionId: 'second-session',
    })
    assert.equal(assertDistinctBrowserFamilies(first, second), true)
    assert.throws(
      () => assertDistinctBrowserFamilies(first, first),
      /browser_families_not_distinct/,
    )
    assert.throws(
      () =>
        assertDistinctBrowserFamilies(
          first,
          token({
            sub: 'same-user',
            device: 'second-device',
            sessionId: 'first-session',
          }),
        ),
      /browser_families_not_distinct/,
    )
    assert.throws(
      () =>
        assertDistinctBrowserFamilies(
          first,
          token({
            sub: 'other-user',
            device: 'second-device',
            sessionId: 'second-session',
          }),
        ),
      /browser_family_account_mismatch/,
    )
    assert.throws(
      () => assertDistinctBrowserFamilies('private-canary-secret', second),
      (error) =>
        error.code === 'browser_family_claims_invalid' &&
        error.message === 'browser_family_claims_invalid',
    )
  })

  function familyUi({ enrolled = true, before = false, after = true } = {}) {
    const events = []
    const clicks = (name) => ({
      click: async () => {
        events.push(name)
      },
    })
    const accountDialog = {
      getByRole: (role, options) => {
        assert.equal(role, 'button')
        assert.equal(options.name, '認証コードで本人確認')
        return clicks('open_stepup_dialog')
      },
    }
    const stepUpDialog = {
      getByLabel: (name) => {
        assert.equal(name, '認証アプリの6桁コード')
        return {
          fill: async (code) => {
            assert.equal(code, '654321')
            events.push('fill_fresh_code')
          },
        }
      },
      getByRole: (role, options) => {
        assert.equal(role, 'button')
        assert.equal(options.name, '本人確認する')
        return clicks('submit_stepup')
      },
    }
    let reads = 0
    return {
      events,
      arguments: {
        page: {
          getByRole: (role, options) => {
            if (role === 'button') {
              assert.equal(options.name, 'アカウントのセキュリティ')
              return clicks('open_account_dialog')
            }
            assert.equal(role, 'dialog')
            if (options.name === 'アカウントのセキュリティ')
              return accountDialog
            assert.equal(options.name, '現在のセッションを本人確認')
            return stepUpDialog
          },
        },
        refreshPage: async () => {
          events.push('refresh_completed')
        },
        readProfile: async () => {
          events.push('canonical_profile')
          return { TwoFactorEnabled: enrolled }
        },
        readAssurance: async () => {
          events.push(reads === 0 ? 'canonical_unassured' : 'canonical_assured')
          return { verified: reads++ === 0 ? before : after }
        },
        getFreshCode: async () => {
          events.push('next_user_totp_step')
          return '654321'
        },
        closeDialog: async () => {
          events.push('dialog_closed')
        },
      },
    }
  }

  it('distinct-family step-up refreshes first, starts unassured, submits via scoped UI, and rereads proof', async () => {
    const fixture = familyUi()
    assert.deepEqual(await completeDistinctFamilyStepUpUi(fixture.arguments), {
      enrolled: true,
      unassuredBefore: true,
      explicitStepUp: true,
      verifiedAfter: true,
    })
    assert.deepEqual(fixture.events, [
      'refresh_completed',
      'canonical_profile',
      'canonical_unassured',
      'open_account_dialog',
      'open_stepup_dialog',
      'next_user_totp_step',
      'fill_fresh_code',
      'submit_stepup',
      'dialog_closed',
      'canonical_assured',
    ])
  })

  it('a secondary family already assured by another family fails before any UI step-up', async () => {
    const fixture = familyUi({ before: true })
    await assert.rejects(
      completeDistinctFamilyStepUpUi(fixture.arguments),
      /stepup_family_was_already_assured/,
    )
    assert.deepEqual(fixture.events, [
      'refresh_completed',
      'canonical_profile',
      'canonical_unassured',
    ])
  })

  it('unenrolled profile and an unverified post-step-up readback cannot pass', async () => {
    const unenrolled = familyUi({ enrolled: false })
    await assert.rejects(
      completeDistinctFamilyStepUpUi(unenrolled.arguments),
      /stepup_family_not_enrolled/,
    )
    assert.deepEqual(unenrolled.events, [
      'refresh_completed',
      'canonical_profile',
    ])
    const unverified = familyUi({ after: false })
    await assert.rejects(
      completeDistinctFamilyStepUpUi(unverified.arguments),
      /stepup_family_not_assured/,
    )
    assert.ok(unverified.events.includes('submit_stepup'))
  })

  function auditUi({ status = 200, step = '0.001' } = {}) {
    const events = []
    const fields = {}
    let predicate
    let release
    const response = new Promise((resolve) => {
      release = resolve
    })
    return {
      fields,
      events,
      page: {
        evaluate: async (operation, values) => operation(values),
        getByLabel: (label) => {
          const name = label === '開始日時' ? 'from' : 'to'
          assert.ok(
            ['開始日時', '終了日時（この時刻は含まない）'].includes(label),
          )
          return {
            getAttribute: async () => step,
            fill: async (value) => {
              fields[name] = value
              events.push('fill_' + name)
            },
          }
        },
        waitForResponse: (check, options) => {
          assert.equal(options.timeout, 20000)
          predicate = check
          events.push('audit_response_wait_attached')
          return response
        },
        getByRole: (role, options) => {
          if (role === 'cell') {
            assert.equal(options.name, '認証ポリシーを変更')
            return {
              waitFor: async () => {
                events.push('policy_table_cell_visible')
              },
            }
          }
          assert.equal(role, 'button')
          assert.equal(options.name, '検索')
          return {
            click: async () => {
              events.push('submit_search')
              const url = new URL(
                'https://127.0.0.1:7777/api/organizations/synthetic/audit-events',
              )
              for (const key of ['from', 'to'])
                url.searchParams.set(key, new Date(fields[key]).toISOString())
              const value = {
                url: () => url.href,
                request: () => ({ method: () => 'GET' }),
                status: () => status,
              }
              assert.equal(predicate(value), true)
              events.push('exact_query_response')
              release(value)
            },
          }
        },
        getByText: () => {
          throw new Error('policy text matches hidden option and event cell')
        },
      },
    }
  }

  function stubClock(at) {
    const original = Date.now
    Date.now = () => at
    return () => {
      Date.now = original
    }
  }

  it('audit search cannot use stale defaults or match the hidden select option instead of an event cell', async () => {
    const now = Date.parse('2026-10-04T11:54:14.321Z')
    const restore = stubClock(now)
    try {
      const fixture = auditUi()
      const query = await searchRunAuditFromUi(
        fixture.page,
        '2026-10-04T11:52:54.792Z',
      )
      assert.equal(query.from, '2026-10-04T11:51:54.792Z')
      assert.equal(query.to, '2026-10-04T11:54:14.321Z')
      assert.ok(fixture.fields.from.endsWith('.792'))
      assert.ok(fixture.fields.to.endsWith('.321'))
      assert.equal(new Date(fixture.fields.from).toISOString(), query.from)
      assert.equal(new Date(fixture.fields.to).toISOString(), query.to)
      assert.deepEqual(fixture.events, [
        'fill_from',
        'fill_to',
        'audit_response_wait_attached',
        'submit_search',
        'exact_query_response',
        'policy_table_cell_visible',
      ])
    } finally {
      restore()
    }
  })

  it('audit run bounds include all run events, preserve half-open precision, and reject invalid or oversized ranges', () => {
    const start = '2026-10-04T11:52:54.792Z'
    const now = Date.parse('2026-10-04T11:54:14.321Z')
    const query = auditRunWindow(start, now)
    assert.ok(Date.parse(query.from) < Date.parse(start))
    assert.equal(Date.parse(query.to), now)
    assert.ok(Date.parse(start) + 1 < Date.parse(query.to))
    for (const [value, at] of [
      ['invalid-private-canary', now],
      [start, NaN],
      [start, Date.parse(start) - 1],
      [start, now + 32 * 86400000],
    ])
      assert.throws(() => auditRunWindow(value, at), /audit_run_window_invalid/)
  })

  it('audit HTTP failures and minute-only UI fields cannot pass or reach the table assertion', async () => {
    const restore = stubClock(Date.parse('2026-10-04T11:54:14.321Z'))
    try {
      const failure = auditUi({ status: 503 })
      await assert.rejects(
        searchRunAuditFromUi(failure.page, '2026-10-04T11:52:54.792Z'),
        /audit_search_not_acknowledged/,
      )
      assert.ok(!failure.events.includes('policy_table_cell_visible'))
      const rounded = auditUi({ step: '60' })
      await assert.rejects(
        searchRunAuditFromUi(rounded.page, '2026-10-04T11:52:54.792Z'),
        /audit_input_precision_unsupported/,
      )
      assert.equal(rounded.events.length, 0)
    } finally {
      restore()
    }
  })

  function logoutUi({ status = 200 } = {}) {
    const events = []
    let predicate
    let release
    let revoked = false
    const response = new Promise((resolve) => {
      release = resolve
    })
    return {
      events,
      get revoked() {
        return revoked
      },
      get predicate() {
        return predicate
      },
      complete: () => {
        revoked = status === 200
        events.push('server_revocation_response')
        release({ status: () => status })
      },
      page: {
        waitForResponse: (check, options) => {
          assert.equal(options.timeout, 20000)
          predicate = check
          events.push('logout_response_wait_attached')
          return response
        },
        getByRole: (role, options) =>
          role === 'button'
            ? {
                click: async () => {
                  assert.equal(options.name, 'サインアウト')
                  events.push('click_logout')
                },
              }
            : {
                waitFor: async () => {
                  assert.equal(options.name, '組織管理にサインイン')
                  events.push('signed_out_heading')
                },
              },
      },
    }
  }

  it('logout cannot complete at signed-out render before the server revocation response', async () => {
    const fixture = logoutUi()
    let completed = false
    const task = logoutFromUiAndAwaitRevocation(fixture.page).then(() => {
      completed = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(completed, false)
    assert.deepEqual(fixture.events, [
      'logout_response_wait_attached',
      'click_logout',
    ])
    fixture.complete()
    assert.deepEqual(await task, undefined)
    assert.equal(fixture.revoked, true)
    assert.equal(completed, true)
    assert.deepEqual(fixture.events, [
      'logout_response_wait_attached',
      'click_logout',
      'server_revocation_response',
      'signed_out_heading',
    ])
  })

  it('failed server logout acknowledgement does not pass on the signed-out DOM', async () => {
    const fixture = logoutUi({ status: 503 })
    const task = logoutFromUiAndAwaitRevocation(fixture.page)
    fixture.complete()
    await assert.rejects(task, /browser_logout_not_acknowledged/)
    assert.equal(fixture.revoked, false)
    assert.ok(!fixture.events.includes('signed_out_heading'))
  })

  it('logout response matching accepts only the exact POST endpoint', async () => {
    const fixture = logoutUi()
    const task = logoutFromUiAndAwaitRevocation(fixture.page)
    const response = (path, method) => ({
      url: () => 'https://127.0.0.1:7777' + path,
      request: () => ({ method: () => method }),
    })
    assert.equal(
      fixture.predicate(response('/identity/accounts/logout', 'POST')),
      true,
    )
    assert.equal(
      fixture.predicate(response('/identity/accounts/logout', 'GET')),
      false,
    )
    assert.equal(
      fixture.predicate(response('/identity/connect/token', 'POST')),
      false,
    )
    fixture.complete()
    await task
  })
})
