# Compatibility Fixtures

Compatibility fixtures capture the minimum upstream-protocol JSON shapes that HonoWarden intends to support.

[`fixture-flows.json`](fixture-flows.json) maps each matrix flow to the fixture
files that prove it. `pnpm compat:test` fails when a matrix row claims a covered
flow that has no fixture file.

Each fixture contains:

- `name`: stable fixture identifier
- `endpoint`: method and path
- `request`: synthetic request metadata
- `response`: expected status and JSON body
- `assertions`: JSON path checks for required response fields

Assertions support object paths, array indexes, exact values, absent fields,
array lengths, minimum array lengths, and `notValue` checks. Fixtures are
intentionally small. They pin fields that official clients need for the initial
scope while allowing unknown additional fields to exist later.

Run the fixture suite with:

```sh
pnpm compat:test
```
