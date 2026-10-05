import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import {
  buildDiagnosticInvocation,
  decodeDiagnosticPrefix,
  runDiagnostic,
} from './parser-diagnostic.mjs'

const phases = [
  'ENTRY',
  'VERSION_OK',
  'PATH_BEGIN',
  'PATH_JOINED',
  'EXISTS_BEGIN',
  'EXISTS_RETURNED',
  'PATH_READY',
  'PARSER_BEGIN',
  'PARSER_RETURNED',
]
const stream = (count) =>
  phases
    .slice(0, count)
    .map((phase) => `${phase}\n`)
    .join('')
const input = {
  systemRoot: 'C:\\Windows',
  root: "C:\\reviewed space\\O'Brien\\日本語😀",
}

test('SOURCE12 uses only fixed relative file names with IO path construction at three approved sites', async () => {
  const command = Buffer.from(
    buildDiagnosticInvocation(input).args[4],
    'base64',
  ).toString('utf16le')
  assert.match(
    command,
    /\$path=\[IO\.Path\]::Combine\(\$root,'preflight\.ps1'\)/,
  )
  assert.doesNotMatch(command, /Join-Path/)
  const fixture = await readFile(
    new URL('./preflight.node-check.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(
    fixture.includes(
      "ParseFile(([IO.Path]::Combine($root,'preflight.ps1')),[ref]$tokens,[ref]$parseErrors)",
    ),
    true,
  )
  assert.equal(
    fixture.includes("ParseFile((Join-Path $root 'preflight.ps1')"),
    false,
  )
  const controller = await readFile(
    new URL('./preflight.ps1', import.meta.url),
    'utf8',
  )
  assert.equal(
    controller.includes(
      "Get-Content -LiteralPath ([IO.Path]::Combine($root,'desktop-payload-manifest.json')) -Raw | ConvertFrom-Json",
    ),
    true,
  )
  assert.equal(
    controller.includes("Join-Path $root 'desktop-payload-manifest.json'"),
    false,
  )
  assert.equal(
    controller.includes(
      "$statePath=Join-Path $env:RUNNER_TEMP 'honowarden-windows-preauth-state.json'",
    ),
    true,
  )
})

test('SOURCE12 lexical constructor is the only diagnostic delta and cannot relax absolute root admission', async () => {
  const source = await readFile(
    new URL('./parser-diagnostic.mjs', import.meta.url),
    'utf8',
  )
  const inverse = source.replace(
    "$path=[IO.Path]::Combine($root,'preflight.ps1')",
    "$path=Join-Path $root 'preflight.ps1'",
  )
  assert.notEqual(inverse, source)
  assert.equal(
    createHash('sha256').update(inverse).digest('hex'),
    '3efefc6c97ba8256ff61b0c6bd5ed68630240bfe60f56c5e164018a999faa93b',
  )
  for (const root of [
    'relative',
    'C:drive-relative',
    '\\\\server\\share',
    'C:\\root\u0000',
  ]) {
    let calls = 0
    const report = runDiagnostic({ ...input, root }, () => {
      calls++
    })
    assert.equal(calls, 0)
    assert.equal(report.classification, 'diagnostic_admission_rejected')
    assert.equal(report.nativeAdmission, false)
  }
})

test('SOURCE11 nine prefixes separate joined and existence regions without ambiguous shortcuts', () => {
  for (let count = 0; count <= phases.length; count++) {
    assert.deepEqual(decodeDiagnosticPrefix(stream(count)), {
      valid: true,
      phase: count === 0 ? 'NONE' : phases[count - 1],
      completed: count === phases.length,
    })
  }
  for (const text of [
    stream(3) + 'PATH_READY\n',
    stream(3) + 'EXISTS_BEGIN\nPATH_JOINED\n',
    stream(4) + 'EXISTS_RETURNED\n',
    stream(5) + 'EXISTS_RETURN',
    stream(5) + 'EXISTS_BEGIN\n',
    stream(6) + 'EXISTS_RETURNED\n',
    stream(phases.length) + 'PATH_JOINED\n',
  ]) {
    assert.deepEqual(decodeDiagnosticPrefix(text), {
      valid: false,
      phase: 'NONE',
      completed: false,
    })
  }
})

test('SOURCE11 brackets fixed path construction and one existence call and preserves all other source10 bytes', async () => {
  const command = Buffer.from(
    buildDiagnosticInvocation(input).args[4],
    'base64',
  ).toString('utf16le')
  const statements = [
    "[Console]::Out.Write('PATH_BEGIN'+[char]10); [Console]::Out.Flush()",
    "$path=[IO.Path]::Combine($root,'preflight.ps1')",
    "[Console]::Out.Write('PATH_JOINED'+[char]10); [Console]::Out.Flush()",
    "[Console]::Out.Write('EXISTS_BEGIN'+[char]10); [Console]::Out.Flush()",
    '$exists=[IO.File]::Exists($path)',
    "[Console]::Out.Write('EXISTS_RETURNED'+[char]10); [Console]::Out.Flush()",
    'if (-not $exists) { exit 1 }',
    "[Console]::Out.Write('PATH_READY'+[char]10); [Console]::Out.Flush()",
  ]
  let previous = -1
  for (const statement of statements) {
    const position = command.indexOf(statement)
    assert.ok(position > previous)
    assert.equal(command.split(statement).length - 1, 1)
    previous = position
  }
  assert.equal(command.split('[IO.Path]::Combine').length - 1, 1)
  assert.equal(command.split('Join-Path').length - 1, 0)
  assert.equal(command.split('[IO.File]::Exists').length - 1, 1)
  const source = await readFile(
    new URL('./parser-diagnostic.mjs', import.meta.url),
    'utf8',
  )
  let inverse = source.replace(
    "$path=[IO.Path]::Combine($root,'preflight.ps1')",
    "$path=Join-Path $root 'preflight.ps1'",
  )
  for (const phase of ['PATH_JOINED', 'EXISTS_BEGIN', 'EXISTS_RETURNED']) {
    inverse = inverse.replace(`  '${phase}',\n`, '')
    inverse = inverse.replace(
      `  [Console]::Out.Write('${phase}'+[char]10); [Console]::Out.Flush()\n`,
      '',
    )
  }
  inverse = inverse.replace(
    '  $exists=[IO.File]::Exists($path)\n  if (-not $exists) { exit 1 }',
    '  if (-not [IO.File]::Exists($path)) { exit 1 }',
  )
  assert.equal(
    createHash('sha256').update(inverse).digest('hex'),
    '83b476eb26d4ed7c8d3edb9bdfd950de8e9848550ac6adc5304bd7d2adc08d53',
  )
})

test('complete canonical diagnostic sequence proves only the diagnostic completed', () => {
  assert.deepEqual(decodeDiagnosticPrefix(stream(phases.length)), {
    valid: true,
    phase: 'PARSER_RETURNED',
    completed: true,
  })
})

test('every valid nonterminal prefix retains the exact last observed phase', () => {
  for (let count = 0; count < phases.length; count++)
    assert.deepEqual(decodeDiagnosticPrefix(stream(count)), {
      valid: true,
      phase: count === 0 ? 'NONE' : phases[count - 1],
      completed: false,
    })
})

test('exact argument and options contract matches the frozen public child', () => {
  const invocation = buildDiagnosticInvocation(input)
  assert.equal(
    invocation.file,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  )
  assert.deepEqual(invocation.args.slice(0, 4), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
  ])
  assert.equal(invocation.args.length, 5)
  assert.deepEqual(invocation.options, {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 4096,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      PATH: 'C:\\Windows\\System32',
      PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
    },
  })
})

