# Result 04: Linear Decomposition

Status: accepted and applied.

## Managed Children

| Key       | Linear  | Title                                                                 | Blocked by       |
| --------- | ------- | --------------------------------------------------------------------- | ---------------- |
| `AUTH-4A` | HON-208 | WebAuthn A4.1: protocol, RP/origin, and recovery contract             | none             |
| `AUTH-4B` | HON-209 | WebAuthn A4.2: D1 credential/challenge state and verifier core        | HON-208          |
| `AUTH-4C` | HON-210 | WebAuthn A4.3: authenticated enrollment and credential inventory      | HON-209          |
| `AUTH-4D` | HON-211 | WebAuthn A4.4: assertion grant, device session, and PRF Vault unlock  | HON-209          |
| `AUTH-4E` | HON-212 | WebAuthn A4.5: PRF enablement, rename, delete, and session revocation | HON-210, HON-211 |
| `AUTH-4F` | HON-213 | WebAuthn A4.6: default-off compatibility and rollback gate            | HON-212          |
| `AUTH-4G` | HON-214 | WebAuthn A4.7: staged authenticator evidence and capability promotion | HON-213          |

HON-162 moved from Backlog to In Progress. Every child is priority 0, Todo,
non-archived, under HON-162 and `HonoWarden Post-Alpha Roadmap`.

## Directed Relations

- HON-208 blocks HON-209.
- HON-209 blocks HON-210 and HON-211.
- HON-210 and HON-211 block HON-212.
- HON-212 blocks HON-213.
- HON-213 blocks HON-214.

The graph has seven required relations, no cycle, no reverse relation, no
duplicate, and no unexpected active relation touching a managed child.

## Verification

- Local plan tests: 4 passed, 0 failed.
- Guarded Linear apply: exact at `2026-07-18T18:47:05.922Z`.
- Independent direct readback: exact at `2026-07-18T18:47:12.588Z`.
- Parent title, description byte count/SHA-256, project, state, priority, and
  archive invariants passed.
- All seven child marker identity, title identity, exact description byte
  count/SHA-256, parent, project, Todo state, priority, and archive invariants
  passed.
- Inventory after apply: 214 total, 109 archived, 100 active unarchived, and 5
  completed unarchived. The seven new children remain below the 250-issue cap;
  no archive sweep was required.

Canonical evidence is in `results/hon-162-linear-readback.json`; the separate
query implementation wrote
`results/hon-162-linear-independent-readback.json`.
