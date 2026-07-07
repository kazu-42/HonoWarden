Packet ID: 03-verification
Objective: Verify the runbook and release state without external mutation.
Context: The change is docs/tests/gate only.
Files / sources:

- Local test output
- Release gate output
- Release status packet output
- GitHub Release readback
  Ownership: main
  Do:
- Run targeted release docs and gate tests.
- Run strict release gate and status packet.
- Run workflow verifier, full local checks, and brand scan.
- Push, watch CI, and read back GitHub Release draft state.
  Do not:
- Publish, deploy, mutate tags, DNS, email routing, secrets, or Cloudflare
  resources.
  Expected output: passing local and CI evidence plus unchanged draft state.
  Verification: CI success after push.
