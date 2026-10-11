# First-account setup in the dashboard

On a new installation, open the dashboard and choose **初回セットアップ**.
Enter the operator-issued setup code, your display name, email address and a new
master password. After creation, sign in, create the company organization, and
open **会社設定**. Invite additional Administrators or Owners from **メンバー**.
No company-specific name, domain, email or headcount needs to be compiled into
the application.

## Operator prerequisites

- Apply additive migration `0033_initial_setup.sql` through the reviewed protocol.
- Set `HONOWARDEN_INITIAL_SETUP_ENABLED=true` only for the initial setup window.
  It defaults to false in every tracked Wrangler profile.
- Set `HONOWARDEN_BOOTSTRAP_TOKEN` to a securely generated high-entropy value
  (32–512 printable ASCII characters). Deliver it privately to the first operator;
  never put it in a URL, chat transcript, logs, repository or browser storage.
  It is the existing operator bootstrap credential, not a company invite token.
- The database must contain no users and no consumed `initial_setup_receipt`.
  Existing disabled accounts also prevent initial setup.

The setup request sends the code only in `X-HonoWarden-Bootstrap-Token` and accepts
no query parameters. The browser derives and wraps account keys in its crypto
Worker; raw passwords and decrypted vault keys never go to the server. Creation
does not grant a session, mark email as verified, enroll MFA, or create membership.
Complete the normal login and company security steps separately.

## Single use, failure and recovery

The singleton receipt, encrypted account material and required sanitized audit
event are one D1 transaction. Concurrent valid requests have exactly one winner.
Missing required writes roll back the whole transaction. Disabled setup, invalid
authorization, an existing account and a consumed receipt return a generic 403;
there is no public setup-availability endpoint. The dashboard clears submitted
code/password fields and never stores them in session state.

If a response is lost, try signing in with the account you just created. A retry
must not replace its password or keys. A 503 means creation could not be confirmed;
the server records a finite failure event without credentials. Check the database
and sanitized audit through the approved operator procedure before recovery.

After success, disable the initial-setup flag. Do not delete the receipt to roll
back, reset setup or delete an account. It intentionally has no cascading user
foreign key. Keep it in backup/restore together with account data; the synthetic
company smoke checks it after a fresh restore and subsequent restarts. Existing
allowlisted bootstrap behavior and its independent flag are unchanged.

Source tests and local synthetic browser checks do not establish production
deployment, real mailbox receipt or authenticated Desktop acceptance.
