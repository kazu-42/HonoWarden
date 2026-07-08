# Week 26 Website Live Evidence Final Report

## Outcome

Website live evidence is recorded and verified for `v0.1.0-alpha`.

## Accepted

- Website PR #1 merged after local checks, Codex review, and GitHub CI.
- Cloudflare Worker version `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91` is live on
  `honowarden.com` and `www.honowarden.com`.
- Public links point to the published GitHub Release and repository security
  policy.
- Active email/security metadata remains hidden until Email Routing is verified.

## Verification

- `pnpm exec vitest run test/release-docs.test.ts test/ops/ops-readiness-packet.test.ts`
- `pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- Cloudflare deployment and version readback
- live HTTPS smoke for apex and `www`

## Remaining Risks

- Email Routing scopes, destination verification, route creation, and inbound
  smoke evidence are still missing.
- Overall rollback evidence remains `partial` until API safe-target selection,
  Email Routing rollback handling, and a rollback rehearsal or actual rollback
  are recorded.
- Website rollback commands are recorded with `--name honowarden-website` so
  they do not accidentally resolve to the API Worker when copied from this
  repository.
