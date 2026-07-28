import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'

import {
  canonicalHon222Marker,
  hon222LinearPlan,
  renderHon222ChildDescription,
  renderHon222ExecutionCheckpoint,
  summarizeHon222Plan,
  validateHon222Plan,
} from './hon-222-linear-plan.mjs'

test('defines three serialized evidence packets with one active entry', () => {
  validateHon222Plan()
  assert.deepEqual(
    hon222LinearPlan.issues.map((issue) => issue.stateType),
    ['completed', 'completed', 'started'],
  )
  assert.deepEqual(summarizeHon222Plan().relations, [
    { blocker: 'EVIDENCE-1A', blocked: 'EVIDENCE-1B' },
    { blocker: 'EVIDENCE-1B', blocked: 'EVIDENCE-1C' },
  ])
})

test('pins exact parent, children, labels, and workflow packets', () => {
  assert.equal(hon222LinearPlan.parentIdentifier, 'HON-222')
  assert.equal(
    hon222LinearPlan.parentId,
    '0879badf-b4b1-4c56-9da5-64d6fb71a994',
  )
  assert.deepEqual(
    hon222LinearPlan.issues.map((issue) => issue.identifier),
    ['HON-227', 'HON-228', 'HON-229'],
  )
  assert.deepEqual(
    hon222LinearPlan.issues.map((issue) => issue.packet),
    [
      '04a-evidence-contract',
      '04b-closeout-packet-secret-scan',
      '04c-docs-index-reconciliation',
    ],
  )
  for (const issue of hon222LinearPlan.issues) {
    assert.ok(issue.labels.includes('evidence:required'))
    assert.ok(issue.labels.includes('risk:security'))
    assert.ok(issue.labels.includes('agent:codex'))
  }
  assert.deepEqual(hon222LinearPlan.issues[0].closeout, {
    archivedAt: '2026-07-22T10:11:52.647Z',
    pullRequest: 115,
    mergeCommit: '5b67fbdcf6d32942e5786f4cc49684c479778de8',
    mainCiRun: 29910713312,
    tree: '0297ca848869817cbec3e8f077cd61d313faf239',
  })
  assert.deepEqual(hon222LinearPlan.issues[1].closeout, {
    archivedAt: '2026-07-23T06:42:39.292Z',
    pullRequest: 116,
    mergeCommit: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
    reviewedPublicationTree: '25d64460775356fabad0b5c76fd4cbc39857bab4',
    exactHeadCiRun: 29985521114,
    mainCiRun: 29985701462,
  })
})

