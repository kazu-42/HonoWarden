# CLI 2026.9.0 Local Synthetic Acceptance

Status: **passed local official-client smoke with item mutation, organization
readback, and accepted-member confirmation**.
Recorded combined run: `2026-10-03T04:47:22.342Z` through
`2026-10-03T04:50:29.522Z`.

This exact unmodified native client completed personal-vault item mutation,
sync, organization/collection/member readback, organization-cipher decryption,
and accepted-member confirmation against a fresh isolated local Worker. The evidence
ceiling is `local_official_client` / scoped `live_smoke`, with no staging or
production claim. Invitation delivery and recipient native-client acceptance
remain separate.
The sealed published-alpha snapshot and earlier September CLI evidence remain
historical records.

## Exact Client and Candidate

- Client: official CLI `2026.9.0`, macOS arm64; release `cli-v2026.9.0`, source
  commit `7ecf0d710cf39db40aa4db1c611417af2a0f44e0`.
- Binary SHA-256:
  `b40c0f110cf88c41954c7be67d15139beb7202cfff8f384af5260f654e94db57`.
- Client asset provenance is retained in
  [the September exact-client record](current-cli-2026-9-smoke.md).
- Candidate source fingerprint:
  `c209903e122ccd291de959753f2768211a9dd31e646668804e075d78a7e2224c`.
- Dependency fingerprint:
  `58e0493615573a03b7c919da6bac33eff59c3028509f8197245a7639d448d884`.
- Installed packages: Hono `4.13.7`, Wrangler `4.112.0`, Miniflare
  `4.20260714.0`, Vitest `4.1.11`; host Node `v26.10.0`.

The source fingerprint length-frames the sorted path and bytes of 160 files:
all files under `src`, `migrations`, and `scripts`, plus `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `wrangler.jsonc`. The dependency
fingerprint includes the lockfile and installed package manifests listed above.
Both fingerprints were identical before and after the run. These identify the
uncommitted local candidate checkpoint; they do not prove deployed bytes or
replace CI and independent review. This document was added after execution and
is outside that runtime fingerprint.

## Passing Assertions

The run asserted command exit status, zero native CLI stderr, actual forced
sync, and exact decrypted values. All **14 recorded checks** passed, with
**44 HTTP requests: 43 status 200 and one status 201**. Grouped personal-vault
assertions were:

1. Password login and exactly one successful user-key-ID backfill.
2. Populated personal sync with name, notes, username, password, and URI equality.
3. Create a new synthetic login item; force sync and require it in the active
   view, absent from trash, with all five decrypted fields equal to expectations.
4. Edit all five fields; force sync and require the new values through list and
   direct decrypted readback.
5. Soft delete; force sync and require absence from active items, presence in
   trash, a deletion timestamp, and the same decrypted values.
6. Restore; force sync and require active presence, trash absence, and unchanged
   decrypted fields.
7. Soft delete again, then permanently delete; after forced sync require absence
   from both active and trash views.
8. Preserve an unrelated opaque R2 sentinel across all item mutations: exact key
   set and SHA-256 of its body match before and after. The public R2 binding
   returns one complete key set with no truncation or continuation cursor.
9. Lock, password unlock, forced sync, and exact readback of the original seeded
   item.
10. Logout and unauthenticated status; another login/sync/decrypted readback
    without repeating key-ID registration; another logout/unauthenticated status.
11. Stop both run-owned local Workers and the TLS proxy, and verify unchanged
    source and dependency fingerprints.

The organization lane seeded one confirmed owner, one accepted secondary
member, one assigned collection, and one organization cipher. Actual native
`list organizations`, `list collections`, `list org-collections`, and
`list org-members` commands verified IDs, names, roles, and membership status.
The collection name decrypted with the organization key. Native `list items
--organizationid` and `get item` decrypted all five expected fields using the
owner's encrypted private RSA key, RSA-wrapped organization key, and separately
wrapped cipher key. The fixture includes the encrypted URI checksum required
for ciphers with individual keys.

Actual `confirm org-member <memberId> --organizationid <organizationId>` used
the member-details, account-public-key, and confirmation endpoints, all returning 200. Native member readback and a scoped local D1 read both required status 2.
The client produced a Type 4 RSA-OAEP/SHA-1 encrypted organization key. Importing
the fresh secondary private key with that algorithm and decrypting the stored
opaque key returned exactly the original 64 organization-key bytes. Neither key
nor plaintext appears in this record. This proves native producer interoperability
and recipient key usability; the secondary account was not logged in with a
native client. The existing owner, accepted member, and collection were seeded,
so this run does not prove invitation, acceptance, or collection provisioning.

The two R2 checkpoints have the same key-set SHA-256
`e609c4032bedefa8e754231b6f3ed43cb1a74b12843ad28b3e9fbfa3eb54e9be`
and body SHA-256
`6c7e9a901184ae555732ad6e41b65c63ca6321e6932a7ce68fcca28253e9cf61`.
The sentinel is unrelated to the mutated cipher and detects unintended
bucket-wide deletion or changes to unrelated objects. No attachment lifecycle
or actual vault-object compatibility is claimed.

## Reproduction and Isolation

```sh
rtk proxy node scripts/honowarden-current-cli-smoke.mjs plan
rtk proxy node scripts/honowarden-current-cli-smoke.mjs run \
  --execute --confirm current-cli-smoke --organizations
