# Packet 02: Runtime Metadata

## Objective

Expose the alpha version consistently through runtime metadata.

## Contract

- Root metadata includes `version`.
- Health metadata returns the alpha version.
- Server config returns the alpha version.
- Root status remains an explicit safety warning until the release tag exists.
