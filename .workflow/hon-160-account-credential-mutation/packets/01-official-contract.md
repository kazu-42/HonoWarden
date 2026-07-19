# Packet 01: Pinned official credential contract

## Objective

Map the observable existing-account password, KDF, key, and security-stamp
contract from pinned official public source without copying UI expression.

## Sources

- Official server repository `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.
- Official clients repository `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1`.

## Do

- Map route, request fields, response envelope, KDF ranges, current-secret
  proof, salt/KDF agreement, security-stamp behavior, and logout expectation.
- Separate existing-password update, KDF update, initial keypair, and full
  user-key rotation.
- Record exact source paths and pinned revisions. Provider-identifying links
  remain outside tracked source under the repository brand policy.

## Do Not

- Do not copy UI, copy, branding, assets, or private behavior.
- Do not infer a supported HonoWarden capability from an upstream route alone.

## Output

`results/01-official-contract.md`

## Verification

Every claimed field or invariant must map to a pinned revision and source path.
