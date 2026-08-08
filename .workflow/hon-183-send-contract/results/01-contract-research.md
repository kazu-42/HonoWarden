# Result 01: Contract Research

Status: completed.

- Pinned official client: `web-v2026.6.1` at
  `39f07436ca60e3f25eac47777671754f288a98f1`.
- Pinned official server: `v2026.6.1` at
  `a09c7edb03ae6d4fdece784f1250c67be73d5fe0`.
- Mapped owner CRUD, text creation, file metadata/upload/renewal, access-token,
  metadata-access, and file-download route shapes.
- Confirmed the client retains the URL-fragment key and encrypts Send payloads;
  password credentials are derived client-side from password plus link key
  material before server verification.
- Confirmed public metadata access increments text access count and file access
  increments when a download URL is issued.
- Confirmed HonoWarden still returns explicit `501` after any enabled global
  ingress quota check but before route-specific auth/Send storage for all Send
  routes and `send_access`, with `send-enabled: false`.
- Confirmed the pinned official server also exposes the `remove-auth` owner alias
  and public access responses include the `AuthType` compatibility field.
