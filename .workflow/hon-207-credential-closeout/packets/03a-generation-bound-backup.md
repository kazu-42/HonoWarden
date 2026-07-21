# RECOVERY-1A: Generation-Bound Backup Contract

Linear parent: HON-221

Linear issue: HON-224

## Goal

Export the exact final local credential generation and make restore refuse any
manifest whose content or generation identity differs from the approved input.

## Deliverables

- Extend the backup manifest with an optional, redaction-safe credential
  generation binding.
- Add explicit expected manifest and expected generation SHA-256 gates to
  restore.
- Route local D1 export through an owned temporary Wrangler config so export
  reads the same source persistence as the credential lifecycle. Preserve
  existing generic backup behavior when generation binding is not requested.
- Add focused tests for correct binding, content tampering, historical
  generation input, malformed digests, local source routing, and secret-safe
  evidence.

## Invariants And Failure Modes

- Digest and generation mismatch checks finish before any D1 import or R2 put
  process is spawned.
- The manifest contains labels and hashes only. It cannot contain credentials,
  tokens, encrypted bodies, filesystem secrets, or client profile data.
- Local D1 export must not silently fall back to the repository's ambient
  `.wrangler/state`; the selected source state is explicit and owned.
- Config and persistence paths must be canonical and symlink-free. The selected
  private persistence must carry the credential-lifecycle ownership marker, and
  the run-owned output must be private before any Wrangler process starts.
- Existing unbound scheduled/operator backups remain readable. Restore only
  requires a generation binding when the operator supplies the corresponding
  expectation.

## Exit Gate

Focused tests and a real local export prove that the approved final generation
produces deterministic D1/R2 content hashes. A mismatched manifest hash or
generation hash fails before restore mutation commands execute. The reviewed
exact head is merged, main CI is green, and the Linear child is Done/archived
before `RECOVERY-1B` starts.

## Safety Boundary

Local synthetic state only. No remote D1/R2 mutation, deployment, real
credential, destructive operation, paid action, or third-party contact.
