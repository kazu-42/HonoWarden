#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const DEFAULT_ROOT = process.cwd()
const BLOCKED_PATTERN_PARTS = [
  '[Bb]it',
  'warden|BIT',
  'WARDEN|Bit',
  'warden|bit',
  'warden',
]
const BLOCKED_PATTERN = new RegExp(BLOCKED_PATTERN_PARTS.join(''))

function main(argv = process.argv.slice(2)) {
  let root = DEFAULT_ROOT
  const args = [...argv]

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--root') {
      const nextRoot = args.shift()
      if (!nextRoot) {
        process.stderr.write('--root requires a value\n')
        process.exitCode = 2
        return
      }
      root = resolve(nextRoot)
      continue
    }

    if (arg === '--help' || arg === '-h') {
      printUsage()
      return
    }

    if (arg) {
      process.stderr.write(`Unknown option: ${arg}\n`)
      process.exitCode = 2
      return
    }
  }

  let findings
  try {
    findings = scanRepository(root)
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : `${error}`}\n`,
    )
    process.exitCode = 2
    return
  }

  if (findings.length > 0) {
    process.stderr.write(
      `Repository brand scan found ${findings.length} blocked hit(s):\n`,
    )
    for (const hit of findings) {
      process.stderr.write(`  ${hit}\n`)
    }
    process.exitCode = 1
    return
  }
}

function scanRepository(root) {
  const findings = []
  walk(root, root, findings)
  return findings
}

function walk(root, currentPath, findings) {
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const fullPath = join(currentPath, entry.name)
    const repoPath = normalizeRepoPath(relative(root, fullPath))

    if (shouldIgnorePath(repoPath)) {
      continue
    }

    if (entry.isDirectory()) {
      walk(root, fullPath, findings)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (BLOCKED_PATTERN.test(repoPath)) {
      findings.push(`${repoPath}:path`)
      continue
    }

    let content
    try {
      content = readFileSync(fullPath, 'utf8')
    } catch {
      continue
    }

    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      if (BLOCKED_PATTERN.test(lines[index])) {
        findings.push(`${repoPath}:${index + 1}`)
      }
    }
  }
}

function shouldIgnorePath(repoPath) {
  if (repoPath === '') {
    return false
  }

  const normalized = repoPath.replace(/\\/g, '/')
  const segments = normalized.split('/')

  if (segments.includes('node_modules')) {
    return true
  }
  if (segments.includes('dist')) {
    return true
  }
  if (segments.includes('coverage')) {
    return true
  }
  if (segments.includes('.git')) {
    return true
  }

  const ignoredFiles = new Set(['LICENSE', 'pnpm-lock.yaml'])
  const fileName = segments.at(-1) ?? ''
  if (ignoredFiles.has(fileName)) {
    return true
  }

  return normalized === 'test/.tmp' || normalized.startsWith('test/.tmp/')
}

function normalizeRepoPath(value) {
  return value.split(sep).join('/')
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/honowarden-brand-scan.mjs [--root <directory>]
`)
}

main()
