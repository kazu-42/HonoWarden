# ADR 0001: Initial Project Scope

## Status

Accepted

## Context

HonoWarden is intended to be a small upstream-compatible API server for personal and small-team vault sync. A full hosted-vault replacement would expand the attack surface and force the project to support features that are not needed for the first use case.

## Decision

The initial scope is API-only vault sync for official upstream clients. HonoWarden will not ship a Web Vault, public registration, organization features, or public file-sharing features in the first milestones.

## Consequences

- The implementation can stay focused on the protocol surface needed by official clients.
- Unsupported upstream features must fail explicitly.
- Future scope expansion requires a new ADR and compatibility tests.
