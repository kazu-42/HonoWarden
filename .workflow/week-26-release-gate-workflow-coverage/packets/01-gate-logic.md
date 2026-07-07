# Packet 01: Gate Logic

## Objective

Expand the release gate workflow evidence list and support existing state-file
formats.

## Contract

- Include completed Week 26 release, tag, ops, live-client, and device workflows.
- Accept CI evidence stored as `GitHub Actions CI run ...` strings.
- Accept CI evidence stored as structured objects with `name`, `status`, and
  `run`.
- Do not include this current workflow to avoid self-referential CI evidence.
