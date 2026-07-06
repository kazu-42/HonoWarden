# Compatibility Fixtures

Compatibility fixtures capture the minimum upstream-protocol JSON shapes that HonoWarden intends to support.

Each fixture contains:

- `name`: stable fixture identifier
- `endpoint`: method and path
- `request`: synthetic request metadata
- `response`: expected status and JSON body
- `assertions`: JSON path checks for required response fields

Fixtures are intentionally small. They pin fields that official clients need for the initial scope while allowing unknown additional fields to exist later.

Run the fixture suite with:

```sh
pnpm compat:test
```
