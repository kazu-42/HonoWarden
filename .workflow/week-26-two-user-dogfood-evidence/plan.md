# Week 26 Two-User Dogfood Evidence Plan

Goal:
Close HON-61 with repository-local, synthetic-only evidence that two-user
personal vault isolation and disabled-user lifecycle denial are covered without
touching real accounts or production vault data.

Success criteria:

- two synthetic users are bootstrapped through the app route;
- each synthetic user can log in and sync only their own synthetic folder and
  cipher rows;
- cross-user reads and mutations are denied;
- disabled-user password grant, refresh grant, sync, and vault CRUD are denied;
- a reusable packet generator records the required dogfood flow coverage;
- docs and release gates make the evidence discoverable while preserving the
  production lifecycle boundary.

Constraints:

- no production DB mutation;
- no real vault data, real passwords, tokens, private keys, mailbox contents, or
  private forwarding destinations in evidence;
- HON-24 remains separate and blocked on external SMTP smoke.

Verification:

- focused app dogfood test;
- packet generator tests;
- typecheck, lint, full tests, release gate, brand scan, and workflow verifier.
