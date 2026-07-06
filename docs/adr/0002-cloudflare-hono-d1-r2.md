# ADR 0002: Cloudflare Workers, Hono, D1, and R2

## Status

Accepted

## Context

HonoWarden needs a low-maintenance deployment target for self-hosted and small-team usage. Cloudflare Workers provides a serverless runtime, D1 provides SQLite-compatible relational storage, and R2 provides object storage for larger encrypted payloads.

## Decision

Build the API as a Hono application targeting Cloudflare Workers. Store relational metadata and encrypted vault records in D1. Store larger encrypted binary objects in R2.

## Consequences

- The application should avoid Node.js-only APIs unless Cloudflare compatibility is confirmed.
- Runtime bindings are accessed through typed Hono Cloudflare bindings.
- Local development and deployment are managed through Wrangler.
