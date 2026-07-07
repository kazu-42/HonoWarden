# Alpha Publication Gate

Target: `v0.1.0-alpha`.

Status: draft ready for publication approval.

This document is the human-readable gate for publishing the alpha GitHub
Release. It complements the machine-readable status packet and exists so the
operator can verify the exact target, approval text, command, and post-publish
checks before making the release visible.

## Current Draft State

The current GitHub Release draft must match these values before publication:

- repository: `kazu-42/HonoWarden`
- tag: `v0.1.0-alpha`
- target commit:
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- tag verification workflow run:
  `https://github.com/kazu-42/HonoWarden/actions/runs/28863312935`
- release state: draft
- prerelease flag: enabled
- release gate state: `pnpm release:gate -- --strict` returns
  `overall: "ready"`
- status packet phase: `draft_ready_for_publication`

Read the live GitHub Release state before publication:

```sh
gh release view v0.1.0-alpha --repo kazu-42/HonoWarden
```

The draft URL observed for this gate is:

```text
https://github.com/kazu-42/HonoWarden/releases/tag/untagged-b80d25c9cacdaf1c957f
```

## Required Pre-Publication Packet

Run the status packet immediately before publication:

```sh
pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

The expected packet fields are:

- `status: "ready"`
- `phase: "draft_ready_for_publication"`
- `targetTag: "v0.1.0-alpha"`
- `targetVersion: "0.1.0-alpha"`
- `targetCommit:
"e7a3c5ea9e51030143736bb0e7a36cb7a8babfce"`
- `existingRelease.isDraft: true`
- `existingRelease.isPrerelease: true`
- `existingRelease.targetCommitish:
"e7a3c5ea9e51030143736bb0e7a36cb7a8babfce"`
- `nextAction.id: "request_publication_approval"`

If any field differs, stop and inspect the failing publish or published packet.
Do not repair by editing the release directly unless a separate corrective plan
has been reviewed.

Run the completion audit before asking to mark the alpha objective complete:

```sh
pnpm release:completion:audit -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

Before publication, the audit is expected to report
`completion: "incomplete"` with
`blockingReason: "release_publication_approval_required"`. Strict mode is
reserved for the final post-publication proof and fails until the published
prerelease verification passes.

## Approval Text

Publication requires this exact operator approval text:

```text
e7a3c5ea9e51030143736bb0e7a36cb7a8babfce の v0.1.0-alpha draft prerelease を公開してよい
```

Do not infer approval from successful CI, a ready status packet, the existence
of the draft, or an earlier approval for tag movement or draft creation. The
approval is scoped only to publishing this draft prerelease at the listed target
commit.

## Publication Command

After the exact approval text is received, publish with the repo-scoped command
printed by the status packet:

```sh
gh release edit v0.1.0-alpha --draft=false --prerelease --verify-tag --repo kazu-42/HonoWarden
```

The `--verify-tag` flag is required so publication fails if the local command
cannot verify the tag. The `--repo kazu-42/HonoWarden` flag is required so the
command remains safe when copied outside this repository checkout.

## Post-Publication Verification

After publication, run:

```sh
pnpm release:published:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

Then run the aggregate status packet again:

```sh
pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

Finally, run the completion audit in strict mode:

```sh
pnpm release:completion:audit -- --strict --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

Expected post-publication state:

- published packet `status: "ready"`
- status packet `phase: "published_verified"`
- completion audit `completion: "complete"`
- release remains marked as prerelease
- release target commit is still
  `e7a3c5ea9e51030143736bb0e7a36cb7a8babfce`
- release body still contains the required alpha release-note sections

Record the publication timestamp, release URL, published packet output, and
status packet output in the release tracker.

After the release is verified, run the operations readiness packet before
requesting deploy, DNS, or Email Routing approval:

```sh
pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935 --tag-workflow-url https://github.com/kazu-42/HonoWarden/actions/runs/28863312935
```

Before Worker deploy, website route changes, or Email Routing changes, this
packet is expected to remain `status: "not_ready"` and to name the first missing
operations evidence gate. Do not treat a complete release audit as proof that
`honowarden.com`, the API Worker, or project email are live and tested.

## Out Of Scope

Do not deploy from this release in the publication gate.

Deployment, DNS changes, Email Routing changes, production secrets, and
Cloudflare resource mutation require separate approval and separate rollback
evidence. Publishing the prerelease only makes the GitHub Release visible; it
does not prove deployed Worker health or custom-domain readiness.
