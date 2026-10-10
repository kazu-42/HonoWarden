# Company settings in the dashboard

An unlocked, confirmed organization Owner can open **会社設定** and save the
company name, default email domain, planned member count, and test-mail recipient.
Administrators and Owners are invited and assigned from **メンバー**. Saving
settings does not create accounts, invite people, or send mail.

The default domain is explicit input assistance in the invitation dialog:
**既定ドメインで補完** fills bare names while retaining complete external email
addresses. Review the completed addresses before sending. This is not a verified
domain, email allowlist, or automatic admission policy. Planned member count is
metadata, not a license or seat quota.

**保存済みの宛先にテスト送信** requests a fixed test message through the private
organization mail service. It uses only the saved recipient and settings revision;
unsaved edits never change the target. A successful response proves provider
acceptance, not receipt. Check the recipient inbox and spam folder. Each Owner
and organization share a five-minute cooldown enforced by an atomic, required
audit insertion, including concurrent requests and ambiguous delivery failures.
The server never automatically retries a test message. An uncertain result can
mean the message was sent; wait and check the mailbox before retrying.

## Runtime requirements

- Apply `0032_company_settings.sql` before enabling the feature.
- Set `HONOWARDEN_COMPANY_SETTINGS_ENABLED=true` only through the reviewed
  deployment protocol. All tracked profiles default to `false`.
- For mail tests, bind `ORGANIZATION_MEMBERSHIP_MAILER` to the private invitation
  service with its configured verified sender and scoped provider credential.
  Its `/test` receiver must remain service-binding-only, like `/deliver`.
- Existing account and organization activity, confirmed Owner role, exact current
  device/session family, and organization MFA policy are rechecked in the SQL
  mutation. Reads allow confirmed Owners and Administrators; writes require Owner.

Settings use revision comparison to reject stale saves. Name, settings, and
required sanitized audit updates are atomic. Test-mail audit events record a
request, never successful inbox delivery; recipient addresses and provider errors
are excluded from audit context and logs.

Backup export discovers SQLite tables, including `organization_company_settings`.
The company smoke restore scenario checks populated values after a fresh restore
and later Worker restarts. To stop this surface, disable the flag through the
reviewed protocol and retain the additive table for backup/forward recovery.
Do not drop populated settings as rollback. Neither this feature nor local smoke
evidence establishes production mail delivery or Desktop acceptance.

The first operator account still uses the existing authorized bootstrap process.
Dashboard company setup does not open public registration or remove bootstrap
authorization. Invited users can create their account from their invitation link,
then sign in and await Owner confirmation.
