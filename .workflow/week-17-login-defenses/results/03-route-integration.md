# Packet 03 Result: Route Integration

Accepted:

- Password grant now checks client-address failure buckets before user lookup.
- Over-limit client-address buckets receive generic `429 invalid_grant` and `Retry-After`.
- Existing locked accounts receive generic `400 invalid_grant`.
- Wrong passwords record a hashed auth attempt, atomically advance failure buckets, and sync account failed-login state.
- Successful password grants reset account login-defense state and the account failure bucket before creating a session.

Verification:

- HTTP route tests cover client-address rate limit and account lockout.
- Existing token success and invalid-grant tests still pass.

Remaining risks:

- The route still uses generic wording by design, so operators need future metrics/logging to distinguish lockouts from ordinary invalid grants.
