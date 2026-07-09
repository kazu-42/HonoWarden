# Packet 03: Live Drill

## Objective

Run a live remote backup drill without using real vault secrets.

## Scope

- ignored `test/.tmp/hon-43-live-drill-20260709T201114Z/**`
- temporary production R2 object under a synthetic HON-43 key
- GitHub repository secret names for the scheduled workflow

## Acceptance

- Remote R2 listing credential path works.
- Remote D1 export executes.
- Remote R2 object backup executes with non-secret synthetic data.
- Restore into a fresh local target succeeds.
- D1 readback and R2 checksum verification pass.
- Temporary production R2 object is deleted and deletion is read back.
