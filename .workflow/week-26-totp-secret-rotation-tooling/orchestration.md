# Orchestration

1. Read HON-44 and existing TOTP envelope/runtime paths.
2. Add tests for dry-run, missing secrets, corrupt envelope, guarded execute,
   and force re-enrollment.
3. Implement the CLI and package script.
4. Update operator/security/current-state docs and env placeholders.
5. Verify focused tests, then full repository gates.
6. Publish PR, wait for CI, merge, and close HON-44.

No live secret rotation, deploy, Wrangler secret write, or production mutation
belongs to this packet.
