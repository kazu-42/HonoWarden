Packet ID: 03-verification
Objective: Prove the gate still passes and the release remains approval-gated.
Context: The change strengthens local release readiness checks only.
Files / sources:

- Release gate output
- GitHub Release readback
- Local test output
  Ownership: main
  Do:
- Run targeted release gate tests.
- Run strict release gate.
- Run workflow verifier.
- Run full local checks and repository brand scan before push.
- Push and watch CI, then read back release draft state.
  Do not:
- Publish the GitHub Release or deploy.
  Expected output: passing local and CI evidence plus unchanged draft release
  state.
  Verification: CI success for the pushed commit.
