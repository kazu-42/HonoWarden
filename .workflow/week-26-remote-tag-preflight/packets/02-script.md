# Packet 02: Script

## Objective

Add read-only remote tag absence checks to the alpha tag preflight.

## Contract

- `--check-remote` enables the extra check.
- `--remote <remote>` selects the remote and defaults to `origin`.
- The command uses `git ls-remote --tags`.
- The script never creates, pushes, deletes, or rewrites tags.
