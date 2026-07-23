# EVIDENCE-1C: Docs Index Reconciliation

Status: sixth review findings remediated; exact-head rereviews and publication pending

Linear issue: HON-229

## Scope

- Reconcile compatibility, operations, release, and security documentation
  indexes against the canonical credential-closeout packet.
- Keep every user-facing credential operation claim bound to the canonical
  packet and exact underlying repository evidence.
- Preserve explicit boundaries between fixture, local API, local official
  client, staging, production, Web Vault publication, and remote activation
  claims.
- Add cross-document checks that reject missing canonical links,
  contradictory feature flags, unsupported live claims, stale limitations, and
  orphaned evidence paths.

## Canonical Sources

- Workflow parent: HON-222 remains In Progress.
- Active child: HON-229 is In Progress and non-archived.
- Completed prerequisite: HON-228 is Done and archived at
  `2026-07-23T06:42:39.292Z`.
- HON-228 publication: PR #116 was squash-merged as
  `32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3`.
- HON-228 reviewed publication tree:
  `25d64460775356fabad0b5c76fd4cbc39857bab4`.
- HON-228 exact-head CI run 29985521114 passed.
- HON-228 merged-main CI run 29985701462 passed.
- Team WIP invariant: exactly HON-222 plus HON-229 are In Progress.
- Local workflow projection: `active_packet` is
  `04c-docs-index-reconciliation`; HON-228 is completed; HON-229 is
  in_progress.

## Implementation Result

The reconciliation now protects 14 canonical user-facing compatibility,
current-state, operations, release, and security documents plus four supporting
evidence documents derived directly from registry artifact paths. A GFM-aware
Markdown AST contract resolves inline, angle-bracket, escaped, and
reference-style local links, rejects unparsed link syntax and raw HTML, and
requires exactly one canonical packet and registry entry under the expected
per-document heading. Canonical navigation must expose every registry-backed
supporting document and the official-client credential harness. The
compatibility fixture inventory maps all 11 claim IDs through exactly five
positional columns to the operation, execution level, evidence level, and one
exact artifact linked from the representative-artifact cell. Every canonical
credential section carries the packet's exact no-rerun and no-live-activation
limitations. Environment context is inherited through nested Markdown
containers and table headers, while the claim scanner distinguishes current
staging, production, remote, and real-account credential/recovery assertions
from explicit negation and future gates. Evidence count tables are compared
structurally with the registry, and each rollout document must carry exactly
one row with all three configured scopes set to `false` for each of the four
credential flags.

The local workflow state points at the 04c packet. The completed 04b result is
now bound to PR #116, exact-head and merged-main CI, squash-tree equality, and
the HON-228 Done/archive timestamp. HON-229 and HON-222 remain In Progress.

## Verification

- Cross-document credential contract: 103 tests passed.
- Compatibility suite: 6 files and 496 tests passed.
- Related operator, release, completion-audit, brand, and official-client
  harness checks: 5 files and 57 tests passed.
- HON-222 workflow renderer/readback: 6 tests passed. The last managed Linear
  checkpoint readback was exact at 2,094 bytes and SHA-256
  `0eb00451b0eab0f1beeccdca634513e01bb8de2fe6fe771170b99c5ec77b6839`;
  the sixth-remediation checkpoint refresh follows the exact local commit.
- Post-sixth-remediation full serial suite: 105 files and 1,726 tests passed in
  179.97 seconds.
- TypeScript, ESLint, full-repository Prettier, and brand scan passed.
- Diff whitespace check passed.
- Dependency audit: no known vulnerabilities.
- Dependency-audit lockfile evidence: SHA-256
  `bf9f3c6065cb2265448a4ffb566a0cb7db3a572162c191dd3f01091cb18df4c5`.
- Credential registry verification: 11 claims and 8 artifacts passed.
- Credential closeout packet: 14,398 bytes, SHA-256
  `7e1501caa7db4f38957788b97c4685602ebd7b3f54e38429ab840f9905b3be58`.
- Release gate: 11 pass, 0 manual, 0 block.
- Alpha completion audit: complete.
- Live Linear readback: exactly HON-222 and HON-229 are started; capacity is
  229 total, 133 archived, 94 active unarchived, and 2 completed unarchived;
  HON-229 has no active relation.
- Worktree process readback: no residual process owned by this worktree.

## Initial Review And Remediation

- Standard Codex review targeted implementation commit
  `50c00be6917aa9f498c17afb5724446af6b93302`, tree
  `d20bc87b0cff6b91ed102eb5e44c01aa420f73d4`, session
  `019f8dfa-a157-7fb1-9dda-e6e17f70a18d`. It reported three P2 findings:
  lower-level representative links for official-client claims, missing
  no-rerun limitations in the canonical release/security indexes, and a
  keyword-only activation-boundary test.
