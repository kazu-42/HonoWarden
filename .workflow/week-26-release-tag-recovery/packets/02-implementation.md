Packet ID: 02-implementation
Objective: Implement a read-only packet for pushed alpha tag recovery.
Files / sources: scripts/honowarden-release-tag-recovery-packet.mjs, package.json
Ownership: scripts

Do:

- Verify local tag context, remote tag object, peeled remote commit, remote main,
  main CI evidence, failed tag workflow evidence, and release absence.
- Emit approval text only when all checks pass.
- Emit a force-with-lease command based on the current remote tag object.

Do not:

- Execute tag, push, delete, release, deploy, DNS, or email mutations.

Expected output:

- pnpm release:tag:recovery

Verification:

- pnpm test
- manual packet run after the commit is clean and CI evidence is available