test('UTF16LE command roundtrip preserves apostrophe escaping and Unicode without a shell', () => {
  const invocation = buildDiagnosticInvocation(input)
  const command = Buffer.from(invocation.args[4], 'base64').toString('utf16le')
  assert.equal(
    Buffer.from(command, 'utf16le').toString('base64'),
    invocation.args[4],
  )
  assert.match(command, /\$root='C:\\reviewed space\\O''Brien\\日本語😀'/)
  assert.notEqual(
    Buffer.from(invocation.args[4], 'base64').toString('utf8'),
    command,
  )
  assert.equal(
    command.includes(
      'Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)',
    ),
    true,
  )
  assert.equal(command.split('Parser]::ParseFile').length - 1, 1)
  for (const phase of phases) {
    assert.equal(
      command.includes(`[Console]::Out.Write('${phase}'+[char]10)`),
      true,
    )
    assert.equal(
      command.includes(
        `[Console]::Out.Write('${phase}'+[char]10); [Console]::Out.Flush()`,
      ),
      true,
    )
  }
  assert.doesNotMatch(
    command,
    /ScriptBlock|Read-ExternalPayload|Invoke-Expression|Add-Type|Start-Process|Cleanup-Owned|Download|Invoke-WebRequest|\.\s+\$definition|ConvertFrom-Json|Set-Acl/,
  )
})

