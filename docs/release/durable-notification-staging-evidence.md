# Durable Notification Staging Evidence

Status: passed on 2026-07-11 JST.

This evidence covers `HON-84`: durable login-with-device notification delivery
across Worker requests. D1 polling remains authoritative. This does not enable
the feature in production or claim official desktop/browser UI compatibility.

## Deployment

- Implementation pull request: `#74`
- Source merge commit: `508ab9a`
- Staging Worker version: `b3035fcd-0f1b-43cf-b3cd-37529816c6c6`
- Durable Object binding: `NOTIFICATION_HUB (NotificationHub)`
- Staging flag: `HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED=true`
- Production flag in repository config: `false`

The deployment created the SQLite Durable Object class through migration tag
`v1`. Notification connections are sharded by authenticated owner user ID, so
different Worker isolates route the same user's connections and approval hints
to the same object.

## Compatibility Contract

The implementation was checked against the public official client and server
source contract:

- clients connect with the SignalR MessagePack protocol;
- the subscribed hub target is `ReceiveMessage`;
- an auth-request response uses notification type `16`;
- the payload contains only the auth-request ID and owner user ID.

The implementation uses the official Microsoft SignalR MessagePack codec for
binary framing. No access code, token, email, password hash, device identifier,
security stamp, or encrypted response key is included in the notification.

The original HON-84 pass above exercised response type `16` on the
authenticated hub. HON-95 later aligned the complete official-client split:
pending type `15` now uses the authenticated owner hub and `ReceiveMessage`,
while response type `16` uses a request-scoped anonymous hub and the official
`AuthRequestResponseRecieved` target. See
[`login-with-device-live-client-evidence.md`](login-with-device-live-client-evidence.md).

## Live Lifecycle

A temporary synthetic user and active approving device were inserted into the
empty staging D1 database. A password grant created an authenticated session.
The test then:

1. created a type `0` auth request;
2. opened `/notifications/hub` with the MessagePack handshake;
3. kept that connection open while a separate HTTP request approved the auth
   request;
4. received a `ReceiveMessage` invocation with type `16` and the expected
   request/user IDs;
5. polled the response endpoint and confirmed the same approved state and
   synthetic encrypted key.

This demonstrates cross-request delivery through the Durable Object. Unit and
route tests also prove that idempotent approval replay does not send another
hint and that notification failure does not change the successful approval or
denial response.

## Verification

- 74 test files and 661 tests passed;
- TypeScript, ESLint, Prettier, brand scan, and strict release gate passed;
- dependency audit reported no known vulnerabilities;
- Wrangler staging deploy dry-run and live deploy resolved the Durable Object
  binding;
- GitHub CI passed on pull request `#74` with no unresolved review threads.

## Cleanup

The synthetic user was deleted in `finally`, cascading its device, session, and
auth request. Final remote D1 readback reported:

- users: `0`
- devices: `0`
- refresh tokens: `0`
- auth requests: `0`
- foreign-key violations: `0`

Hashed request-quota and login-defense rows may remain until bounded retention
cleanup. They contain no raw test identifiers or credentials.

## Failure And Rollback

Notification delivery is a non-authoritative hint. Delivery errors are emitted
as structured logs, approval/denial remains committed in D1, and clients can
continue polling.

To disable delivery, set
`HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED=false` and redeploy. The Durable
Object binding can remain configured; no D1 data migration or request rollback
is required. Production remains disabled and was not deployed.

## Follow-Up Gate

- `HON-95` passed the official Desktop approval and browser consumption path.
- `HON-96` owns explicit polling/readback, replay, cleanup, and final
  compatibility closeout.
