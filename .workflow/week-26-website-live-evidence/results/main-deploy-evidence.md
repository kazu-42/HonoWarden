# Result: main-deploy-evidence

Status: completed.

Website repository result:

- PR: `https://github.com/kazu-42/HonoWarden-website/pull/1`
- CI: `https://github.com/kazu-42/HonoWarden-website/actions/runs/28912678963`
- Merge commit: `36b8171f7afd55bf306e5482cca454a0b3822a39`

Cloudflare result:

- Account: `gHive`
- Worker: `honowarden-website`
- Deployment: `0f398ae5-6d01-42a8-bbe4-35378661ce81`
- Version: `eef4ab71-d6e8-401f-93c3-27e7bd2bcd91`
- Previous version: `3db432cb-6422-4311-b558-6eb2b0b5bb51`

Evidence result:

- `docs/release/website-live-evidence.md` records `Status: passed`
- apex and `www` root and `/health` live smoke passed
- release notes and security policy links are present
- unverified `security@honowarden.com`, `mailto:`, and `security.txt` metadata
  remain absent
- ops readiness now blocks on `email_local_inputs_missing`, not
  `website_live_evidence_missing`
