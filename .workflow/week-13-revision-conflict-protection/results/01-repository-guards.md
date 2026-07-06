# Packet 01 Result: Repository Guards

Accepted:

- Folder and cipher update inputs now include an expected current revision.
- Update SQL now requires owner scope, active row state, and matching `revision_date`.
- Failed guarded updates perform one owner-scoped active-row revision lookup.
- Repository results now distinguish `updated`, `not_found`, and `conflict`.

Verification:

- Targeted repository tests passed.
- `pnpm check` passed after Result types were integrated.

Remaining risks:

- Delete and restore revision guards are deferred; this packet intentionally covered update routes only.