test('argument admission rejects controls and nonlocal path shapes before any executor call', () => {
  for (const changed of [
    { systemRoot: '' },
    { systemRoot: '\\\\server\\Windows' },
    { systemRoot: 'C:\\Windows\n' },
    { systemRoot: `C:\\${'x'.repeat(244)}` },
    { root: 'relative' },
    { root: '\\\\server\\source' },
    { root: 'C:\\source\u0000' },
    { root: 'C:\\source\ud800' },
  ]) {
    let called = false
    const report = runDiagnostic({ ...input, ...changed }, () => {
      called = true
    })
    assert.equal(called, false)
    assert.equal(report.classification, 'diagnostic_admission_rejected')
    assert.equal(JSON.stringify(report).includes('relative'), false)
  }
})

test('prefix decoder rejects duplicate skipped reordered unknown and trailing frames', () => {
  for (const value of [
    'ENTRY\nENTRY\n',
    'ENTRY\nPATH_BEGIN\n',
    'VERSION_OK\nENTRY\n',
    stream(phases.length) + 'UNKNOWN\n',
    stream(phases.length) + '\n',
    stream(phases.length) + 'x',
    stream(phases.length) + stream(phases.length),
    stream(3) + 'PATH_RE',
    'ENTRY\r\n',
    ' entry\n',
    'ENTRY',
    ' '.repeat(4097),
    Buffer.from(stream(phases.length)),
    null,
    undefined,
    false,
    0,
    { value: stream(phases.length) },
    {
      toString() {
        throw Error('must_not_coerce')
      },
    },
  ])
    assert.deepEqual(decodeDiagnosticPrefix(value), {
      valid: false,
      phase: 'NONE',
      completed: false,
    })
})

test('decoder never invokes getters or coerces arbitrary objects', () => {
  let accessed = false
  const value = {
    get stdout() {
      accessed = true
      throw Error('private-marker')
    },
  }
  assert.equal(decodeDiagnosticPrefix(value).valid, false)
  assert.equal(accessed, false)
})

test('one synchronous owned child reports only its own complete fixed frame', () => {
  let calls = 0
  const report = runDiagnostic(input, (file, args, options) => {
    calls++
    assert.deepEqual({ file, args, options }, buildDiagnosticInvocation(input))
    return stream(phases.length)
  })
  assert.equal(calls, 1)
  assert.equal(report.classification, 'diagnostic_completed')
  assert.equal(report.phase, 'PARSER_RETURNED')
  assert.equal(report.windows11Acceptance, false)
  assert.equal(report.nativeAdmission, false)
})

test('timeout preserves a closed prefix without changing failure or running another child', () => {
  let calls = 0
  const error = Object.assign(Error('private-marker'), {
    code: 'ETIMEDOUT',
    status: null,
    stdout: stream(phases.indexOf('PARSER_BEGIN') + 1),
    stderr: 'private-marker',
    cmd: 'private-marker',
    cause: { value: 'private-marker' },
  })
  const report = runDiagnostic(input, () => {
    calls++
    throw error
  })
  assert.equal(calls, 1)
  assert.equal(report.classification, 'diagnostic_exec_failed')
  assert.equal(report.phase, 'PARSER_BEGIN')
  assert.equal(report.code, 'ETIMEDOUT')
  assert.equal(report.statusBucket, 'null')
  assert.equal(report.stderrBytes, 14)
  assert.equal(JSON.stringify(report).includes('private-marker'), false)
})