```

The runner requires the declared retained exact binary and prepared historical
crypto-harness inputs under ignored `test/.tmp`; `--binary` and `--crypto-root`
can select equivalent verified local inputs. It performs no download or app
installation. The historical SDK bridge generates only fresh synthetic account
keys and seed ciphertext. Current-client execution evidence comes from the
separately pinned unmodified native 2026.9.0 binary.

Each run has a new mode-0700 root, private mode-0600 logs and configuration,
fresh profile/HOME/TMP, local D1/R2 with the complete migration chain, and
independent loopback ports. TLS validation stays enabled; a run-owned CA is
trusted only by child CLI processes. The local key-ID writer is enabled only in
private run configuration. `--organizations` additionally enables membership
routes only in that private configuration. Omitting it executes the personal
mutation lane. Tracked runtime flags remain default-off.

The R2 helper has a run-owned bearer token and can initialize only the one
predetermined synthetic sentinel in a verified empty local bucket. It exposes
no arbitrary-key/body write API and no remote resource selector. Every local
process is stopped on success, failure, or cancellation. Private diagnostic
state is retained under `test/.tmp/current-cli-smoke-3QqHQl/` and must not be
pasted or committed. Published fields are versions, hashes, counts, safe route
statuses, and assertion booleans.

Boundary regressions passed **6 tests**: substituted binary refusal, symlink
refusal, private profile/trust environment with ambient credentials and TLS
bypasses excluded, stale active/trash visibility rejection, exact decrypted
field checks, and unrelated R2 loss/body changes/incomplete inventory rejection.
Scoped ESLint and Prettier passed before the final native run.

This run used no real account, real secret, normal client profile, device trust
change, remote database, deployment, or external writer. It does not establish
current Browser/Desktop/mobile execution, invitation delivery, recipient native
client execution, full organization management,
MFA/session revocation, credential rotation, restart/restore recovery, or broad
live regression. Those flows require separately scoped acceptance evidence.

## Prior Checkpoints and Fixture Corrections

The personal-only native run at `04:28:24.359Z`–`04:31:27.193Z` passed 12 checks
and 38 HTTP requests (37 status 200, one status 201), with cleanup and unchanged
source fingerprint
`0455a9b84d2528bc48fb6a446dc9d869f70132aa5823c1df2db2a135e9e21fc5`.
Its private root is `test/.tmp/current-cli-smoke-TtyT6O`. The combined run above
uses a later candidate including the reviewed organization protocol fixes and
runner extension; these are distinct runtime checkpoints.

Two bounded organization fixture attempts failed before the final passing run.
`test/.tmp/current-cli-smoke-XwiLnB` had source fingerprint
`a80b368e84693396b374e290a7670bbee53852fa65f4d25ccaec071d333ea259`;
an incorrectly labeled Type 4/SHA-256 seed key caused native SDK organization-key
decapsulation failure. Type 3 is SHA-256 and Type 4 is SHA-1. After correcting the
seed, `test/.tmp/current-cli-smoke-kENrOI` had source fingerprint
`5be8c928f2b4fecdffa5936a596ccf4bf8618c96286d9a082fabaac8f9258e32`;
organization reads and four cipher fields decrypted, but the missing encrypted
URI checksum caused the client to discard the URI and the strict fifth-field
check failed. Both attempts stopped their owned processes and retained identical
before/after fingerprints. They are fixture failures and are not passing
acceptance evidence. Neither failure was hidden by relaxing the assertions.
