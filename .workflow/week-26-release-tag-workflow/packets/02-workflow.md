# Packet 02: Workflow

## Objective

Add GitHub Actions verification for the alpha tag push event.

## Contract

- Run on `v0.1.0-alpha` tag pushes.
- Use `actions/checkout` with full history.
- Run typecheck, lint, tests, compatibility fixtures, strict release gate, tag
  preflight, brand scan, and format check.
- Keep permissions read-only.
