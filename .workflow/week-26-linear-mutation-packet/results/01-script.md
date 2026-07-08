Result: completed

Implemented `scripts/honowarden-linear-mutation-packet.mjs`.

Key behavior:

- Requires `--apply-plan <path>`.
- Accepts standalone `--` and `--strict`.
- Emits JSON packets for ready schema v1 apply-plan input.
- Fails closed unless `schemaVersion: 1`, `mode: "plan"`, and
  `status: "ready"` are present.
- Does not read credentials or call network APIs.
- Omits mutation steps and confirmations for blocked input.
- Separates ready operations into mutation candidates, existing confirmations,
  and manual confirmations.
