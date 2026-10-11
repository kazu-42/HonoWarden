# Build provenance and deployment authority

Status: **REAL WORKER/VERSION/TRAFFIC WRITE STOP**.

HonoWarden retains runtime build-provenance reporting, but this repository does
not currently provide an executable Worker upload, activation, first-bootstrap,
code-rollback, deploy dry-run, or automated traffic-recovery protocol.

## Current executable contract

The public package entrypoints `deploy` and `staging:dry-run` are shell-builtin
blockers. They return one fixed non-zero result for every argument shape before
starting Node, Git, a package-manager child, Wrangler, or any network transport.
The legacy direct JavaScript paths are retained only as defense-in-depth
tombstones and return the same STOP.

The blockers:

- do not inspect credentials, account selectors, endpoints, proxy settings, or
  forwarded arguments;
- do not create a deploy lock, temporary config, machine-output file, version,
  deployment, or traffic change;
- do not read Git state or infer an approved source revision;
- do not perform a local or remote deploy dry-run;
- do not implement automatic or manual recovery.

Do not provide Cloudflare credentials to these entrypoints. Credential
availability and operator approval cannot turn a static blocker into an
execution protocol. Direct Wrangler use is not an approved bypass.

## Runtime provenance contract

The Worker runtime still resolves one consistent build identity for:

- `GET /health`
- `GET /healthz`
- `GET /api/config`
- `GET /config`

The public response schema distinguishes the opaque `workerVersionId` from
`build.gitSha`. `CF_VERSION_METADATA.tag` is a config-bound claimed source SHA
supplied by an external deployment configuration. Runtime validation does not
cryptographically bind the deployed Worker bytes to that Git tree. The value is
therefore a well-formed claim to cross-check against external build and platform
evidence, not a standalone attestation.

In every environment:

- `HONOWARDEN_ENV` must be present and exactly `development`, `staging`, or
  `production`; a missing, empty, or unknown value is a secret-safe `503`;
- local execution remains usable only when the tracked top-level Wrangler
  configuration or a direct test fixture supplies `development` explicitly.

In staging and production:

- `build.gitSha` must be the exact lowercase, non-zero, 40-character claimed
  Git commit from `CF_VERSION_METADATA.tag`;
- `createdAt` must be a canonical UTC instant;
- `environment` must match the explicit Wrangler environment;
- `/api/config.gitHash` and `/config.gitHash` must equal
  `build.gitSha`;
- missing or malformed version metadata is a secret-safe `503`, not a
  development fallback.

`GET /health/db` remains the independent database-health surface. Provenance
success does not imply migration, binding, route, cron, secret, or data health.

## Post-deployment acceptance ceiling

These checks describe acceptance after a separately authorized external
deployment. They do not authorize one. Acceptance needs an external build/deploy
record plus independent version and traffic readback; the metadata tag alone
cannot establish source-to-byte provenance.

GO requires all of the following on the same target and observed version:

1. exact traffic/deployment identity readback;
2. an independently captured build/deploy record binding the reviewed source
   SHA and immutable build inputs/output digest to the observed Worker version;
3. `/health` and `/healthz` with matching environment, version ID,
   `createdAt`, and claimed `build.gitSha`;
4. `/api/config.gitHash` equal to that same SHA;
5. `/health/db` green against the intended database;
6. an authorized synthetic login/sync smoke;
7. explicit confirmation that route, binding, migration, cron, observability,
   tag, tail-consumer, and other non-versioned settings match the reviewed
   intent.

Anything else is STOP. Command exit status alone is never provenance or
recovery evidence.

## Admission requirements for a future remote-write protocol

Any future remote-write protocol needs a separate design and independent
review. At minimum it must provide:

- a trusted executable and closed credential/environment boundary;
- exact account, environment, source, config, and dependency identity;
- an independently verifiable binding between reviewed source, immutable build
  inputs, built artifact digest, and uploaded Worker version;
- explicit first-Worker bootstrap semantics;
- non-serving upload separated from traffic activation;
- pre/post capture of traffic and every mutable non-versioned setting;
- migration, D1, R2, route, cron, tag, logpush, observability, preview, and
  tail-consumer compatibility checks;
- a cross-checkout and cross-operator concurrency policy;
- partial-success classification for every remote write;
- independent recovery proof showing that the protocol will not overwrite
  unexpected remote state;
- staging and production authority as separate, one-shot decisions.

Fake executables or fake machine output are not sufficient evidence for that
boundary. An exact pinned tool characterization, network ceiling, dotenv
isolation, and adversarial source/config tests are also required.

## Failure and recovery

The current blockers make no remote change, so their rollback is simply to
record the STOP and leave remote state untouched. They should leave no lock,
temporary session, output packet, uploaded version, or traffic residue.

If remote state changes while a blocker is being invoked, the change came from
another actor or execution path. Treat that as an incident: stop further writes,
capture current deployment and settings readback, preserve evidence, and obtain
explicit recovery authority. Do not infer that the old removed wrapper can
safely repair it.

Historical deployment evidence documents describe past observations only.
They are not current execution authority and must not be copied into an active
command sequence.
