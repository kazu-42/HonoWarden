# Orchestration: Week 26 Inquiry Mailbox Storage

## Strategy

Keep HON-24 limited to inbound metadata storage. The work is split across a
dedicated implementation repository and this operations repository so vault API
deployment and inquiry mail handling remain independently reversible.

## Sequence

1. Implement and verify the dedicated inquiry inbox Worker repository.
2. Create Cloudflare D1/R2 resources, deploy staging and production Workers, and
   keep public aliases forwarding-only.
3. Add only the hidden `inquiry-smoke@honowarden.com` Worker route for live
   production validation.
4. Update HonoWarden operations docs and guard tests.
5. Wait for hidden route live smoke and verify production D1 readback.
6. Merge the HonoWarden docs PR and close HON-24 in Linear only after live
   smoke passes.

## Integration Rules

- Treat local Email Routing smoke as code-path evidence, not production routing
  evidence.
- Treat GitHub Actions CI as implementation-repository evidence, not live email
  delivery evidence.
- Keep public `security`, `support`, `hello`, `admin`, `postmaster`, and
  `abuse` aliases forwarding-only in this workflow.
- If live smoke fails, rollback is disabling the hidden Worker route while
  leaving existing forwarding rules and MX records unchanged.

## Secret Handling

Record only route names, public repository names, Worker names, D1/R2 resource
names, non-secret version identifiers, statuses, and redacted evidence. Do not
record private forwarding destinations, mailbox contents, account member emails,
API keys, token values, or Worker secret values.
