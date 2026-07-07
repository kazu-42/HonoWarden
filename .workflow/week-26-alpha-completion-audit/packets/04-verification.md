Packet ID: 04-verification
Objective: Verify audit behavior and external state.
Context: Current real release state is draft-ready.
Files / sources:

- Local test output
- Completion audit output
- GitHub Release readback
  Ownership: main
  Do:
- Run focused tests, docs tests, release gate, status packet, completion audit,
  workflow verifier, full local checks, and brand scan.
- Confirm strict completion audit fails before publication.
- Push, watch CI, and read back GitHub Release state.
  Do not:
- Publish the release or deploy.
  Expected output: passing local and CI evidence plus unchanged draft state.
  Verification: CI success after push.
