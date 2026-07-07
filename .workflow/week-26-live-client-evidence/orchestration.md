# Week 26 Live Client Evidence Orchestration

## Packets

1. Prepare local wrangler dev, migrated local D1, and synthetic account seed.
2. Run the tracked CLI against HonoWarden through a local HTTPS endpoint.
3. Fix protocol incompatibilities found by the live client.
4. Record redacted evidence and promote only the CLI row to `live_smoke`.
5. Update release gate checks so promoted rows require linked evidence.

## Notes

wrangler dev returned gzip chunked HTTPS responses that the tracked CLI HTTP
stack rejected. A local HTTPS proxy was used to remove `Accept-Encoding` while
forwarding request and response bodies unchanged to the Worker. This keeps the
smoke focused on HonoWarden API behavior instead of local development transport
quirks.
