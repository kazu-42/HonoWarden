# Result 03: Live Drill

## Accepted

- Derived R2 S3-compatible credentials from the existing D1/R2 scoped token
  without printing values.
- Stored derived R2 credentials and backup archive passphrase in the ignored
  home env file.
- Configured required GitHub Actions secrets by name.
- Remote R2 listing dry-run passed and found zero normal `attachments/` objects.
- Remote D1 export and remote R2 object backup executed with a temporary
  non-secret object.
- Local fresh-target restore executed successfully.
- Restored D1 table count was `13`.
- Restored R2 object checksum matched the backed-up synthetic object.
- Cleanup readback for the temporary production R2 object returned key-not-found.

## Rejected

- No remote disposable Cloudflare restore target was created in this slice.
  Restore stayed local with a fresh `--persist-to` target.
