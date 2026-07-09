# Packet 03: Live Smoke And Linear Closeout

## Scope

Verify the hidden production route and close HON-24 only after live readback.

## Accepted Output

- A harmless live email is sent to `inquiry-smoke@honowarden.com`.
- Production D1 records an `inquiry_messages` row for mailbox `inquiry-smoke`.
- Readback proves `raw_storage_state` remains `disabled`.
- No body, attachment, private destination, or mailbox content is copied into
  tracked evidence.
- HonoWarden PR is merged after checks pass.
- Linear HON-24 receives the redacted evidence summary and moves to Done.

## Rejected Output

- Closing HON-24 from local smoke only.
- Pasting message bodies or private mailbox contents into GitHub, docs, Linear,
  or chat.
- Migrating public aliases in the same closeout.

## Verification

- production D1 readback for hidden smoke row
- production no-raw-storage readback
- HonoWarden CI
- Linear state readback
