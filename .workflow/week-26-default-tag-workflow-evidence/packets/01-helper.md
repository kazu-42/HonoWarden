# Packet ID: 01-helper

Objective:

Create a small helper that resolves missing release tag workflow evidence from
committed workflow state.

Ownership:

- `scripts/honowarden-tag-workflow-evidence.mjs`

Do:

- Preserve explicit non-empty CLI values.
- Read `.workflow/week-26-release-tag-recovery/state.json`.
- Fill missing `tagWorkflowRunId`, `tagWorkflowUrl`, and `tagWorkflowHeadSha`
  from the passed `Release Tag Verification` check.

Do not:

- Call GitHub, git, Cloudflare, email, or any external write.
- Edit packet scripts or tests in this packet.

Status:

completed by Spark, integrated by main.
