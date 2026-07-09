# ADR 0001: Initial Project Scope

## Status

Accepted

## Context

HonoWarden is intended to be a small upstream-compatible API server for personal and small-team vault sync. A full hosted-vault replacement would expand the attack surface and force the project to support features that are not needed for the first use case.

The Web Vault question is intentionally resolved as a scope boundary, not as an
implementation backlog item. Hosting or integrating a browser-delivered vault UI
would add a separate security perimeter: static asset supply chain, browser
session handling, cookie and CSRF policy, content security policy, frontend
release cadence, client-side cryptography review, and rollback/upgrade coupling
between the UI and the API. Those risks are materially different from the
current API-only Worker and require their own design review before code is
added.

## Decision

The initial scope is API-only vault sync for official upstream clients.
HonoWarden will not ship, proxy, or embed a Web Vault, public registration UI,
organization features, or public file-sharing features in the alpha scope. The
public website may document the project, publish security contact metadata, and
receive inquiries, but it must not become a vault UI or authentication surface.

If a Web Vault is reconsidered later, it requires a new ADR before
implementation. That ADR must specify:

- auth and session boundaries, including cookie, CSRF, and token storage rules;
- CSP, static asset provenance, dependency review, and frontend build
  reproducibility;
- deployment and rollback separation from the API Worker;
- compatibility evidence for browser-delivered cryptography and vault sync;
- migration and support boundaries for unsupported organization, Send, and
  public sharing features.

## Consequences

- The implementation can stay focused on the protocol surface needed by official clients.
- Unsupported upstream features must fail explicitly.
- Future scope expansion requires a new ADR and compatibility tests.
- No compatibility matrix row should claim Web Vault support in the alpha
  release.