test('renders exact managed descriptions and checkpoint dependencies', () => {
  const identifiers = Object.fromEntries(
    hon222LinearPlan.issues.map((issue) => [issue.key, issue.identifier]),
  )
  for (const definition of hon222LinearPlan.issues) {
    const body = renderHon222ChildDescription(definition, identifiers)
    assert.ok(body.startsWith(canonicalHon222Marker(definition)))
    assert.equal(body.match(/honowarden-managed:/g)?.length, 1)
    assert.match(body, /Safety boundary/)
    assert.match(body, /Evidence levels must remain conservative/)
    for (const blocker of definition.blockers) {
      assert.match(body, new RegExp(identifiers[blocker]))
    }
  }

  const checkpoint = renderHon222ExecutionCheckpoint(identifiers)
  assert.equal(
    checkpoint.match(/honowarden-managed:HON-222:execution-plan/g)?.length,
    1,
  )
  assert.match(checkpoint, /EVIDENCE-1C is the only active child/)
  assert.match(checkpoint, /PR #115 was squash-merged/)
  assert.match(checkpoint, /PR #116 was squash-merged/)
  assert.match(checkpoint, /PR\/head CI run `29985521114`/)
  assert.match(checkpoint, /exactly HON-222 plus child HON-229/)
  assert.match(checkpoint, /HON-227 ->|HON-227 \(EVIDENCE-1A\)/)
  assert.match(checkpoint, /lower-level artifacts cannot satisfy/)
  assert.match(checkpoint, /merged-main CI/)
  assert.equal(checkpoint.endsWith('\n'), true)
  assert.equal(Buffer.byteLength(checkpoint), 2094)
  assert.equal(
    createHash('sha256').update(checkpoint).digest('hex'),
    '0eb00451b0eab0f1beeccdca634513e01bb8de2fe6fe771170b99c5ec77b6839',
  )
})

test('pins current workflow state and Linear readback to EVIDENCE-1C', () => {
  const state = JSON.parse(
    readFileSync(new URL('../state.json', import.meta.url), 'utf8'),
  )
  const readbackArtifact = readFileSync(
    new URL('../results/hon-222-linear-plan-readback.json', import.meta.url),
  )
  const readback = JSON.parse(readbackArtifact.toString('utf8'))
  const evidencePacket = state.packets.find(
    (packet) => packet.id === '04-compatibility-evidence',
  )
  const evidenceResult = readFileSync(
    new URL('../results/04c-docs-index-reconciliation.md', import.meta.url),
    'utf8',
  )
  const gitAttributes = readFileSync(
    new URL('../../../.gitattributes', import.meta.url),
    'utf8',
  )

  assert.equal(state.active_packet, '04c-docs-index-reconciliation')
  assert.match(
    evidenceResult,
    /^Status: twenty-eighth review finding remediated; publication candidate with exact-head gates external$/m,
  )
  assert.doesNotMatch(evidenceResult, /^Status: twenty-seventh review/m)
  assert.equal(readbackArtifact.byteLength, 1517)
  assert.equal(
    createHash('sha256').update(readbackArtifact).digest('hex'),
    '126a55deaded64b96a3020881d5287cfe09d2b09be514add2b828c0a31e69a09',
  )
  assert.match(
    gitAttributes,
    /^\.workflow\/hon-207-credential-closeout\/results\/hon-222-linear-plan-readback\.json text eol=lf$/m,
  )
  assert.match(
    evidenceResult,
    /Committed HON-222 readback artifact\s+`results\/hon-222-linear-plan-readback\.json`: 1,517 bytes, SHA-256/,
  )
  assert.match(
    evidenceResult,
    /126a55deaded64b96a3020881d5287cfe09d2b09be514add2b828c0a31e69a09/,
  )
  assert.match(
    evidenceResult,
    /external HON-222 Linear execution checkpoint metadata records a\s+2,094-byte body/i,
  )
  assert.match(
    evidenceResult,
    /external HON-222 Linear execution checkpoint metadata[\s\S]*0eb00451b0eab0f1beeccdca634513e01bb8de2fe6fe771170b99c5ec77b6839/i,
  )
  assert.match(
    evidenceResult,
    /external HON-222 Linear execution checkpoint metadata[\s\S]*updated at `2026-07-23T06:43:06\.815Z`\./i,
  )
  assert.match(
    evidenceResult,
    /The managed HON-229 implementation checkpoint is external Linear state\. It\s+is re-read at publication and is not commit-local proof\./,
  )
  assert.doesNotMatch(
    evidenceResult,
    /latest managed\s+HON-229 implementation checkpoint readback/i,
  )
  assert.deepEqual(
    evidencePacket.subpackets.map((packet) => [
      packet.linear,
      packet.status,
      packet.result,
    ]),
    [
      ['HON-227', 'completed', 'results/04a-evidence-contract.md'],
      ['HON-228', 'completed', 'results/04b-closeout-packet-secret-scan.md'],
      ['HON-229', 'in_progress', 'results/04c-docs-index-reconciliation.md'],
    ],
  )
  assert.equal(
    state.verification.status,
    'evidence_1c_twenty_eighth_review_finding_remediated_publication_candidate',
  )
  assert.equal(
    state.verification.results.evidence1cFifthReviewedHead,
    'e143396a08b1f77854f4bf7c2bafdadb018fcdff',
  )
  assert.equal(
    state.verification.results.evidence1cFifthReviewedTree,
    '485649479e072eb1ea3bd4e449d857146f4f69b4',
  )
  assert.match(
    state.verification.results.evidence1cFifthStandardReview,
    /019f8e77_d6d6_7340_846e_110e8a6eec61_request_changes_4_p2/,
  )
  assert.match(
    state.verification.results.evidence1cFifthAdversarialReview,
    /019f8e77_c14d_7c71_875d_eb71b7c20546_request_changes_1_p2/,
  )
  assert.match(
    state.verification.results.evidence1cFifthFiveAxisReview,
    /019f8e77_c218_7d60_bf79_a47beb6eb725_request_changes_1_p2.*1_p3/,
  )
  assert.match(
    state.verification.results.evidence1cFifthReviewRemediation,
    /84_focused_477_compatibility_57_related_ops_docs/,
  )
  assert.equal(
    state.verification.results.evidence1cSixthReviewedHead,
    'ad62112ce5fc3828d1d614b1790ec6f556e0fdb8',
  )
  assert.equal(
    state.verification.results.evidence1cSixthReviewedTree,
    '98671b1a2076b41143ee399e309134213d13659a',
  )
  assert.match(
    state.verification.results.evidence1cSixthStandardReview,
    /019f8e90_cd11_70a3_acf2_780e712b612f_request_changes_2_p2/,
  )
  assert.match(
    state.verification.results.evidence1cSixthAdversarialReview,
    /019f8e90_f941_7362_be6f_5b15fa735c7b_request_changes_2_p2.*2_p3/,
  )
  assert.match(
    state.verification.results.evidence1cSixthFiveAxisReview,
    /019f8e90_fa08_71e2_a191_731863e9ce2c_request_changes_1_p2/,
  )
  assert.match(
    state.verification.results.evidence1cSixthReviewRemediation,
    /103_focused_496_compatibility_57_related_ops_docs/,
  )
  assert.equal(
    state.verification.results.evidence1cSeventhReviewedHead,
    'f9e3fdd668ecd803bff122ecc979a3bac913fdda',
  )
  assert.equal(
    state.verification.results.evidence1cSeventhReviewedTree,
    'c2906be644441072a8894557eda2da873a065ee0',
  )
  assert.match(
    state.verification.results.evidence1cSeventhStandardReview,
    /019f8ea8_b7ea_7b00_bb0d_50c3186c79cf_request_changes_3_p2/,
  )
  assert.match(
    state.verification.results.evidence1cSeventhAdversarialReview,
    /019f8ea8_83dc_7170_a1bf_a48f3568f967_request_changes_2_p2.*2_p3/,
  )
  assert.match(
    state.verification.results.evidence1cSeventhFiveAxisReview,
    /019f8ea8_848d_7882_939f_374a5d5dce6a_0_actionable_p0_p1_p2_p3/,
  )
  assert.match(
    state.verification.results.evidence1cSeventhReviewRemediation,
    /130_focused_523_compatibility_57_related_ops_docs/,
  )
  assert.equal(
    state.verification.results.evidence1cEighthReviewedHead,
    'ab4edc72febe201d5944157998d646d0035c7b24',
  )
  assert.equal(
    state.verification.results.evidence1cEighthReviewedTree,
    '4461471b5ec870eb98c2f3b15c506fa05d122dde',
  )
  assert.match(
    state.verification.results.evidence1cEighthStandardReview,
    /019f8ecb_0bd1_7062_a9a6_c32a6faf862b_request_changes_4_p2/,
  )
  assert.match(
    state.verification.results.evidence1cEighthAdversarialReview,
    /019f8eca_ed3d_75c0_a53a_8db1c5120828_request_changes_2_p2/,
  )
  assert.match(
    state.verification.results.evidence1cEighthFiveAxisReview,
    /019f8eca_eb25_78b0_8fb4_cccd3a8f973b_0_actionable_p0_p1_p2_p3/,
  )
  assert.match(
    state.verification.results.evidence1cEighthReviewRemediation,
    /144_focused_537_compatibility_57_related_ops_docs/,
  )
  assert.equal(
    state.verification.results.evidence1cNinthReviewedHead,
    '3381cabc37f7def36bb8409d0f6b2a56ea0602e9',
  )
  assert.equal(
    state.verification.results.evidence1cNinthReviewedTree,
    'f4afb19db05a1b18b6c094199ae9da97cd02b7ac',
  )
  assert.match(
    state.verification.results.evidence1cNinthStandardReview,
    /019f8edd_92de_7281_9f60_67051aaf7a56_request_changes_3_p2/,
  )
  assert.match(
    state.verification.results.evidence1cNinthAdversarialReview,
    /019f8edd_778c_76e3_aa82_304b4124ddbb_request_changes_2_p2/,
  )
  assert.match(
    state.verification.results.evidence1cNinthFiveAxisReview,
    /019f8edd_7864_7713_8316_93a5eb1a99e4_0_actionable_p0_p1_p2_p3/,
  )
  assert.match(
    state.verification.results.evidence1cNinthReviewRemediation,
    /184_focused_577_compatibility_57_related_ops_docs_6_hon_222_plan_1807_full/,
  )
  assert.equal(
    state.verification.results.evidence1cTenthReviewedHead,
    '9394010ec55b123aee96975716c5995779e59241',
  )
  assert.equal(
    state.verification.results.evidence1cTenthReviewedTree,
    '210871227699b77e89622da847e729e8ba213627',
  )
  assert.match(
    state.verification.results.evidence1cTenthStandardReview,
    /019f8ef3_8a47_76d0_a9f3_fa8da4b32f21_request_changes_4_p2/,
  )
  assert.match(
    state.verification.results.evidence1cTenthAdversarialReview,
    /019f8ef3_4ff4_73f2_b1c8_f31b2423244b_request_changes_1_p2/,
  )
  assert.match(
    state.verification.results.evidence1cTenthFiveAxisReview,
    /019f8ef3_74f2_7a23_b4eb_d88b2814d481_request_changes_1_p2.*1_p3/,
  )
  assert.match(
    state.verification.results.evidence1cTenthReviewRemediation,
    /216_focused_609_compatibility_57_related_ops_docs_6_hon_222_plan_1839_full/,
  )
  assert.equal(
    state.verification.results.evidence1cEleventhReviewedHead,
    'a0be24031a711119764a689538353de9ee987c7a',
  )
  assert.equal(
    state.verification.results.evidence1cEleventhReviewedTree,
    'cd3d400fc9a7c8e7ac4aea530aab43d71b48e0d4',
  )
  assert.match(
    state.verification.results.evidence1cEleventhStandardReview,
    /019f8f07_20f8_7931_b34d_c119e6f14c75_request_changes_5_p2/,
  )
  assert.match(
    state.verification.results.evidence1cEleventhAdversarialReview,
    /019f8f07_097a_7ae0_ac5b_2f5bf7f5094b_request_changes_1_p2/,
  )
  assert.match(
    state.verification.results.evidence1cEleventhFiveAxisReview,
    /019f8f07_08a7_7273_af08_957c350c6e81_request_changes_2_p2/,
  )
  assert.match(
    state.verification.results.evidence1cEleventhFollowupReviews,
    /019f8f12_aa6d_7e61_8a34_c4a45416e40e.*019f8f12_a977_7133_8ff1_41cda875630c/,
  )
  assert.match(
    state.verification.results.evidence1cEleventhReviewRemediation,
    /260_focused_653_compatibility_57_related_ops_docs_6_hon_222_plan_1883_full/,
  )
  assert.equal(
    state.verification.results.evidence1cTwelfthReviewedHead,
    '5eece6c1579c1bd90db98cc62c168e59c281ce65',
  )
  assert.equal(
    state.verification.results.evidence1cTwelfthReviewedTree,
    'e562fb3eb6246b6f7dc1a962699cf907886e074c',
  )
  assert.match(
    state.verification.results.evidence1cTwelfthStandardReview,
    /019f8f2a_1c6b_7703_aa9f_d01bdbd23056_request_changes_3_p2.*1_p3/,
  )
  assert.match(
    state.verification.results.evidence1cTwelfthAdversarialReview,
    /019f8f29_f5c3_7703_b080_5a41cdeb3925_request_changes_2_p2/,
  )
  assert.match(
    state.verification.results.evidence1cTwelfthFiveAxisReview,
    /019f8f29_f697_7b70_ab66_82f974643a85_0_actionable_p0_p1_p2_p3/,
  )
  assert.match(
    state.verification.results.evidence1cTwelfthFollowupReviews,
    /019f8f33_3154_7fb3_ab42_c88a62612df4.*019f8f33_51f8_75f1_a9a3_e39704c61ad1/,
  )
  assert.match(
    state.verification.results.evidence1cTwelfthReviewRemediation,
    /297_focused_690_compatibility_57_related_ops_docs_6_hon_222_plan_1920_full/,
  )
  assert.equal(
    state.verification.results.evidence1cThirteenthReviewedHead,
    'f63a3a95193778262f75d5442e860ee442347ffd',
  )
  assert.equal(
    state.verification.results.evidence1cThirteenthReviewedTree,
    'fcd6f47c1e84e64c5335ae6a247a352712a6983a',
  )
  assert.match(
    state.verification.results.evidence1cThirteenthStandardReview,
    /019f8f45_39ae_77f3_8e8d_f469e18ad8d9_request_changes_4_p2/,
  )
  assert.match(
    state.verification.results.evidence1cThirteenthAdversarialReview,
    /019f8f44_fc8f_76f2_a1cd_554a3ec1649e_request_changes_1_p2/,
  )
  assert.match(
    state.verification.results.evidence1cThirteenthFiveAxisReview,
    /019f8f45_1f35_76d0_b238_921c48f2935a_0_actionable_p0_p1_p2_p3/,
  )
  assert.match(
    state.verification.results.evidence1cThirteenthFollowupReviews,
    /019f8f50_821a_7942_83ac_626a4adbf424.*019f8f50_831e_7e31_9434_ada14dec61dc/,
  )
  assert.match(
    state.verification.results.evidence1cThirteenthReviewRemediation,
    /322_focused_715_compatibility_57_related_ops_docs_6_hon_222_plan_1945_full/,
  )
  assert.equal(
    state.verification.results.evidence1cFourteenthReviewedHead,
    'c52dd0b29f719a9f6935f1fe62208ba1eda9055f',
  )
  assert.equal(
    state.verification.results.evidence1cFourteenthReviewedTree,
    'cc5b724ce278946701ccffa260a0a519798f5f63',
  )
  assert.match(
    state.verification.results.evidence1cFourteenthStandardReview,
    /019f8f7f_0f18_76e2_87bf_17e4f3a2767d_request_changes_3_p2/,
  )
  assert.match(
    state.verification.results.evidence1cFourteenthAdversarialReview,
    /019f8f7e_ff8c_7f22_809d_4894612b5549_request_changes_1_p2.*1_p3/,
  )
  assert.match(
    state.verification.results.evidence1cFourteenthFiveAxisReview,
    /019f8f7f_005d_7920_b4a5_64b6d130d7ea_0_actionable_p0_p1_p2_p3.*approve/,
  )
  assert.match(
    state.verification.results.evidence1cFourteenthReviewRemediation,
    /345_focused_738_compatibility_60_related_ops_docs_6_hon_222_plan_1968_full/,
  )
  assert.equal(
    state.verification.results.evidence1cFifteenthReviewedHead,
    'b2fbd47f5efbf8557dafb64536ddabc62f0299ed',
  )
  assert.equal(
    state.verification.results.evidence1cFifteenthReviewedTree,
    '0310edb14295d6b6c9270a8a64c6ed6b290df258',
  )
  assert.match(
    state.verification.results.evidence1cFifteenthStandardReview,
    /019f8fb5_a2cd_7a71_9ca9_ae0b00d1f254_request_changes_4_p2/,
  )
  assert.match(
    state.verification.results.evidence1cFifteenthAdversarialReview,
    /019f8fb5_e125_7b71_bd72_db8a7e6ffb03_request_changes_6_p2/,
  )
  assert.match(
    state.verification.results.evidence1cFifteenthFiveAxisReview,
    /019f8fb6_107b_7160_9136_fc3ecee63c99_request_changes_4_p2/,
  )
  assert.match(
    state.verification.results.evidence1cFifteenthImpactReview,
    /019f8fe7_c180_7d71_b654_b4483283ffe5/,
  )
  assert.match(
    state.verification.results.evidence1cFifteenthReviewRemediation,
    /359_focused_752_compatibility_60_related_ops_docs_6_hon_222_plan_1982_full/,
  )
  assert.equal(
    state.verification.results.evidence1cFocused,
    'passed_docs_contract_526_release_security_537_compat_919_related_ops_docs_60_hon_222_plan_6',
  )
  assert.equal(
    state.verification.results.evidence1cFullSuite,
    'passed_105_files_2149_tests_serial_147_49_seconds_post_twenty_eighth_remediation',
  )
  assert.deepEqual(state.verification.results.evidence1cEighteenthRemediation, {
    base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
    prior_seventeenth_head: '43ed49648a8bfbe2a1775f75a31663055d91ade7',
    review_target_head: '41b4000c4c41af4069ab467350cac7615a7346ce',
    focused_docs_contract_tests: 383,
    compat_tests: 776,
    related_tests: 60,
    full_suite_files: 105,
    full_suite_tests: 2006,
    full_suite_serial_seconds: 175.78,
    dependency_audit_advisory: 'GHSA-mh99-v99m-4gvg',
    dependency_override: 'brace-expansion@5.0.7_to_5.0.8',
    lockfile_sha256:
      '1cc0da4da357c5f3b7b172f62b1f8f5167e600ad09dadf05cfc58f6fb1893628',
    dependency_audit: 'no_known_vulnerabilities',
    findings_closed: [
      'table_header_cell_ownership',
      'flag_bearing_table_headers',
      'credential_and_status_heading_inheritance',
      'rendered_inline_link_adjacency',
      'evidence_subject_status_assertions',
      'coordinated_live_and_local_rollout_subjects',
      'local_subsection_claim_scope',
      'not_yet_rollout_negation',
      'interrogative_nonassertive_claims',
      'root_compat_docs_specs_markdown_discovery',
    ],
  })
  assert.deepEqual(state.verification.results.evidence1cNineteenthRemediation, {
    base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
    reviewed_head: 'b8679b0dad8ea640218b8866fa3f2ca3fad0029b',
    reviewed_tree: 'a80c9ed719911982ca286de3e2f9087cd233ca98',
    head_ci_run: 30321825914,
    native_review_session: '019fa673-72ec-7371-8b06-9897fdb93926',
    standard_review_agent: '019fa673-5917-7841-9347-ead3d1634af6',
    adversarial_review_agent: '019fa673-2a82-7a93-9bb0-6139cdf82afd',
    five_axis_review_agent: '019fa673-40e7-7ca3-aaed-fe191de9fd3a',
    actionable_p2_instances: 5,
    initial_red_failures: 9,
    focused_docs_contract_tests: 395,
    compat_tests: 788,
    related_tests: 60,
    full_suite_files: 105,
    full_suite_tests: 2018,
    full_suite_serial_seconds: 143.85,
    findings_closed: [
      'rollout_transition_and_activation_predicates',
      'verb_before_password_credential_context',
      'scheduled_remote_backup_false_positive_boundary',
      'state_referenced_active_workflow_current_claim_scan',
    ],
  })
  assert.deepEqual(state.verification.results.evidence1cTwentiethRemediation, {
    base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
    reviewed_head: 'a6e91141e97f5d0685e662f18afda1613b0f523c',
    reviewed_tree: 'aaa97abc967af8b383177d85d52b8620da91f6dc',
    head_ci_run: 30323451650,
    native_review_session: '019fa692-66e6-7bb1-b673-a3cf94595007',
    standard_review_agent: '019fa692-24d6-78a0-aab8-19b32e38dac4',
    adversarial_review_agent: '019fa692-4153-7772-8592-9b61b370a754',
    five_axis_review_agent: '019fa692-57c4-74c1-b13d-ba8c3f27c98d',
    actionable_p2_instances: 7,
    consolidated_boundary_classes: 6,
    initial_red_failures: 16,
    focused_docs_contract_tests: 424,
    compat_tests: 817,
    related_tests: 60,
    full_suite_files: 105,
    full_suite_tests: 2047,
    full_suite_serial_seconds: 143.36,
    findings_closed: [
      'explicit_review_history_and_current_remediation_scan',
      'active_live_credential_predicates',
      'rollout_transition_and_spaced_opt_in_predicates',
      'reverse_transition_directionality',
      'copular_on_live_status',
      'checkmark_rollout_table_values',
    ],
  })
  assert.deepEqual(
    state.verification.results.evidence1cTwentyFirstRemediation,
    {
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: 'ea3038daf9a46ec3ef6f344888dd244fe1840bd8',
      reviewed_tree: 'f680da563750a26f5c7655dc9cf8ad4257403217',
      head_ci_run: 30325489707,
      native_review_session: '019fa6ba-2df6-71a3-8e27-f66101cf6f90',
      standard_review_agent: '019fa6b9-f30a-77c3-8a13-6c237f615e46',
      five_axis_review_agent: '019fa6ba-0ce0-7073-8708-0c8f918abca9',
      actionable_p2_instances: 3,
      initial_red_failures: 4,
      focused_docs_contract_tests: 431,
      compat_tests: 824,
      related_tests: 60,
      full_suite_files: 105,
      full_suite_tests: 2054,
      full_suite_serial_seconds: 144.67,
      findings_closed: [
        'latest_remediation_section_current_invariant',
        'negated_local_scope_markers',
        'assertion_tag_question_boundary',
      ],
    },
  )
  assert.deepEqual(
    state.verification.results.evidence1cTwentySecondRemediation,
    {
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: 'adbff3efbcbf8fb96f7fb919e8acfba120e91be5',
      reviewed_tree: 'd7b6f82f523bba8fbc0ab5d138ae4b7e10a33142',
      head_ci_run: 30326284684,
      native_review_session: '019fa6ca-d63f-73d1-9e28-298ecd0c2978',
      standard_review_agent: '019fa6ca-17a5-7770-bc2e-5e8f21b2cc81',
      five_axis_review_agent: '019fa6ca-3117-7c01-b1fb-38dfd8d53bf8',
      actionable_p2_instances: 5,
      consolidated_boundary_classes: 4,
      initial_red_failures: 5,
      focused_docs_contract_tests: 440,
      compat_tests: 833,
      related_tests: 60,
      full_suite_files: 105,
      full_suite_tests: 2063,
      full_suite_serial_seconds: 140.29,
      findings_closed: [
        'temporal_and_absence_local_scope_negation',
        'interrogative_lead_predicate_governance',
        'adjacent_current_status_label',
        'defaulted_enabled_rollout_assignment',
      ],
    },
  )
  assert.deepEqual(
    state.verification.results.evidence1cTwentyThirdRemediation,
    {
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: 'd134cf270d7e19ffc83202a3675c2b15462f8619',
      reviewed_tree: '5c7d28921fb971f6d38c72e64c27a62f5831b8d1',
      head_ci_run: 30327116938,
      native_review_session: '019fa6da-58c0-7562-94d2-9a05f24ddadc',
      standard_review_agent: '019fa6da-1192-79b0-a24f-8cdcde07eae2',
      five_axis_review_agent: '019fa6da-2962-7690-acd1-be5576694168',
      actionable_p2_instances: 3,
      consolidated_boundary_classes: 2,
      initial_red_failures: 4,
      focused_docs_contract_tests: 448,
      compat_tests: 841,
      related_tests: 60,
      full_suite_files: 105,
      full_suite_tests: 2071,
      full_suite_serial_seconds: 143.96,
      findings_closed: [
        'shared_negated_local_scope_assignment_semantics',
        'affirmative_credential_usability_status',
      ],
    },
  )
  assert.deepEqual(
    state.verification.results.evidence1cTwentyFourthRemediation,
    {
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: '37019e71332556cf13c897925a4001fb588b86bd',
      reviewed_tree: '318894722907772b6448d65fa4c886e1960e9dd0',
      head_ci_run: 30328263927,
      native_review_session: '019fa6f0-37e7-7c30-b33d-be4f3642ff74',
      standard_review_agent: '019fa6ef-ea01-7a23-aad5-72d376835915',
      five_axis_review_agent: '019fa6ef-fd7c-7251-9a9e-2e73fb970508',
      actionable_p2_instances: 6,
      consolidated_boundary_classes: 5,
      initial_red_failures: 19,
      focused_docs_contract_tests: 482,
      compat_tests: 875,
      related_tests: 60,
      full_suite_files: 105,
      full_suite_tests: 2105,
      full_suite_serial_seconds: 164.66,
      findings_closed: [
        'shared_appositive_live_status_taxonomy',
        'coordinated_negated_local_scope',
        'live_credential_capability_predicates',
        'negative_live_status_polarity',
        'workflow_review_phase_status',
      ],
    },
  )
  assert.deepEqual(
    state.verification.results.evidence1cTwentyFifthRemediation,
    {
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: '686cf5f476cb0dcc238c195c0a1fc1d667e65e4e',
      reviewed_tree: '9e0bbaf9890bae938b9dfb79e19b80e643561bf8',
      head_ci_run: 30329153308,
      native_review_session: '019fa701-807e-7350-b1b1-388b3d9ada2c',
      standard_review_agent: '019fa701-58aa-7933-852e-24e89072cdbe',
      five_axis_review_agent: '019fa701-6fad-7680-a438-b97963b55fe4',
      remediation_review_agent: '019fa70a-37a4-7f70-8a89-a557dc80a8d7',
      actionable_p2_instances: 5,
      consolidated_boundary_classes: 4,
      initial_red_failures: 19,
      followup_red_failures: 1,
      focused_docs_contract_tests: 526,
      release_security_tests: 537,
      compat_tests: 919,
      related_tests: 60,
      hon_222_plan_tests: 6,
      full_suite_files: 105,
      full_suite_tests: 2149,
      full_suite_serial_seconds: 145.82,
      findings_closed: [
        'impossible_local_scope_negation',
        'compound_live_status_polarity',
        'rollout_flag_equality_predicates',
        'permitted_live_credential_capabilities',
      ],
    },
  )
  assert.deepEqual(
    state.verification.results.evidence1cTwentySixthRemediation,
    {
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: '1e8343388c4f7982128f4cdfb20de78b66ae0d1f',
      reviewed_tree: '45889dafa64e9672cdc459d0faa1222f52e60701',
      head_ci_run: 30330393661,
      native_review_session: '019fa719-6f7f-7560-a79c-dd4b6bb3d5aa',
      standard_review_agent: '019fa719-8573-77c1-9154-e0b36def5095',
      five_axis_review_agent: '019fa719-9a8e-7cd2-8c63-e804d5da70b4',
      actionable_p3_instances: 1,
      consolidated_boundary_classes: 1,
      initial_red_failures: 1,
      focused_docs_contract_tests: 526,
      release_security_tests: 537,
      compat_tests: 919,
      related_tests: 60,
      hon_222_plan_tests: 6,
      full_suite_files: 105,
      full_suite_tests: 2149,
      full_suite_serial_seconds: 144.32,
      findings_closed: ['committed_vs_external_checkpoint_provenance'],
    },
  )
  assert.deepEqual(
    state.verification.results.evidence1cTwentySeventhRemediation,
    {
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: 'a08fba692a5e1df965296121e285de4db91f29da',
      reviewed_tree: '2ddfb48a151643a9a848377e83d301165f2b4e23',
      head_ci_run: 30331482147,
      native_review_session: '019fa72d-73a5-77a1-9e55-8d38604acfc5',
      standard_review_agent: '019fa72d-93f8-7162-b431-b1df64cd87dc',
      five_axis_review_agent: '019fa72d-aac0-7730-a647-59a6db5caee8',
      actionable_p2_instances: 1,
      actionable_p3_instances: 1,
      red_failures: 1,
      committed_readback_artifact: {
        path: 'results/hon-222-linear-plan-readback.json',
        bytes: 1517,
        sha256:
          '126a55deaded64b96a3020881d5287cfe09d2b09be514add2b828c0a31e69a09',
      },
      external_hon222_checkpoint_metadata: {
        id: '0aead33f-61bd-4223-afd3-cb1c4a382008',
        updated_at: '2026-07-23T06:43:06.815Z',
        bytes: 2094,
        sha256:
          '0eb00451b0eab0f1beeccdca634513e01bb8de2fe6fe771170b99c5ec77b6839',
      },
      focused_docs_contract_tests: 526,
      release_security_tests: 537,
      hon_222_plan_tests: 6,
      full_suite_files: 105,
      full_suite_tests: 2149,
      full_suite_serial_seconds: 158.27,
      findings_closed: [
        'tracked_artifact_vs_embedded_external_metadata',
        'external_timestamp_and_hon229_boundary_regression',
      ],
    },
  )
  assert.deepEqual(
    state.verification.results.evidence1cTwentyEighthRemediation,
    {
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: '90a23025feae145178d2e57347bb48c5366aa0e5',
      reviewed_tree: '49499817719882c11170c160dff30ab2a2d9dc3d',
      head_ci_run: 30332049141,
      native_review_session: '019fa738-1eab-7f81-8f94-2a411acdd7fe',
      standard_review_agent: '019fa737-fa71-7273-bab8-0ab6d1b0a74e',
      five_axis_review_agent: '019fa738-0f21-77e0-a173-8dd2714a53c8',
      actionable_p2_instances: 1,
      red_failures: 1,
      autocrlf_reproduction: {
        bytes: 1571,
        sha256:
          '3d42c125e6c74b58802d39b0a652751a692a8c4e649556ae75072c930ad15c60',
        workflow_tests_passed: 5,
        workflow_tests_total: 6,
      },
      lf_attribute:
        '.workflow/hon-207-credential-closeout/results/hon-222-linear-plan-readback.json text eol=lf',
      focused_docs_contract_tests: 526,
      release_security_tests: 537,
      credential_evidence_tests: 36,
      hon_222_plan_tests: 6,
      full_suite_files: 105,
      full_suite_tests: 2149,
      full_suite_serial_seconds: 147.49,
      findings_closed: ['digest_bound_artifact_checkout_eol'],
    },
  )
  assert.deepEqual(
    readback.issues.map((issue) => [
      issue.identifier,
      issue.state,
      issue.archivedAt !== null,
    ]),
    [
      ['HON-227', 'Done', true],
      ['HON-228', 'Done', true],
      ['HON-229', 'In Progress', false],
    ],
  )
  assert.deepEqual(readback.teamWip, ['HON-222', 'HON-229'])
  assert.equal(
    readback.issues[1].mergeCommit,
    '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
  )
  assert.deepEqual(readback.checkpoint, {
    id: '0aead33f-61bd-4223-afd3-cb1c4a382008',
    createdAt: '2026-07-22T02:46:54.160Z',
    updatedAt: '2026-07-23T06:43:06.815Z',
    bytes: 2094,
    sha256: '0eb00451b0eab0f1beeccdca634513e01bb8de2fe6fe771170b99c5ec77b6839',
  })
})

test('keeps the completed EVIDENCE-1B result bound to publication closeout', () => {
  const result = readFileSync(
    new URL('../results/04b-closeout-packet-secret-scan.md', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(result, /publication pending/i)
  assert.doesNotMatch(result, /remain required before HON-229 starts/i)
  assert.match(result, /PR #116/)
  assert.match(result, /32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3/)
  assert.match(result, /29985521114/)
  assert.match(result, /29985701462/)
  assert.match(result, /2026-07-23T06:42:39\.292Z/)
})

test('rejects invalid active count, unknown blockers, duplicate identity, and cycles', () => {
  const noActive = globalThis.structuredClone(hon222LinearPlan)
  noActive.issues[2].stateType = 'unstarted'
  assert.throws(
    () => validateHon222Plan(noActive),
    /exactly one started packet/,
  )

  const unknown = globalThis.structuredClone(hon222LinearPlan)
  unknown.issues[1].blockers = ['MISSING']
  assert.throws(() => validateHon222Plan(unknown), /unknown blocker/)

  const duplicate = globalThis.structuredClone(hon222LinearPlan)
  duplicate.issues[1].id = duplicate.issues[0].id
  assert.throws(() => validateHon222Plan(duplicate), /duplicate issue id/)

  const cyclic = globalThis.structuredClone(hon222LinearPlan)
  cyclic.issues[0].blockers = ['EVIDENCE-1C']
  assert.throws(() => validateHon222Plan(cyclic), /dependency cycle/)
})
