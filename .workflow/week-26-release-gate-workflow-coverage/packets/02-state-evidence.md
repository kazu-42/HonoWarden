# Packet 02: State Evidence

## Objective

Normalize included Week 26 workflow states for release gate consumption.

## Contract

- Included states use `status: "completed"`.
- Included verification states use `status: "passed"`.
- Included states record a passed GitHub Actions CI run.
- Existing local verification evidence is preserved.
