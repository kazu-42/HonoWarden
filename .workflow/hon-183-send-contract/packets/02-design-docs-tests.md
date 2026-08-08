# Packet 02: Design Documents And Tests

## Objective

Create an executable documentation contract for the Send product line before
any stateful route is implemented.

## Acceptance

- Regression test fails before documents exist.
- Replacement ADR decides scope, slices, activation, rollback, and current guard.
- Dedicated threat model covers assets, boundaries, abuse paths, controls,
  residual risks, observability, retention, and incident kill switch.
- Wire contract covers route shapes, token binding, encrypted fields, lifecycle,
  D1/R2 consistency, status/error/cache semantics, and deferred behavior.
- Current runtime/config compatibility assertions remain green.