- Independent five-axis review targeted the same implementation commit and
  tree, agent `019f8dfa-6332-7f53-9726-596bb24590cd`. It reported one P3:
  stale release-document freshness metadata. Grades were A-, A-, A-, B+, and
  A- for framing, diagnosis, design, correctness/tests, and architecture.
- Remediation was test-first. The strengthened contract failed across all four
  finding classes, then passed after representative links were bound to
  same-level artifacts, exact packet limitations were required in every
  canonical section, positive staging/production activation wording was
  rejected, and all changed freshness headers were advanced to 2026-07-23.

## Second Review And Remediation

- Native Codex session `019f8e14-fb88-7d40-bab2-d982fc958d8d` reviewed exact
  commit `9049eea2d35b0ede01a55b6123fb2a08f4152f1b`, tree
  `5d295b569e342733c358874c283141517060f9be`, and reported three P2 findings.
  Mutations proved that a positive production credential claim outside the
  canonical H2, a stale count row outside the canonical table, and a duplicate
  rollout row could all leave the contract green.
- Adversarial test review agent `019f8e14-8878-7cc3-b77d-f102dbb8e03c`
  independently reported two overlapping P2 findings for global claim scope and
  nested-heading duplicate entries, plus one P3 for valid CommonMark local-link
  forms that the regex extractor ignored.
- Workflow-state review agent `019f8e14-87ad-71c2-afcf-7a7f413bff3e`
  reported one P2: the linked 04b result still described HON-228 publication as
  pending after PR #116, both CI runs, and Linear archive had completed.
- The remediation started with seven failing mutation tests and one failing
  workflow-state test. Regex parsing was replaced with `remark-parse` and
  `remark-gfm`; canonical heading blocks, evidence tables, rollout rows, local
  links, and positive live-credential claims are now validated structurally.
  The 04b result and a dedicated regression test now pin the final HON-228
  publication coordinates.
- A final self-review added three more failing mutations for inline-code live
  claims, duplicate reference definitions, and altered rollout scope headers.
  Prose now includes inline code, reference resolution follows CommonMark's
  first-definition rule, and each rollout table pins its three scope columns
  plus the complete four-row flag set.
- The parser dependencies changed the lockfile. The first serial full run
  passed 1,614 tests and failed 23 release-packet tests because the release gate
  correctly rejected stale dependency-audit hash evidence. A fresh low-level
  audit found zero known vulnerabilities; after the audit document was rebound
  to the new lockfile SHA-256, all 41 affected tests across nine files and then
  the full suite passed serially. After the final self-review mutations, the
  second-remediation full run passed all 1,640 tests across 105 files.

## Third Review And Remediation

- Native Codex session `019f8e41-8c6b-75d0-bc00-efe1d1d4c061` reviewed exact
  commit `b6a73ac3e6b7faa51782de279ff412c69c115e4a`, tree
  `c3fcb4b88e9cbcd9e8e6599beaf0add15557ae6c`, and reported four P2 contract
  bypasses: live claims split across table cells, unrelated negation, stale
  inventory rows absent from the registry, and image targets counted as
  canonical links.
- Adversarial reviewer `019f8e41-0ae2-7972-ae35-67d7ac673c95` reported one
  overlapping P2 for natural environment-suffix wording and negation scope,
  plus one P3 for machine-specific absolute local paths that normalized back
  inside the checkout.
- Five-axis reviewer `019f8e41-35ec-7e30-9a87-8a594cade464` reported no
  actionable finding and graded framing, diagnosis, design, correctness/tests,
  and architecture A/A/A/A/A-. Its approval is recorded but superseded by the
  actionable standard and adversarial findings on the same exact head.
- Eight review mutations failed first. The parser now preserves `link` versus
  `image` kind, rejects decoded absolute local paths, scans complete table rows,
  compares the full inventory ID set with the registry, accepts environment
  placement before or after the credential claim, and binds negation to the
  status or environment clause instead of a fixed prefix window.
- Four more self-review mutations expanded positive operational statuses to
  `approved`, `live`, and `ready`, while preserving `not yet been verified` and
  other explicit negative controls. All 33 contract tests, 426 compatibility
  tests, 69 related document/configuration tests, and 1,656 full-suite tests now
  pass.

## Fourth Review And Remediation

- Native Codex session `019f8e5a-616d-7de2-9ab9-80c0a51247e3` reviewed exact
  commit `3e0aa18f3e2fcd79ef9607d543173a5e668bceed`, tree
  `6140446e400368ef61715bcc97157b31c9fbbc11`, and reported four P2 bypasses:
  direct password/KDF/key operations without a generic context noun, unrelated
  negation, raw HTML links/prose, and non-positional inventory cells.