test('even a complete frame cannot turn a timed out or nonzero child into completion', () => {
  for (const error of [
    { code: 'ETIMEDOUT', status: null, stdout: stream(phases.length) },
    { code: 'OTHER', status: 1, stdout: stream(phases.length) },
  ]) {
    const report = runDiagnostic(input, () => {
      throw error
    })
    assert.equal(report.classification, 'diagnostic_exec_failed')
    assert.equal(report.nativeAdmission, false)
  }
})

test('unknown error values and raw stdout cannot escape the closed projection', () => {
  const marker = 'private-marker'
  const report = runDiagnostic(input, () => {
    throw {
      code: marker,
      status: marker,
      stdout: marker,
      stderr: marker,
      message: marker,
      cmd: marker,
      stack: marker,
      cause: { value: marker },
    }
  })
  assert.equal(report.code, 'OTHER')
  assert.equal(report.statusBucket, 'other')
  assert.equal(report.phase, 'NONE')
  assert.equal(report.prefixValid, false)
  assert.equal(JSON.stringify(report).includes(marker), false)
  assert.deepEqual(Object.keys(report), [
    'object',
    'classification',
    'phase',
    'prefixValid',
    'code',
    'statusBucket',
    'stdoutType',
    'stdoutBytes',
    'stderrBytes',
    'nativeAdmission',
    'windows11Acceptance',
  ])
})

test('accessor and inherited metadata are rejected without executing getters', () => {
  let called = false
  for (const error of [
    {
      get stdout() {
        called = true
        throw Error('private-marker')
      },
    },
    Object.create({
      stdout: stream(phases.length),
      code: 'ETIMEDOUT',
      status: null,
    }),
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw Error('private-marker')
        },
      },
    ),
  ]) {
    const report = runDiagnostic(input, () => {
      throw error
    })
    assert.equal(report.phase, 'NONE')
    assert.equal(report.prefixValid, false)
    assert.equal(JSON.stringify(report).includes('private-marker'), false)
  }
  assert.equal(called, false)
})

test('Buffer output is counted but rejected and overbound output is not accepted', () => {
  for (const stdout of [Buffer.from(stream(phases.length)), 'x'.repeat(4097)]) {
    const report = runDiagnostic(input, () => {
      throw { stdout, status: 1 }
    })
    assert.equal(report.prefixValid, false)
    assert.equal(report.phase, 'NONE')
  }
})

test('hostile captured value objects cannot throw or expose raw metadata', () => {
  const value = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw Error('private-marker')
      },
    },
  )
  const report = runDiagnostic(input, () => {
    throw { stdout: value, stderr: value }
  })
  assert.equal(report.phase, 'NONE')
  assert.equal(report.prefixValid, false)
  assert.equal(report.stdoutBytes, null)
  assert.equal(report.stderrBytes, null)
  assert.equal(JSON.stringify(report).includes('private-marker'), false)
})

test('Buffer byte counts do not execute an attacker supplied length accessor', () => {
  let accessed = false
  const stdout = Buffer.from(stream(2))
  const expectedBytes = stdout.length
  Object.defineProperty(stdout, 'length', {
    get() {
      accessed = true
      throw Error('private-marker')
    },
  })
  const report = runDiagnostic(input, () => {
    throw { stdout, status: 1 }
  })
  assert.equal(accessed, false)
  assert.equal(report.stdoutBytes, expectedBytes)
  assert.equal(report.prefixValid, false)
})

