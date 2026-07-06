# Security Policy

HonoWarden is pre-alpha and has not had an independent security audit. Do not use it to store real secrets yet.

Security review materials for the current alpha scope live under
[`docs/security`](docs/security/review-index.md). They are implementation notes,
not a third-party audit result.

## Reporting a Vulnerability

Please do not report vulnerabilities through public GitHub issues.

Preferred process:

1. Use GitHub private vulnerability reporting if it is enabled for this repository.
2. If private reporting is not available, open a minimal public issue asking for a private disclosure channel without including vulnerability details.

Include:

- affected commit or release
- impact
- reproduction steps
- relevant logs with secrets removed
- suggested mitigation, if known

## Supported Versions

No production versions are supported yet. Security fixes will target `main` until the first release line exists.