- Adversarial reviewer `019f8e5a-2df8-7380-9b60-ac1fba0d79aa` reported two P2
  findings for section/table context and `without` negation, plus two P3
  findings for conditional/future wording and raw HTML targets.
- Five-axis reviewer `019f8e5a-2ee7-78d1-a8e8-25a8f67d7e70` reported one P2:
  the hand-maintained 13-document set omitted registry-backed evidence docs and
  left the HON-226 official-client harness publication status stale. Grades
  were B-, B, B, B-, and B-.
- Eighteen initial mutations failed first. Six additional self-review mutations
  then failed around unrelated conditional markers, active proof verbs, modal
  future requirements, and environment-heading context. The final contract
  passes all 59 cases: heading and table context is inherited, current positive
  claims remain distinct from directly scoped negation and non-assertive future
  gates, raw HTML is rejected, inventory rows are exactly five positional
  cells, registry-backed document coverage is derived rather than copied, and
  the HON-226 harness now pins PR #114, squash merge, and Linear archive.

## Fifth Review And Remediation

- Native Codex session `019f8e77-d6d6-7340-846e-110e8a6eec61` reviewed exact
  commit `e143396a08b1f77854f4bf7c2bafdadb018fcdff`, tree
  `485649479e072eb1ea3bd4e449d857146f4f69b4`, and reported four P2 false-green
  paths: canonical links moved away from the named heading, nested-container
  headings omitted from claim context, active `supports`/`works` predicates,
  and representative links outside the representative-artifact cell.
- Adversarial reviewer `019f8e77-c14d-7c71-875d-eb71b7c20546` reported one P2:
  positive proof/status verbs before the environment and operation could evade
  the relation scanner.
- Five-axis reviewer `019f8e77-c218-7d60-bf79-a47beb6eb725` reported one P2
  for recovery/remote claim families omitted from the scanner and one P3 for
  overrejecting bounded negation such as `not fully verified`. Grades were B,
  B, B+, B, and B+.
- The combined mutation run failed 14 cases before remediation. The expected
  heading is now pinned per protected document; the representative artifact
  must be linked from column five; nested Markdown container headings are
  tracked; status-before-environment, present-tense support, backup export,
  restore, disabled-writer, forward-generation, remote, and real-account
  assertions are rejected; and bounded negation remains accepted while
  `not only ... but ...` stays a positive claim. A self-review also removed a
  `Status` word from the mutation heading so the status-before-environment
  cases prove the clause relation logic independently. All 84 focused cases,
  477 compatibility tests, 57 related checks, and 1,707 full-suite tests pass.

## Sixth Review And Remediation

- Native Codex session `019f8e90-cd11-70a3-acf2-780e712b612f` reviewed exact
  commit `ad62112ce5fc3828d1d614b1790ec6f556e0fdb8`, tree
  `98671b1a2076b41143ee399e309134213d13659a`, and reported two P2 bypasses:
  live claims inside fenced output and the repository's `Prod` production
  alias were not scanned.
- Adversarial reviewer `019f8e90-f941-7362-be6f-5b15fa735c7b` reported two P2
  false greens for existence predicates and status/environment colon labels,
  plus two P3 false positives for `After` future gates and generic remote
  backup-export evidence.
- Five-axis reviewer `019f8e90-fa08-71e2-a191-731863e9ce2c` independently
  reported one P2 covering three colon-delimited status forms. Grades were B-,
  B, B+, B, and B for framing, diagnosis, design, correctness/tests, and
  architecture.
- Ten combined review mutations failed first. The scanner now recognizes the
  `Prod` alias, checks fenced output, binds colon labels without joining
  unrelated clauses, recognizes `exists` and `is present` evidence predicates,
  treats `After` as a scoped future marker, and distinguishes generic remote
  backup-export records from credential/recovery claims. A further failing
  self-review mutation fixed leading whitespace after sentence splitting.
  Explicit negation, unrelated conditional markers, and remote operational
  backup evidence remain negative controls. All 103 focused cases, 496
  compatibility tests, and 57 related checks pass.

## Closeout Pending

- Exact-head standard review and independent five-axis rereview of the
  remediated tree are pending.
- PR/head CI, zero unresolved review threads, squash tree equality, and
  merged-main CI are pending.
- Linear Done/archive for HON-229 is pending.
- HON-222 integration closeout is pending.

## Activation Boundary

No staging or production activation occurred. No deployment, remote D1/R2
mutation, real-account credential rotation, plaintext or real secret handling,
destructive data change, paid action, third-party contact, or Web Vault remote
publication is authorized or claimed by this bookkeeping update.