test('workflow diagnostic is isolated after the original failure and preserves Finish and native gates', async () => {
  let workflow
  try {
    workflow = await readFile(
      new URL('./hosted-windows-native.yml', import.meta.url),
      'utf8',
    )
  } catch {
    workflow = await readFile(
      new URL(
        '../../.github/workflows/hosted-windows-native.yml',
        import.meta.url,
      ),
      'utf8',
    )
  }
  assert.match(
    workflow,
    /name: Check source policy tests\n\s+id: source_policy_tests\n\s+run: node --test "\$env:PACKET\/preflight.node-check.mjs"/,
  )
  assert.match(
    workflow,
    /name: Diagnose only the failed public parser child\n\s+if: failure\(\) && steps\.source_policy_tests\.outcome == 'failure' && steps\.diagnostic_policy_tests\.outcome == 'success'\n\s+run: node "\$env:PACKET\/parser-diagnostic.mjs"/,
  )
  assert.doesNotMatch(
    workflow,
    /continue-on-error|always\(\).*parser-diagnostic/,
  )
  assert.match(
    workflow,
    /name: Probe finite hosted Server pre-auth capabilities\n\s+timeout-minutes: 5/,
  )
  assert.match(
    workflow,
    /name: Independently finish exact owned cleanup\n\s+if: always\(\)\n\s+timeout-minutes: 2/,
  )
  assert.match(workflow, /runs-on: windows-2025\n\s+timeout-minutes: 15/)
  const original = workflow
    .replace('        id: source_policy_tests\n', '')
    .replace(
      / {6}- name: Check independent diagnostic policy tests\n[\s\S]*?(?= {6}- name: Probe finite hosted Server pre-auth capabilities\n)/,
      '',
    )
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    '94f260ab9c1dc82d0247e06e829ac78b3e767f0c37ff6ca7e11c99b441f8f702',
  )
})

test('all frozen09 source inputs remain exact after reversing only the two SOURCE12 fixed-path compositions', async () => {
  const parent = [
    [
      'preflight.ps1',
      15912,
      'a2b7b0466078e1a5e6de099c5f1ffa460a214c38dee866fff8c31401a388ca09',
    ],
    [
      'preflight.mjs',
      8348,
      '982e5c77b8adeff6ca0199eaa475fe87a1e79a7ef8d443f9a2e556e3dfbcfb7a',
    ],
    [
      'preflight-policy.mjs',
      6837,
      'b0630b569c3ea3ee100b4f136a7776baf9e2b9df6f88e41e19683c64add32c0d',
    ],
    [
      'preflight.node-check.mjs',
      20035,
      'e06045bd6204653bf605638f87cb44ee00e40db33d667590cc73669d06612ebc',
    ],
    [
      'preauth-native.cs',
      3810,
      'f901a2fc61e4f0898220081abdbf6ca7cb8e82592e3662f9eec8a77e8f938f3d',
    ],
    [
      'windows-native.cs',
      10394,
      '58e4cc2b906b1df1d43c7e0b640725e68b8af110354773fa4fc8648e0a48492d',
    ],
    [
      'windows-helper.ps1',
      3954,
      '2fc50c70a2eec24fabc363cafa481338b08bcede0d79191ef9b6a1f2847dc2ef',
    ],
    [
      'windows.mjs',
      6461,
      'ff2d2b37621a9845b86d5d32f48339e27c0a0842026eea8a8f3b2c1a02733275',
    ],
    [
      'cdp.mjs',
      4832,
      '4347920fa5a7e8ca54330263f05a372774c08ae9d6eaaec27c39ad4690e0fe84',
    ],
    [
      'policy.mjs',
      8131,
      '48cedfe91769438e7616793b6b5f1100013f2ba6532b98396626954e74a2c8a6',
    ],
    [
      'desktop-payload-manifest.json',
      16982,
      '3b49f1f5db161f66901c378e0a7322575345bc8ab857f3eeda94177733915c3f',
    ],
    [
      'company-source-manifest.json',
      24136,
      '1a380f6818bed69e8e15b1f4091225a7d2b45ae7cd90868528c4f5d25c0cab3d',
    ],
  ]
  for (const [source, bytes, sha256] of parent) {
    let raw = await readFile(new URL(`./${source}`, import.meta.url))
    if (source === 'preflight.ps1')
      raw = Buffer.from(
        raw
          .toString('utf8')
          .replace(
            "([IO.Path]::Combine($root,'desktop-payload-manifest.json'))",
            "(Join-Path $root 'desktop-payload-manifest.json')",
          ),
      )
    if (source === 'preflight.node-check.mjs')
      raw = Buffer.from(
        raw
          .toString('utf8')
          .replace(
            "([IO.Path]::Combine($root,'preflight.ps1'))",
            "(Join-Path $root 'preflight.ps1')",
          ),
      )
    assert.equal(raw.length, bytes)
    assert.equal(createHash('sha256').update(raw).digest('hex'), sha256)
  }
})
