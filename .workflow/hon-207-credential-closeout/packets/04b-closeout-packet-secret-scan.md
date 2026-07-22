# EVIDENCE-1B: Canonical Closeout Packet And Secret Scan

Linear issue: HON-228

## Objective

Generate one deterministic credential-closeout packet from the validated
registry and fail closed when any owned input or output contains secret-bearing
material.

## Ownership

- deterministic packet generator and canonical serialization
- exact registry/artifact/source digest binding
- allowlisted packet fields
- password, token, key, encrypted-body, identity, provider-payload, profile,
  and secret-like field rejection
- stale, extra, symlinked, non-regular, missing, untracked, and path-escaping
  input rejection

## Dependency

HON-227 must be merged, verified on exact main, Done, and archived.

## Exit Gate

Two runs over identical approved inputs produce byte-identical output and all
positive leak fixtures fail without reflecting the rejected value.
