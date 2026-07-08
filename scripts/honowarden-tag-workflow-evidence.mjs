import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const STATE_PATH = '.workflow/week-26-release-tag-recovery/state.json'
const RELEASE_TAG_VERIFICATION_WORKFLOW = 'Release Tag Verification'

const toNonEmptyString = (value) => {
  if (value === undefined || value === null) {
    return null
  }

  const text = String(value).trim()
  return text === '' ? null : text
}

export function resolveTagWorkflowEvidenceOptions(
  options = {},
  repoRoot = process.cwd(),
) {
  const nextOptions = { ...options }

  if (nextOptions.defaultTagWorkflowEvidence === false) {
    return nextOptions
  }

  const hasTagWorkflowRunId =
    toNonEmptyString(nextOptions.tagWorkflowRunId) !== null
  const hasTagWorkflowUrl =
    toNonEmptyString(nextOptions.tagWorkflowUrl) !== null

  if (hasTagWorkflowRunId || hasTagWorkflowUrl) {
    return nextOptions
  }

  let state
  try {
    const statePath = resolve(repoRoot, STATE_PATH)
    const stateContents = readFileSync(statePath, 'utf8')
    state = JSON.parse(stateContents)
  } catch {
    return nextOptions
  }

  const checks = state?.verification?.checks
  if (!Array.isArray(checks)) {
    return nextOptions
  }

  const releaseTagCheck = checks.find(
    (check) =>
      check?.name === RELEASE_TAG_VERIFICATION_WORKFLOW &&
      check?.status === 'passed' &&
      toNonEmptyString(check?.run) !== null,
  )

  if (!releaseTagCheck) {
    return nextOptions
  }

  const tagWorkflowRunId = toNonEmptyString(releaseTagCheck.run)
  const tagWorkflowUrl = toNonEmptyString(releaseTagCheck.url)
  const tagWorkflowHeadSha = toNonEmptyString(releaseTagCheck.headSha)

  if (!hasTagWorkflowRunId && tagWorkflowRunId !== null) {
    nextOptions.tagWorkflowRunId = tagWorkflowRunId
  }

  if (!hasTagWorkflowUrl && tagWorkflowUrl !== null) {
    nextOptions.tagWorkflowUrl = tagWorkflowUrl
  }

  if (
    toNonEmptyString(nextOptions.tagWorkflowHeadSha) === null &&
    tagWorkflowHeadSha !== null
  ) {
    nextOptions.tagWorkflowHeadSha = tagWorkflowHeadSha
  }

  return nextOptions
}
