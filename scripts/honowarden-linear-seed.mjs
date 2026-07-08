#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { error as logError, log } from 'node:console'
import process from 'node:process'

const defaultSeedPath = 'ops/linear/honowarden.seed.json'
const allowedStateTypes = new Set([
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
])

async function main(argv = process.argv.slice(2)) {
  const seedPath = argv[0] ?? defaultSeedPath
  const seed = JSON.parse(await readFile(seedPath, 'utf8'))
  const result = validateSeed(seed)

  if (result.errors.length > 0) {
    for (const message of result.errors) {
      logError(message)
    }

    process.exitCode = 1
    return
  }

  log(JSON.stringify(result.summary, null, 2))
}

function validateSeed(seed) {
  const errors = []

  requireString(errors, seed.workspaceSlug, 'workspaceSlug')
  requireString(errors, seed.team?.key, 'team.key')
  requireString(errors, seed.team?.name, 'team.name')
  requireString(errors, seed.initiative?.name, 'initiative.name')

  const labels = arrayField(seed, 'labels', errors)
  const projects = arrayField(seed, 'projects', errors)
  const milestones = arrayField(seed, 'milestones', errors)
  const issues = arrayField(seed, 'issues', errors)
  const views = arrayField(seed, 'views', errors)

  const labelNames = collectUnique(errors, labels, 'labels', 'name')
  const projectKeys = collectUnique(errors, projects, 'projects', 'key')
  const projectNames = collectUnique(errors, projects, 'projects', 'name')
  const milestoneNames = collectUnique(errors, milestones, 'milestones', 'name')
  const issueKeys = collectUnique(errors, issues, 'issues', 'key')

  for (const project of projects) {
    requireString(errors, project.name, `projects.${project.key}.name`)
    requireString(errors, project.summary, `projects.${project.key}.summary`)
    assertKnownLabels(errors, project.labels ?? [], labelNames, project.name)
  }

  for (const milestone of milestones) {
    if (!projectKeys.has(milestone.projectKey)) {
      errors.push(
        `milestone "${milestone.name}" references unknown projectKey "${milestone.projectKey}"`,
      )
    }
  }

  for (const issue of issues) {
    requireString(errors, issue.title, `issues.${issue.key}.title`)
    requireString(errors, issue.description, `issues.${issue.key}.description`)
    requireStateType(errors, issue.stateType, `issues.${issue.key}.stateType`)

    if (!projectKeys.has(issue.projectKey)) {
      errors.push(
        `issue "${issue.key}" references unknown projectKey "${issue.projectKey}"`,
      )
    }

    if (issue.milestone && !milestoneNames.has(issue.milestone)) {
      errors.push(
        `issue "${issue.key}" references unknown milestone "${issue.milestone}"`,
      )
    }

    assertKnownLabels(errors, issue.labels ?? [], labelNames, issue.key)

    for (const blockedBy of issue.blockedBy ?? []) {
      if (!issueKeys.has(blockedBy)) {
        errors.push(
          `issue "${issue.key}" is blocked by unknown issue key "${blockedBy}"`,
        )
      }
    }
  }

  for (const view of views) {
    requireString(errors, view.name, 'views.name')
    assertKnownLabels(errors, view.filters?.label ?? [], labelNames, view.name)
    assertKnownLabels(
      errors,
      view.filters?.labelAny ?? [],
      labelNames,
      view.name,
    )

    for (const projectName of view.filters?.project ?? []) {
      if (!projectNames.has(projectName)) {
        errors.push(
          `view "${view.name}" references unknown project "${projectName}"`,
        )
      }
    }
  }

  for (const document of seed.documents ?? []) {
    if (!projectKeys.has(document.projectKey)) {
      errors.push(
        `document "${document.title}" references unknown projectKey "${document.projectKey}"`,
      )
    }
  }

  if (
    seed.pulse?.firstUpdate?.projectKey &&
    !projectKeys.has(seed.pulse.firstUpdate.projectKey)
  ) {
    errors.push(
      `pulse firstUpdate references unknown projectKey "${seed.pulse.firstUpdate.projectKey}"`,
    )
  }

  return {
    errors,
    summary: {
      workspaceSlug: seed.workspaceSlug,
      team: seed.team,
      initiative: seed.initiative?.name,
      counts: {
        labels: labels.length,
        projects: projects.length,
        milestones: milestones.length,
        issues: issues.length,
        views: views.length,
        documents: (seed.documents ?? []).length,
      },
      issueStateCounts: issueStateCounts(issues),
      pulse: {
        workspaceDefaultCadence: seed.pulse?.workspaceDefaultCadence,
        projectUpdateReminder: seed.pulse?.projectUpdateReminder,
      },
    },
  }
}

function issueStateCounts(issues) {
  const counts = Object.fromEntries(
    [...allowedStateTypes].map((stateType) => [stateType, 0]),
  )

  for (const issue of issues) {
    if (allowedStateTypes.has(issue.stateType)) {
      counts[issue.stateType] += 1
    }
  }

  return counts
}

function requireStateType(errors, value, field) {
  if (!allowedStateTypes.has(value)) {
    errors.push(`${field} must be one of ${[...allowedStateTypes].join(', ')}`)
  }
}

function arrayField(seed, field, errors) {
  if (!Array.isArray(seed[field])) {
    errors.push(`${field} must be an array`)
    return []
  }

  return seed[field]
}

function collectUnique(errors, items, collectionName, fieldName) {
  const values = new Set()

  for (const item of items) {
    const value = item[fieldName]

    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`${collectionName} contains an item without ${fieldName}`)
      continue
    }

    if (values.has(value)) {
      errors.push(
        `${collectionName} contains duplicate ${fieldName} "${value}"`,
      )
      continue
    }

    values.add(value)
  }

  return values
}

function assertKnownLabels(errors, labels, knownLabels, owner) {
  for (const label of labels) {
    if (!knownLabels.has(label)) {
      errors.push(`${owner} references unknown label "${label}"`)
    }
  }
}

function requireString(errors, value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${field} must be a non-empty string`)
  }
}

main().catch((error) => {
  logError(error)
  process.exitCode = 1
})
