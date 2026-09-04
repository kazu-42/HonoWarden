# Compatibility Fixtures

Compatibility fixtures capture the minimum upstream-protocol JSON shapes that HonoWarden intends to support.

[`fixture-flows.json`](fixture-flows.json) maps each matrix flow to the fixture
files that prove it. `pnpm compat:test` fails when a matrix row claims a covered
flow that has no fixture file.

Each fixture contains:

- `name`: stable fixture identifier
- `endpoint`: method and path
- `request`: synthetic request metadata
- `response`: expected status and JSON body
- `assertions`: JSON path checks for required response fields

Assertions support object paths, array indexes, exact values, absent fields,
array lengths, minimum array lengths, and `notValue` checks. Fixtures are
intentionally small. They pin fields that official clients need for the initial
scope while allowing unknown additional fields to exist later.

## Credential Closeout Evidence

Credential operation evidence is tracked separately from fixture compatibility
coverage. The canonical registry is
[`credential-evidence.json`](credential-evidence.json), and the verified packet
is [`credential-closeout-packet.json`](credential-closeout-packet.json).

The credential packet records isolated local evidence only. `local_api` means a
local API harness executed the operation, and `local_official_client` means a
pinned unmodified official client read the resulting local generation. These
levels do not claim official-client settings UI coverage, remote account
activation, staging activation, or production activation.

| Evidence level          | Claims |
| ----------------------- | -----: |
| `fixture`               |      0 |
| `local_api`             |      4 |
| `local_official_client` |      7 |
| `staging`               |      0 |
| `production`            |      0 |

Packet limitations:

- The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.
- No claim in this registry proves staging or production activation.

## Credential Operation Inventory

| Claim ID                                         | Operation                        | Execution level | Evidence level          | Representative artifact                                                                                             |
| ------------------------------------------------ | -------------------------------- | --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `account.password.verify.local-api`              | `account.password.verify`        | `local_api`     | `local_api`             | [02-credential-lifecycle.md](../.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md)           |
| `account.password.change.client-readback`        | `account.password.change`        | `local_api`     | `local_official_client` | [02-credential-lifecycle.md](../.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md)           |
| `account.kdf.pbkdf2-to-argon2id.client-readback` | `account.kdf.pbkdf2_to_argon2id` | `local_api`     | `local_official_client` | [02-credential-lifecycle.md](../.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md)           |
| `account.kdf.argon2id-to-pbkdf2.client-readback` | `account.kdf.argon2id_to_pbkdf2` | `local_api`     | `local_official_client` | [02-credential-lifecycle.md](../.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md)           |
| `account.key.initialize.client-readback`         | `account.key.initialize`         | `local_api`     | `local_official_client` | [02-credential-lifecycle.md](../.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md)           |
| `account.key.read.local-api`                     | `account.key.read`               | `local_api`     | `local_api`             | [02-credential-lifecycle.md](../.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md)           |
| `account.user-key.rotate.client-readback`        | `account.user_key.rotate`        | `local_api`     | `local_official_client` | [02-credential-lifecycle.md](../.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md)           |
| `recovery.backup.export.local-api`               | `recovery.backup.export`         | `local_api`     | `local_api`             | [03a-generation-bound-backup.md](../.workflow/hon-207-credential-closeout/results/03a-generation-bound-backup.md)   |
| `recovery.restore.fresh-target.client-readback`  | `recovery.restore.fresh_target`  | `local_api`     | `local_official_client` | [03b-fresh-restore.md](../.workflow/hon-207-credential-closeout/results/03b-fresh-restore.md)                       |
| `recovery.writers.disabled.local-api`            | `recovery.writers.disabled`      | `local_api`     | `local_api`             | [03c-disable-forward-recovery.md](../.workflow/hon-207-credential-closeout/results/03c-disable-forward-recovery.md) |
| `recovery.forward-generation.client-readback`    | `recovery.forward_generation`    | `local_api`     | `local_official_client` | [03c-disable-forward-recovery.md](../.workflow/hon-207-credential-closeout/results/03c-disable-forward-recovery.md) |

The HON-201 route inventory is [`route-inventory.json`](route-inventory.json).
It classifies pinned official surfaces against HonoWarden behavior.
`pnpm compat:inventory` fails CI when a newly observed surface is
unclassified, a support claim is stale, a ROADMAP non-goal has no owner, or a
tracked flag is enabled without evidence. Catalog refresh is a reviewed diff
and does not rewrite classifications. See
[`docs/compatibility-inventory.md`](../docs/compatibility-inventory.md).

Run the fixture suite with:

```sh
pnpm compat:test
pnpm compat:inventory
```
