# Week 23 Orchestration

## Goal

Prove user isolation and disabled-user rejection through focused local evidence.

## Sequence

1. Inspect existing auth, sync, repository, and FakeD1 behavior.
2. Add failing HTTP tests for multi-user sync and disabled auth flows.
3. Improve FakeD1 only enough to make those tests meaningful.
4. Update current-state and workflow evidence.
5. Run narrow app tests, then full local gates and brand scans.
6. Push, wait for CI, and record evidence.

## Sidecar QA

A Spark xhigh explorer reviews isolation and disabled-user coverage while the
main thread implements the narrow test/support slice.

## Verification Policy

Do not count a test as isolation evidence unless the fake backing data includes
both users' rows and the request returns only the authenticated user's rows.
