import assert from 'node:assert/strict'
import { createPublicKey, verify as verifyEd25519 } from 'node:crypto'
import test from 'node:test'
import * as promotionBridgeModule from '../../lib/parallel-delivery-fabric-promotion-bridge.mjs'

import {
  buildPromotionHandoff,
  projectPromotionTerminal,
  PROMOTION_BRIDGE_CAPABILITIES,
} from '../../lib/parallel-delivery-fabric-promotion-bridge.mjs'
import { canonicalize, digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import {
  planDirectStackDispatch,
  reduceDirectStackDispatch,
  reduceDirectStackPoll,
} from '../../lib/parallel-delivery-fabric-stack.mjs'

test('Task9 RED — promotion bridge exposes a handoff-only public boundary', () => {
  assert.equal(typeof buildPromotionHandoff, 'function')
  assert.deepEqual(PROMOTION_BRIDGE_CAPABILITIES, {
    can_access_secrets: false,
    can_approve_review: false,
    can_deploy: false,
    can_merge: false,
    can_modify_protection: false,
    can_open_non_draft_pr: false,
    can_push: false,
  })
})

const sha = (character) => character.repeat(40)
const digest = (character) => character.repeat(64)

const roleMatrix = () => ({
  writer: {
    identity: 'session:writer-1',
    capabilities: ['implement_local', 'open_draft_pr', 'push_owned_branch', 'test'],
  },
  self_diagnostic: {
    identity: 'session:self-diagnostic-1',
    capabilities: ['emit_advisory', 'read_candidate'],
  },
  independent_reviewer: {
    identity: 'session:reviewer-1',
    capabilities: ['emit_findings', 'read_candidate'],
  },
  computer_use_verifier: {
    identity: 'session:computer-use-1',
    capabilities: ['emit_evidence', 'operate_ui'],
  },
  binder: {
    identity: 'session:binder-1',
    capabilities: ['bind_evidence'],
  },
  checkrun_publisher: {
    identity: 'session:checkrun-publisher-1',
    capabilities: ['publish_checkrun', 'read_checkrun'],
  },
  promotion_bridge: {
    identity: 'session:promotion-bridge-1',
    capabilities: ['assemble_handoff'],
  },
  merge_executor: {
    identity: 'session:merge-executor-1',
    capabilities: ['merge_exact_head'],
  },
  deployment_executor: {
    identity: 'session:deployment-executor-1',
    capabilities: ['deploy_exact_commit'],
  },
})

const pagination = () => ({
  complete: true,
  expected_count: 1,
  expected_pages: 1,
  observed_count: 1,
  observed_pages: 1,
})

const candidateCorrelation = (candidate) => ({
  plan_id: candidate.plan_id,
  generation: candidate.generation,
  repository: candidate.repository,
  repo_identity_digest: candidate.repo_identity_digest,
  base_sha: candidate.base_sha,
  head_sha: candidate.head_sha,
  tuple_digest: candidate.tuple_digest,
})

const sealCandidateTuple = (candidate) => {
  const { tuple_digest, ...tuple } = candidate
  candidate.tuple_digest = digestCanonical(tuple)
}

const promotionInput = (authority = trustedAuthorityBundle(), direct = false) => {
  const { payload } = authority
  const activation = payload.activation_record
  const roles = roleMatrix()
  const evidence_refs = [
    'evidence:binder-42',
    'evidence:checkrun-42',
    'evidence:computer-use-42',
    'evidence:delivery-42',
    'evidence:review-42',
    'evidence:self-diagnostic-42',
  ]
  const plan = {
    plan_id: 'plan:parallel-delivery-1',
    generation: 1,
    repository: 'acme/bim',
    repo_identity_digest: digest('6'),
    base_sha: activation.base_sha,
    policy_digest: activation.policy_digest,
  }
  const candidate = {
    plan_id: plan.plan_id,
    generation: plan.generation,
    repository: plan.repository,
    repo_identity_digest: plan.repo_identity_digest,
    tuple_digest: null,
    owner_identity: roles.writer.identity,
    pr_number: direct ? 43 : 42,
    base_sha: plan.base_sha,
    head_sha: sha(direct ? 'c' : 'b'),
    changed_files_digest: digest('e'),
    scope_digest: digest('f'),
    lease_id: 'lease:candidate-42',
    execution_context_id: 'context:candidate-42',
    worktree_id: 'worktree:candidate-42',
    worktree_path_digest: digest('1'),
    evidence_digest: digestCanonical(evidence_refs),
    evidence_refs,
  }
  sealCandidateTuple(candidate)
  const correlation = candidateCorrelation(candidate)
  const check_source = {
    app_slug: 'monkey1sai-codex',
    app_id: activation.external_app_id,
    check_name: activation.external_check_name,
    publisher_issuer: payload.checkrun_publisher.issuer,
    ...structuredClone(payload.checkrun_publisher.source),
  }
  return {
    schema_version: 'parallel-delivery-fabric-promotion-request/v2',
    handoff_kind: direct ? 'direct_stack_vector' : 'ordinary_single_pr',
    plan,
    candidate,
    roles,
    self_diagnostic: {
      identity: roles.self_diagnostic.identity,
      correlation: structuredClone(correlation),
      evidence_digest: candidate.evidence_digest,
      evidence_refs: structuredClone(evidence_refs),
      evidence_ref: 'evidence:self-diagnostic-42',
      verdict: 'advisory',
    },
    independent_review: signedProducerRecord(authority, 'independent_review', 'independent_review', {
      identity: roles.independent_reviewer.identity,
      correlation: structuredClone(correlation),
      source: structuredClone(payload.independent_review.source),
      base_sha: candidate.base_sha,
      head_sha: candidate.head_sha,
      changed_files_digest: candidate.changed_files_digest,
      evidence_digest: candidate.evidence_digest,
      evidence_refs: structuredClone(evidence_refs),
      evidence_ref: 'evidence:review-42',
      verdict: 'clear',
      unresolved_findings: 0,
      pagination: pagination(),
      read_only: true,
    }, `nonce:review-${direct ? 'direct' : 'ordinary'}`),
    computer_use_verifier: signedProducerRecord(authority, 'computer_use_verifier', 'computer_use_verifier', {
      identity: roles.computer_use_verifier.identity,
      correlation: structuredClone(correlation),
      source: structuredClone(payload.computer_use_verifier.source),
      base_sha: candidate.base_sha,
      head_sha: candidate.head_sha,
      evidence_digest: candidate.evidence_digest,
      evidence_refs: structuredClone(evidence_refs),
      evidence_ref: 'evidence:computer-use-42',
      verdict: 'passed',
      read_only: true,
    }, `nonce:computer-use-${direct ? 'direct' : 'ordinary'}`),
    binder: signedProducerRecord(authority, 'binder', 'binder', {
      identity: roles.binder.identity,
      correlation: structuredClone(correlation),
      source: structuredClone(payload.binder.source),
      head_sha: candidate.head_sha,
      evidence_digest: candidate.evidence_digest,
      evidence_refs: structuredClone(evidence_refs),
      evidence_ref: 'evidence:binder-42',
      promotion_eligible: true,
      verification_mode: 'canonical',
      candidate_harness_status: 'unchanged',
    }, `nonce:binder-${direct ? 'direct' : 'ordinary'}`),
    check_run: signedProducerRecord(authority, 'checkrun_publisher', 'check_run', {
      check_run_id: 815,
      publisher_identity: roles.checkrun_publisher.identity,
      publisher_issuer: payload.checkrun_publisher.issuer,
      correlation: structuredClone(correlation),
      evidence_digest: candidate.evidence_digest,
      evidence_refs: structuredClone(evidence_refs),
      evidence_ref: 'evidence:checkrun-42',
      source: structuredClone(check_source),
      head_sha: candidate.head_sha,
      status: 'completed',
      conclusion: 'success',
      required: true,
      pagination: pagination(),
    }, `nonce:checkrun-${direct ? 'direct' : 'ordinary'}`),
    observed_activation: structuredClone(activation),
  }
}

const ordinaryInput = (authority = trustedAuthorityBundle()) => promotionInput(authority)

// These are immutable verification vectors only. The matching private keys are
// deliberately absent: neither this test nor the promotion bridge can sign.
const PROMOTION_AUTHORITY_PUBLIC_KEY_SPKI = 'MCowBQYDK2VwAyEA5VZ+pANsU7XvwspyMG898WBOxPuHxxbPSqgHteUkZCg='
const PRODUCER_PUBLIC_KEYS = Object.freeze({
  independent_review: 'MCowBQYDK2VwAyEAS88h3ACHfo0o8K4k4COXtRZ2JcpeGArco6SyIykRw1w=',
  computer_use_verifier: 'MCowBQYDK2VwAyEA5XQTum8rz/pxDXnezZuot4ZMJinLtID3E0rMSPfgmBM=',
  binder: 'MCowBQYDK2VwAyEAOokU/JbgwNTmD3DzebcP3LFp5AXR6Vwui2tXdRBz008=',
  checkrun_publisher: 'MCowBQYDK2VwAyEAz9nDv0jg+d6tCLb0GbMAZF+ArNkx+50p5n238F6aBF0=',
  ordinary_replay: 'MCowBQYDK2VwAyEAUz5RwxQDKuXGS3/LZ4fQ3G1IkNdmwApjGyeOQdWv3T4=',
  direct_stack_replay: 'MCowBQYDK2VwAyEA37NZ/V07Pst3hLo8T0g0tVOm4oUjHwkm7lzPpcYzB0U=',
  ancestry: 'MCowBQYDK2VwAyEASkrveL9F2dQIvDkqFhxwrfc7LzL2Ldni8uw1uo8UMGU=',
  origin_main: 'MCowBQYDK2VwAyEAosxD6Q7gaPNjzTi3FB56xhGbmmDoqtXmLGcVCc5cL6k=',
  deployment: 'MCowBQYDK2VwAyEAmijcvUD3os+kbvWlv5CWosMeRbnZwlGVyjWlaYQJqGA=',
  postverify: 'MCowBQYDK2VwAyEA+pLBMZqeIGqM0SOpWVl8JwOHuW0EU9UCKdslWMjTQCk=',
})
const AUTHORITY_SIGNATURES = Object.freeze({
  ordinary: 'FzDFj3tbTV26+tfFd+EhbYfOf/EYTVBFPMjREdfwZBXzoCOC8mATmwRXAereqAQ5o1fZIsqrCKXOwR7sN+NKDg==',
  direct: 'YMLmZB1i3Ai/ZdGzmGYzzBe2Qb87iobyi2VhKZcGns6G44tYySrQ9ANnVAWVWA4fONgtuspylsQ/cqly0c4gCA==',
  stale: 'E9s1kIS8n3d0RQjA8/A30vatxCx8IVSaQR192JhVNH+HoHhaq4Fhyvpeo3/30Twzk8jzwrVsb/3C+Xs7JMnqDQ==',
  revoked: 'iaM78bZSlwNm+xNrJBt5msceKI+X6bmIsk9rPf5TY0Nzr4CKPuawSuEHf7V0ezi/bbG0JXMvMjP1Loc/UaolAg==',
})
const RECORD_SIGNATURES = Object.freeze({
  ordinary: Object.freeze({
    independent_review: 'FPtn6ckNxPSzEkpfvZjqKnx3CUbbnek6fSg3Otd5UPybD3kf36aUsJ0T9N5RoILwqRdzMrDfRtt8wNaOxuBKCw==',
    computer_use_verifier: 'rg65FlswH1tS3QDR5ArKIHxwp1HKyakrTw2oVsQFNn+fv10iX5T/c8IZ7D1caqL/+ZG5fsVMqfbeNyDaX8GzAQ==',
    binder: 'IcsKg/4YsVfYRPTO0pKD2xGemND9OLFQ4S1mAw58CIGLvGhwfU3vQwHcmMKxZPg4Ydj2IH8Zbt+QWgdB8jnUCQ==',
    checkrun_publisher: '7tRESFHmNpXdvMgjCnEE2aaJ2XeiT7nbXAEVMMIP8yR+dXBT8+0YoS4Z40BBxWnvCGQXN6shlQk80juP2K3gAw==',
    ordinary_replay: 'hscN2ZRTfko4F/ZfqcN1DS6v4ekpWyNUmZU07piSZO0KysA9+Fz4c6HXoF4eMCX3jwcio82VNJYs3yInmHpFDg==',
    ancestry: 'KFf5oF7PvdduZATB4ihqiWBwBvs04kAQ3bFZA16x1p+cSkSpM1WyyZ1OTFbBubcByT5v+PSUkC1CKJ5RGuPdCA==',
    origin_main: 'wD7mnimsGlDYE+n8QxUYNEey+6tCxBgjEbiG/5oQc9MZIl22doGE5HciZvSk5TB0kpixOvcb2e0qfhclp97LDw==',
    deployment: '68kQ23qy3X89l7BLdTlPFU1AGAiUtb153H28KSJgImiPizdyfCJxOu5oGfKXSXl7ILJ0rcQAnt7H0jqZyH0lDQ==',
    postverify: '8ULRq35Ul3/pFzAW/5G2lY5Jpozfg/5K4CMnkkKr6UD/MFKLxSynZfAP1NFV6fDKiiMNEuyQLmxjuTu+jEhJBg==',
  }),
  direct: Object.freeze({
    independent_review: '539s3mk4qfrw1kL82+a3lt5FdIEsfW+CwJ6nZf1jtM1la9vvTBgdbrrO1uJlIrVAsX7PZsgf4dHXrh/MuhJLBg==',
    computer_use_verifier: '/kGWYy0tBfPPQhsH8Aak+aTpbvCQAXHoALcDh84KZxEDsCw2+kw75TfIBuVGIx427fPqzGjE1uidpUt+Qzl8Cg==',
    binder: '81oyd2IQhOjp+6W0v0Uqt7VEEn++/bsBeepoNL0hDuF/prgwpjr6I+kBHNt40m2il7UxtKbOwgDFXXW+7sD5DA==',
    checkrun_publisher: 'A0KPkv7maAXba1KIJXsKwHueqcaCtOKRuM5uDrGvKjHiGIxUuc373DMLZzFx92o6b20IoyjUiXCfff8N9QxMBg==',
    direct_stack_replay: 'VF2ovpkeWfWJwR2oIqI6wHKHTAtzcxHTWxQB2fON8aw3adiuaHtqiiGUtAsxnQVP5OPXAJ/Jv1zQ9brBgokUCA==',
    ancestry: 'ab0IXCWZoxbsLp3g9pxE9v3tMI+4c9/8oqI3nU1VQlU0DAnjeZ8G30F+Cl9VBBWmEa5iDk/yk4CCJ6xTUKUqDQ==',
    origin_main: 'csTYEtmoiHPMGxNBP45BeZUPBVxXTZ9K4hkP8nsmF0S8YstGRDVqX2yT72gFKPs7S7BTijy/4PYBlnPDAZMeDQ==',
    deployment: 'VkMuNRtYH3eqfWIK7GH6WpkZCPYWZC9ybHQvZ3qc2IvyCkFqlJAC7yu8eDsG59a0LfZQODFA1jixi8wTpWVNBA==',
    postverify: 'DvORt7t+3Hf53eI2YERRDNXLg9tBsDlhXUe145XzSQIjoKR3+5Dca7pRbTmVJEJoLov8WeSRpqCBG3YwQs+lCw==',
  }),
})

const authoritySourcePin = (issuer, source_ref, source_sha, source_digest, base_sha) => ({
  issuer,
  source_ref,
  source_sha,
  source_digest,
  base_sha,
  immutable: true,
  base_pinned: true,
  fresh: true,
  revoked: false,
})

const authorityDeliverySourcePin = (issuer, source_reference, source_sha, source_digest, base_sha) => ({
  issuer,
  source_reference,
  source_sha,
  source_digest,
  base_sha,
  immutable: true,
  base_pinned: true,
  fresh: true,
  revoked: false,
})

const PRODUCER_ISSUERS = Object.freeze({
  independent_review: 'issuer:independent-reviewer',
  computer_use_verifier: 'issuer:computer-use-verifier',
  binder: 'issuer:evidence-binder',
  checkrun_publisher: 'issuer:monkey1sai-codex',
  ordinary_replay: 'issuer:ordinary-replay',
  direct_stack_replay: 'issuer:direct-stack-replay',
  ancestry: 'issuer:delivery-ancestry',
  origin_main: 'issuer:delivery-origin-main',
  deployment: 'issuer:delivery-deployment',
  postverify: 'issuer:delivery-postverify',
})
const PRODUCER_ROLES = Object.freeze({
  independent_review: 'independent_reviewer',
  computer_use_verifier: 'computer_use_verifier',
  binder: 'binder',
  checkrun_publisher: 'checkrun_publisher',
  ordinary_replay: 'deployment_executor',
  direct_stack_replay: 'merge_executor',
  ancestry: 'merge_executor',
  origin_main: 'merge_executor',
  deployment: 'deployment_executor',
  postverify: 'deployment_executor',
})
const producerMetadata = (name, source) => ({
  issuer: PRODUCER_ISSUERS[name],
  role: PRODUCER_ROLES[name],
  expected_identity: roleMatrix()[PRODUCER_ROLES[name]].identity,
  key_id: `ed25519:producer-${name}-vector-1`,
  public_key_spki: PRODUCER_PUBLIC_KEYS[name],
  source,
})
const recordVectorKind = (authority) => (
  authority.payload.authority_id === 'authority:promotion-direct' ? 'direct' : 'ordinary'
)
const producerFor = (authority, name) => (
  name === 'checkrun_publisher'
    ? authority.payload.checkrun_publisher
    : authority.payload.delivery_sources[name] ?? authority.payload[name]
)
const signedProducerRecord = (authority, name, record_type, payload, nonce) => {
  const producer = producerFor(authority, name)
  return {
    schema_version: 'parallel-delivery-fabric-signed-record/v1',
    record_type,
    issuer: producer.issuer,
    key_id: producer.key_id,
    issued_at: '2026-08-28T00:00:00.000Z',
    expires_at: '2036-08-28T00:00:00.000Z',
    revocation: { epoch: 0, revoked: false },
    nonce,
    payload_digest: digestCanonical(payload),
    payload,
    signature: RECORD_SIGNATURES[recordVectorKind(authority)][name],
  }
}

const trustedAuthorityPayload = ({ tag = 'ordinary', baseCharacter = 'a', sourceCharacter = 'c' } = {}) => {
  const base_sha = sha(baseCharacter)
  const source_sha = sha(sourceCharacter)
  return {
    schema_version: 'trusted-promotion-authority-payload/v2',
    authority_id: `authority:promotion-${tag}`,
    repository: 'acme/bim',
    activation_record: {
      schema_version: 'parallel-delivery-fabric-activation/v1',
      phase: 'AUTONOMOUS_ACTIVE',
      base_sha,
      policy_digest: digest('0'),
      writer_cap: 2,
      external_check_name: 'monkey1sai-codex/ready',
      external_app_id: 481516,
      activated_at: '2026-08-28T00:00:00.000Z',
    },
    checkrun_publisher: producerMetadata(
      'checkrun_publisher',
      authoritySourcePin(PRODUCER_ISSUERS.checkrun_publisher, 'base:monkey1sai-codex-ready', source_sha, digest('d'), base_sha),
    ),
    independent_review: producerMetadata(
      'independent_review',
      authoritySourcePin(PRODUCER_ISSUERS.independent_review, 'base:independent-reviewer', source_sha, digest('1'), base_sha),
    ),
    computer_use_verifier: producerMetadata(
      'computer_use_verifier',
      authoritySourcePin(PRODUCER_ISSUERS.computer_use_verifier, 'base:computer-use-verifier', source_sha, digest('2'), base_sha),
    ),
    binder: producerMetadata(
      'binder',
      authoritySourcePin(PRODUCER_ISSUERS.binder, 'base:evidence-binder', source_sha, digest('3'), base_sha),
    ),
    delivery_sources: {
      ordinary_replay: producerMetadata(
        'ordinary_replay',
        authorityDeliverySourcePin(PRODUCER_ISSUERS.ordinary_replay, 'source:ordinary-replay', source_sha, digest('4'), base_sha),
      ),
      direct_stack_replay: producerMetadata(
        'direct_stack_replay',
        authorityDeliverySourcePin(PRODUCER_ISSUERS.direct_stack_replay, 'source:direct-stack-replay', source_sha, digest('5'), base_sha),
      ),
      ancestry: producerMetadata(
        'ancestry',
        authorityDeliverySourcePin(PRODUCER_ISSUERS.ancestry, 'source:ancestry', source_sha, digest('7'), base_sha),
      ),
      origin_main: producerMetadata(
        'origin_main',
        authorityDeliverySourcePin(PRODUCER_ISSUERS.origin_main, 'source:origin-main', source_sha, digest('b'), base_sha),
      ),
      deployment: producerMetadata(
        'deployment',
        authorityDeliverySourcePin(PRODUCER_ISSUERS.deployment, 'source:deployment', source_sha, digest('c'), base_sha),
      ),
      postverify: producerMetadata(
        'postverify',
        authorityDeliverySourcePin(PRODUCER_ISSUERS.postverify, 'source:postverify', source_sha, digest('8'), base_sha),
      ),
    },
  }
}

const trustedAuthorityBundle = (kind = 'ordinary') => {
  const vector = kind === 'direct'
    ? { tag: 'direct', baseCharacter: 'b', sourceCharacter: 'd' }
    : kind === 'stale'
      ? { tag: 'stale', baseCharacter: 'a', sourceCharacter: 'c' }
      : kind === 'revoked'
        ? { tag: 'revoked', baseCharacter: 'a', sourceCharacter: 'c' }
        : { tag: 'ordinary', baseCharacter: 'a', sourceCharacter: 'c' }
  const payload = trustedAuthorityPayload(vector)
  return {
    schema_version: 'trusted-promotion-authority-bundle/v1',
    bundle_id: `bundle:promotion-${vector.tag}`,
    issuer: {
      issuer_id: 'issuer:promotion-control-plane',
      issuer_version: 'promotion-authority/v1',
    },
    source: authoritySourcePin(
      'issuer:promotion-control-plane',
      'base:promotion-authority',
      sha('f'),
      digest('a'),
      payload.activation_record.base_sha,
    ),
    key_id: 'ed25519:promotion-authority-vector-2',
    revocation: kind === 'revoked' ? { epoch: 1, revoked: true } : { epoch: 0, revoked: false },
    freshness: kind === 'stale'
      ? { issued_at: '1970-01-01T00:00:00.000Z', expires_at: '1971-01-01T00:00:00.000Z' }
      : { issued_at: '2026-08-28T00:00:00.000Z', expires_at: '2036-08-28T00:00:00.000Z' },
    payload_digest: digestCanonical(payload),
    payload,
    signature: AUTHORITY_SIGNATURES[kind],
  }
}

const canonicalInputForAuthority = (authority = trustedAuthorityBundle()) => {
  return ordinaryInput(authority)
}

const directTrustedAuthorityBundle = () => trustedAuthorityBundle('direct')

const directStackInput = () => {
  const input = promotionInput(directTrustedAuthorityBundle(), true)
  input.stack = {
    schema_version: 'stack-delivery-envelope/v1',
    stack_id: 'stack:parallel-delivery-1',
    trunk_ref: 'main',
    trunk_sha: sha('a'),
    selected_top_pr: input.candidate.pr_number,
    ordered_member_vector_digest: null,
    merge_action: 'direct_merge',
    merge_method: 'merge',
    members: [
      {
        pr_number: 42,
        node_id: 'prnode:node42',
        position: 1,
        head_ref: 'topic-a',
        head_sha: sha('b'),
        direct_base_ref: 'main',
        direct_base_sha: sha('a'),
        exact_head_packet_digest: digest('5'),
        checks_digest: digest('6'),
        independent_review_digest: digest('7'),
        e2e_required: false,
        e2e_result_digest: null,
        unresolved_finding_state: 'none',
      },
      {
        pr_number: 43,
        node_id: 'prnode:node43',
        position: 2,
        head_ref: 'topic-b',
        head_sha: sha('c'),
        direct_base_ref: 'topic-a',
        direct_base_sha: sha('b'),
        exact_head_packet_digest: digest('8'),
        checks_digest: digest('9'),
        independent_review_digest: digest('a'),
        e2e_required: false,
        e2e_result_digest: null,
        unresolved_finding_state: 'none',
      },
    ],
    expected_protection_digest: digest('b'),
    capability_reference: 'capability:direct-stack',
    deployment_target_reference: 'target:canonical-test',
    created_at: '2026-08-29T00:00:00.000Z',
    expires_at: '2026-08-29T01:00:00.000Z',
  }
  input.stack.ordered_member_vector_digest = digestCanonical(input.stack.members)
  return input
}

const boundHandoff = (input, authority) => promotionBridgeModule.createPromotionBridge({
  authorityUsePort: { rereadAndConsume: () => ({ cas_winner: true }) },
}).buildPromotionHandoff(input, authority)
const freezeFixture = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeFixture(nested)
    Object.freeze(value)
  }
  return value
}
const projectionFixtureHandoff = (input, authority) => {
  const { schema_version: ignoredSchemaVersion, ...candidate } = structuredClone(input)
  return freezeFixture({
    ...candidate,
    schema_version: 'parallel-delivery-fabric-promotion-handoff/v4',
    trusted_authority_bundle: structuredClone(authority),
  })
}
const buildOrdinaryHandoff = (input = ordinaryInput()) => projectionFixtureHandoff(input, trustedAuthorityBundle())
const buildDirectHandoff = (input = directStackInput()) => projectionFixtureHandoff(input, directTrustedAuthorityBundle())
const assertEvidenceHeld = (value, message = undefined) => assert.deepEqual(value, {
  phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_EVIDENCE_INVALID',
}, message)
const assertAuthorityHeld = (value, message = undefined) => assert.deepEqual(value, {
  phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_AUTHORITY_UNAVAILABLE',
}, message)

const signedDeliveryRecord = (handoff, name, record_type, payload, nonce) => {
  const producer = handoff.trusted_authority_bundle.payload.delivery_sources[name]
  return signedProducerRecord(handoff.trusted_authority_bundle, name, record_type, {
    identity: producer.expected_identity,
    correlation: candidateCorrelation(handoff.candidate),
    evidence_refs: structuredClone(handoff.candidate.evidence_refs),
    evidence_digest: handoff.candidate.evidence_digest,
    ...payload,
  }, nonce)
}

const hasValidPrecomputedRecordSignature = (authority, name, record) => {
  const producer = producerFor(authority, name)
  const key = createPublicKey({
    key: Buffer.from(producer.public_key_spki, 'base64'),
    format: 'der',
    type: 'spki',
  })
  const { signature, ...signedEnvelope } = record
  return verifyEd25519(
    null,
    Buffer.from(JSON.stringify(canonicalize(signedEnvelope)), 'utf8'),
    key,
    Buffer.from(signature, 'base64'),
  )
}

const directStackProjection = (handoff) => {
  const { stack } = handoff
  const request = {
    schema_version: 'direct-stack-request/v1',
    stack_id: stack.stack_id,
    repository: handoff.plan.repository,
    trunk_ref: stack.trunk_ref,
    trunk_sha: stack.trunk_sha,
    selected_top_pr: stack.selected_top_pr,
    expected_head_sha: stack.members.at(-1).head_sha,
    merge_action: stack.merge_action,
    merge_method: stack.merge_method,
    ordered_member_vector_digest: stack.ordered_member_vector_digest,
    members: structuredClone(stack.members),
    expected_protection_digest: stack.expected_protection_digest,
    capability_reference: stack.capability_reference,
    capability_state: 'enabled',
    deployment_target_reference: stack.deployment_target_reference,
    expected_state: {
      repository: handoff.plan.repository,
      trunk_ref: stack.trunk_ref,
      trunk_sha: stack.trunk_sha,
      selected_top_pr: stack.selected_top_pr,
      expected_head_sha: stack.members.at(-1).head_sha,
      ordered_member_vector_digest: stack.ordered_member_vector_digest,
      expected_protection_digest: stack.expected_protection_digest,
      capability_reference: stack.capability_reference,
      capability_state: 'enabled',
    },
    cas_precondition: {
      stack_id: stack.stack_id,
      repository: handoff.plan.repository,
      trunk_sha: stack.trunk_sha,
      selected_top_pr: stack.selected_top_pr,
      expected_head_sha: stack.members.at(-1).head_sha,
      ordered_member_vector_digest: stack.ordered_member_vector_digest,
      expected_protection_digest: stack.expected_protection_digest,
      capability_reference: stack.capability_reference,
    },
  }
  const request_digest = digestCanonical(request)
  const operation = {
    schema_version: 'direct-stack-operation/v1',
    operation_uuid: '123e4567-e89b-42d3-a456-426614174000',
    operation_reference: 'operation:stack-delivery-1',
    stack_id: stack.stack_id,
    repository: handoff.plan.repository,
    request_digest,
    expected_state_digest: digestCanonical(request.expected_state),
    ordered_member_vector_digest: stack.ordered_member_vector_digest,
    expected_head_sha: stack.members.at(-1).head_sha,
    expected_protection_digest: stack.expected_protection_digest,
    capability_reference: stack.capability_reference,
  }
  return {
    operation,
    request,
    frozen_vector: structuredClone(stack.members),
    outcome: {
      phase: 'CLOSED',
      internal_state: 'STACK_DELIVERY_VERIFIED',
      stack_id: stack.stack_id,
      repository: handoff.plan.repository,
      request_digest,
      operation: structuredClone(operation),
      stack_result_merge_commit_sha: sha('d'),
      deployed_commit_sha: sha('d'),
      group_verification_digest: digest('c'),
    },
  }
}

const directStackTask7Replay = (handoff, deploymentOverrides = {}) => {
  const { stack } = handoff
  const observed_at = '2026-08-29T02:10:00.000Z'
  const observation = {
    schema_version: 'direct-stack-observation/v1',
    observed_at,
    repository: handoff.plan.repository,
    trunk_ref: stack.trunk_ref,
    trunk_sha: stack.trunk_sha,
    protection_digest: stack.expected_protection_digest,
    capability_reference: stack.capability_reference,
    capability_state: 'enabled',
    chain: stack.members.map((member) => ({ ...member, repository: handoff.plan.repository, merged: false })),
  }
  const plan = planDirectStackDispatch({
    stack: structuredClone(stack),
    repository: handoff.plan.repository,
    // Reconstruct the immutable pre-validity-window fixture bytes so their
    // detached signatures remain independently verifiable. The replay keeps
    // the real 02:10 observation below and must now project HELD because the
    // stack envelope expired at 01:00.
    observation: { ...observation, observed_at: '2026-08-29T00:10:00.000Z' },
  })
  const operation = {
    schema_version: 'direct-stack-operation/v1',
    operation_uuid: '123e4567-e89b-42d3-a456-426614174000',
    operation_reference: 'operation:task7-replay-43',
    stack_id: plan.frozen_stack.stack_id,
    repository: plan.repository,
    request_digest: plan.request_digest,
    expected_state_digest: digestCanonical(plan.request.expected_state),
    ordered_member_vector_digest: plan.frozen_stack.ordered_member_vector_digest,
    expected_head_sha: plan.request.expected_head_sha,
    expected_protection_digest: plan.request.expected_protection_digest,
    capability_reference: plan.request.capability_reference,
  }
  const response = { status: 202, operation }
  const accepted = reduceDirectStackDispatch({ plan, response })
  const result = sha('e')
  const poll = {
    schema_version: 'direct-stack-poll/v1',
    status: 'succeeded',
    observed_at,
    stack_id: plan.frozen_stack.stack_id,
    repository: plan.repository,
    request_digest: plan.request_digest,
    operation: structuredClone(accepted.operation),
    member_vector_digest: plan.frozen_stack.ordered_member_vector_digest,
    members: plan.frozen_stack.members.map((member) => ({
      ...member,
      merged: true,
      frozen_head_sha: member.head_sha,
      reported_merge_commit_sha: result,
    })),
    stack_result_merge_commit_sha: result,
    fresh_origin_main: {
      schema_version: 'origin-main-observation/v1',
      observed_at,
      source_reference: handoff.trusted_authority_bundle.payload.delivery_sources.origin_main.source.source_reference,
      repository: plan.repository,
      trunk_ref: stack.trunk_ref,
      commit_sha: result,
      authoritative: true,
    },
    ancestry: plan.frozen_stack.members.map((member) => ({
      node_id: member.node_id,
      ancestor_sha: member.head_sha,
      descendant_sha: result,
      reachable: true,
      proof_digest: digest('7'),
    })),
  }
  const merged = reduceDirectStackPoll({ plan, accepted, poll })
  const deployment = {
    schema_version: 'stack-deployment-observation/v1',
    observed_at: '2026-08-29T02:15:00.000Z',
    stack_id: merged.stack_id,
    repository: merged.repository,
    request_digest: merged.request_digest,
    operation: structuredClone(merged.operation),
    frozen_vector_digest: merged.frozen_vector_digest,
    stack_result_merge_commit_sha: merged.stack_result_merge_commit_sha,
    deployment_target_reference: merged.request.deployment_target_reference,
    command_state: 'completed',
    deployed_commit_sha: merged.stack_result_merge_commit_sha,
    post_deploy_status: 'passed',
    group_verification_digest: digest('8'),
    ...deploymentOverrides,
  }
  const sources = handoff.trusted_authority_bundle.payload.delivery_sources
  const task7_replay = {
    correlation: candidateCorrelation(handoff.candidate),
    evidence_refs: structuredClone(handoff.candidate.evidence_refs),
    evidence_digest: handoff.candidate.evidence_digest,
    observation,
    plan,
    response,
    accepted,
    poll,
    merged,
    deployment,
    source_attestations: {
      ancestry: signedDeliveryRecord(handoff, 'ancestry', 'delivery_ancestry', {
        ...sources.ancestry.source,
        repository: merged.repository,
        stack_id: merged.stack_id,
        commit_sha: merged.stack_result_merge_commit_sha,
        frozen_vector_digest: merged.frozen_vector_digest,
        proof_digests: merged.ancestry.map((proof) => proof.proof_digest),
      }, 'nonce:ancestry-direct'),
      origin_main: signedDeliveryRecord(handoff, 'origin_main', 'delivery_origin_main', {
        ...sources.origin_main.source,
        observed_at: merged.fresh_origin_main.observed_at,
        repository: merged.repository,
        trunk_ref: merged.fresh_origin_main.trunk_ref,
        commit_sha: merged.stack_result_merge_commit_sha,
        authoritative: true,
      }, 'nonce:origin-main-direct'),
      deployment: signedDeliveryRecord(handoff, 'deployment', 'delivery_deployment', {
        ...sources.deployment.source,
        observed_at: deployment.observed_at,
        repository: merged.repository,
        deployment_target_reference: deployment.deployment_target_reference,
        command_state: deployment.command_state,
        deployed_commit_sha: deployment.deployed_commit_sha,
        post_deploy_status: deployment.post_deploy_status,
        group_verification_digest: deployment.group_verification_digest,
      }, 'nonce:deployment-direct'),
      postverify: signedDeliveryRecord(handoff, 'postverify', 'delivery_postverify', {
        ...sources.postverify.source,
        observed_at: deployment.observed_at,
        repository: merged.repository,
        deployed_commit_sha: deployment.deployed_commit_sha,
        status: deployment.post_deploy_status,
        verification_digest: deployment.group_verification_digest,
      }, 'nonce:postverify-direct'),
    },
  }
  return signedDeliveryRecord(handoff, 'direct_stack_replay', 'direct_stack_replay', {
    task7_replay,
  }, 'nonce:direct-replay')
}

const ordinaryProjection = (handoff) => {
  const observed_at = '2026-08-29T02:00:00.000Z'
  const merge_commit_sha = sha('d')
  const observation = {
    schema_version: 'ordinary-delivery-observation/v1',
    observed_at,
    repository: handoff.plan.repository,
    pr_number: handoff.candidate.pr_number,
    head_sha: handoff.candidate.head_sha,
    merge_commit_sha,
    fresh_origin_main: {
      schema_version: 'origin-main-observation/v1',
      observed_at,
      source_reference: 'origin:main',
      repository: handoff.plan.repository,
      trunk_ref: 'main',
      commit_sha: merge_commit_sha,
      authoritative: true,
    },
    deployed_commit_sha: merge_commit_sha,
    head_reachable: true,
    head_reachability_digest: digest('7'),
    post_deploy_verified: true,
    post_deploy_verification_digest: digest('8'),
  }
  return {
    correlation: candidateCorrelation(handoff.candidate),
    evidence_refs: structuredClone(handoff.candidate.evidence_refs),
    evidence_digest: handoff.candidate.evidence_digest,
    observation,
    outcome: {
      phase: 'CLOSED',
      internal_state: 'ORDINARY_DELIVERY_VERIFIED',
      repository: observation.repository,
      pr_number: observation.pr_number,
      head_sha: observation.head_sha,
      merge_commit_sha: observation.merge_commit_sha,
      fresh_origin_main: structuredClone(observation.fresh_origin_main),
      deployed_commit_sha: observation.deployed_commit_sha,
      head_reachability_digest: observation.head_reachability_digest,
      post_deploy_verification_digest: observation.post_deploy_verification_digest,
    },
  }
}

const ordinaryDeliveryProof = (handoff) => {
  const observed_at = '2026-08-29T02:20:00.000Z'
  const merge_commit_sha = sha('e')
  const sources = handoff.trusted_authority_bundle.payload.delivery_sources
  const observation = {
    schema_version: 'ordinary-delivery-observation/v1',
    observed_at,
    repository: handoff.plan.repository,
    pr_number: handoff.candidate.pr_number,
    head_sha: handoff.candidate.head_sha,
    merge_commit_sha,
    fresh_origin_main: {
      schema_version: 'origin-main-observation/v1',
      observed_at,
      source_reference: sources.origin_main.source.source_reference,
      repository: handoff.plan.repository,
      trunk_ref: 'main',
      commit_sha: merge_commit_sha,
      authoritative: true,
    },
    deployed_commit_sha: merge_commit_sha,
    head_reachable: true,
    head_reachability_digest: digest('7'),
    post_deploy_verified: true,
    post_deploy_verification_digest: digest('8'),
  }
  const source_attestations = {
    ancestry: signedDeliveryRecord(handoff, 'ancestry', 'delivery_ancestry', {
      ...sources.ancestry.source,
      repository: observation.repository,
      pr_number: observation.pr_number,
      head_sha: observation.head_sha,
      merge_commit_sha,
      reachable: true,
      proof_digest: observation.head_reachability_digest,
    }, 'nonce:ancestry-ordinary'),
    origin_main: signedDeliveryRecord(handoff, 'origin_main', 'delivery_origin_main', {
      ...sources.origin_main.source,
      observed_at,
      repository: observation.repository,
      trunk_ref: 'main',
      commit_sha: merge_commit_sha,
      authoritative: true,
    }, 'nonce:origin-main-ordinary'),
    deployment: signedDeliveryRecord(handoff, 'deployment', 'delivery_deployment', {
      ...sources.deployment.source,
      observed_at,
      repository: observation.repository,
      deployed_commit_sha: merge_commit_sha,
      command_state: 'completed',
      post_deploy_status: 'passed',
    }, 'nonce:deployment-ordinary'),
    postverify: signedDeliveryRecord(handoff, 'postverify', 'delivery_postverify', {
      ...sources.postverify.source,
      observed_at,
      repository: observation.repository,
      deployed_commit_sha: merge_commit_sha,
      status: 'passed',
      verification_digest: observation.post_deploy_verification_digest,
    }, 'nonce:postverify-ordinary'),
  }
  return signedDeliveryRecord(handoff, 'ordinary_replay', 'ordinary_replay', {
    observation,
    source_attestations,
  }, 'nonce:ordinary-replay')
}

const failedDirectStackOutcome = (direct_stack) => ({
  phase: 'CLOSED',
  internal_state: 'STACK_DELIVERY_FAILED',
  admission_state: 'FROZEN',
  stack_id: direct_stack.request.stack_id,
  repository: direct_stack.request.repository,
  request_digest: digestCanonical(direct_stack.request),
  operation: structuredClone(direct_stack.operation),
  frozen_vector_digest: direct_stack.request.ordered_member_vector_digest,
  stack_result_merge_commit_sha: sha('d'),
  repair_revert_lineage: {
    source_stack_id: direct_stack.request.stack_id,
    failed_stack_result_merge_commit_sha: sha('d'),
    required_new_exact_head: true,
    allowed_successor_kinds: ['repair', 'revert'],
    physical_rollback_claim: 'none',
  },
})

test('AC-32 — ordinary handoff binds the candidate exact tuple to an immutable external packet', () => {
  const input = ordinaryInput()
  const authority = trustedAuthorityBundle()
  const handoff = projectionFixtureHandoff(input, authority)
  const ordinary = ordinaryDeliveryProof(handoff)

  assert.equal(handoff.handoff_kind, 'ordinary_single_pr')
  assert.deepEqual(handoff.plan, input.plan)
  assert.deepEqual(handoff.candidate, input.candidate)
  assert.equal(handoff.trusted_authority_bundle.issuer.issuer_id, 'issuer:promotion-control-plane')
  assert.equal(handoff.independent_review.payload.evidence_digest, input.candidate.evidence_digest)
  assert.equal(handoff.computer_use_verifier.payload.evidence_digest, input.candidate.evidence_digest)
  assert.equal(handoff.binder.payload.evidence_ref, 'evidence:binder-42')
  assert.equal(handoff.check_run.payload.source.check_name, 'monkey1sai-codex/ready')
  assert.equal(Object.isFrozen(handoff), true)
  assert.equal(Object.isFrozen(handoff.candidate), true)

  assert.deepEqual(projectPromotionTerminal({ handoff, ordinary }, authority), {
    phase: 'CLOSED',
    terminal_class: 'DELIVERED',
    reason_code: 'DELIVERY_VERIFIED',
  })

  const tupleTamper = structuredClone(handoff)
  tupleTamper.candidate.head_sha = sha('f')
  assertEvidenceHeld(projectPromotionTerminal({ handoff: tupleTamper, ordinary }, authority))

  const authorityTamper = structuredClone(handoff)
  authorityTamper.trusted_authority_bundle.bundle_id = 'bundle:promotion-forged'
  assertEvidenceHeld(projectPromotionTerminal({ handoff: authorityTamper, ordinary }, authority))
})

test('Task9C A P0 — a signed authority bundle still cannot activate the public handoff seam locally', () => {
  const authority = trustedAuthorityBundle()
  const input = canonicalInputForAuthority(authority)

  const handoff = boundHandoff(input, authority)

  assertAuthorityHeld(handoff)
})

test('Task9C A P0 GREEN — legacy ACTIVE, unsigned/self-signed, envelope mutation, and coordinated payload substitution never replace the signed authority bundle', () => {
  const authority = trustedAuthorityBundle()
  const baseline = ordinaryInput(authority)
  assertAuthorityHeld(boundHandoff(baseline, authority))

  const legacyActive = {
    schema_version: 'parallel-delivery-fabric-trusted-activation/v1',
    phase: 'ACTIVE',
  }
  assertAuthorityHeld(buildPromotionHandoff(ordinaryInput(), legacyActive), 'legacy ACTIVE authority is not a bundle')

  const unsigned = structuredClone(authority)
  delete unsigned.signature
  assertAuthorityHeld(buildPromotionHandoff(ordinaryInput(), unsigned), 'signature is mandatory')

  const keyInjection = structuredClone(authority)
  keyInjection.public_key_spki = PROMOTION_AUTHORITY_PUBLIC_KEY_SPKI
  assertAuthorityHeld(buildPromotionHandoff(ordinaryInput(), keyInjection), 'caller cannot inject the verification key')

  const envelopeMutation = structuredClone(authority)
  envelopeMutation.freshness.expires_at = '2099-01-01T00:00:00.000Z'
  assertAuthorityHeld(buildPromotionHandoff(ordinaryInput(), envelopeMutation), 'freshness is inside signed bytes')

  const sourceMutation = structuredClone(authority)
  sourceMutation.source.source_ref = 'base:forged-authority-source'
  assertAuthorityHeld(buildPromotionHandoff(ordinaryInput(), sourceMutation), 'authority source is inside signed bytes')

  const coordinatedPayloadMutation = structuredClone(authority)
  coordinatedPayloadMutation.payload.activation_record.phase = 'ACTIVE'
  coordinatedPayloadMutation.payload.activation_record.external_app_id = 999999
  coordinatedPayloadMutation.payload_digest = digestCanonical(coordinatedPayloadMutation.payload)
  assertAuthorityHeld(
    buildPromotionHandoff(ordinaryInput(coordinatedPayloadMutation), coordinatedPayloadMutation),
    'candidate observation cannot jointly rewrite the signed payload',
  )

  assertAuthorityHeld(buildPromotionHandoff(ordinaryInput(), trustedAuthorityBundle('stale')), 'signed stale bundle is unavailable')
  assertAuthorityHeld(buildPromotionHandoff(ordinaryInput(), trustedAuthorityBundle('revoked')), 'signed revoked bundle is unavailable')
})

test('Task9C B P0 RED — an otherwise valid activation cannot accept synchronously forged review, Computer Use, and binder source pins', () => {
  const authority = trustedAuthorityBundle()
  const input = ordinaryInput(authority)
  input.independent_review.payload.source = authoritySourcePin(
    'issuer:forged-review', 'base:forged-review', sha('9'), digest('9'), input.candidate.base_sha,
  )
  input.computer_use_verifier.payload.source = authoritySourcePin(
    'issuer:forged-computer-use', 'base:forged-computer-use', sha('8'), digest('8'), input.candidate.base_sha,
  )
  input.binder.payload.source = authoritySourcePin(
    'issuer:forged-binder', 'base:forged-binder', sha('7'), digest('7'), input.candidate.base_sha,
  )

  assertEvidenceHeld(boundHandoff(input, authority))
})

test('Task9C B P0 GREEN — every signed producer, CheckRun publisher, and delivery source pin is exact-bound before handoff or terminal projection', () => {
  const authority = trustedAuthorityBundle()
  const producerRecords = [
    ['independent review', 'independent_review'],
    ['Computer Use verifier', 'computer_use_verifier'],
    ['Task8 binder', 'binder'],
  ]
  const forgedValues = {
    issuer: 'issuer:forged-source',
    source_ref: 'base:forged-source',
    source_sha: sha('9'),
    source_digest: digest('9'),
  }
  for (const [label, recordName] of producerRecords) {
    for (const [field, forgedValue] of Object.entries(forgedValues)) {
      const input = ordinaryInput(authority)
      input[recordName].payload.source[field] = forgedValue
      assertEvidenceHeld(boundHandoff(input, authority), `${label} ${field} is pinned by the bundle`)
    }
  }

  for (const mutate of [
    (input) => { delete input.binder.payload.source },
    (input) => { input.binder.payload.source.fresh = false },
    (input) => { input.binder.payload.source.revoked = true },
    (input) => { input.binder.payload.source.issuer = 'issuer:forged-task8-binder' },
  ]) {
    const input = ordinaryInput(authority)
    mutate(input)
    assertEvidenceHeld(boundHandoff(input, authority), 'missing/stale/revoked/wrong Task8 binder source is held')
  }

  for (const [field, forgedValue] of Object.entries(forgedValues)) {
    const input = ordinaryInput(authority)
    input.check_run.payload.source[field] = forgedValue
    assertEvidenceHeld(boundHandoff(input, authority), `CheckRun publisher ${field} is pinned by the bundle`)
  }
  const wrongCheckPublisher = ordinaryInput(authority)
  wrongCheckPublisher.check_run.payload.publisher_issuer = 'issuer:forged-checkrun-publisher'
  assertEvidenceHeld(boundHandoff(wrongCheckPublisher, authority), 'CheckRun publisher issuer is pinned by the bundle')

  const ordinaryHandoff = buildOrdinaryHandoff()
  for (const [field, forgedValue] of Object.entries({
    issuer: 'issuer:forged-delivery',
    source_reference: 'source:forged-delivery',
    source_sha: sha('9'),
    source_digest: digest('9'),
  })) {
    const ordinary = ordinaryDeliveryProof(ordinaryHandoff)
    ordinary.payload.source_attestations.postverify.payload[field] = forgedValue
    assertEvidenceHeld(
      projectPromotionTerminal({ handoff: ordinaryHandoff, ordinary }, trustedAuthorityBundle()),
      `ordinary delivery ${field} is pinned by the bundle`,
    )
  }

  const directHandoff = buildDirectHandoff()
  const direct = directStackTask7Replay(directHandoff)
  direct.payload.task7_replay.source_attestations.ancestry.payload.source_sha = sha('9')
  assertEvidenceHeld(
    projectPromotionTerminal({ handoff: directHandoff, direct_stack: direct }, directTrustedAuthorityBundle()),
    'direct delivery source SHA is pinned by the bundle',
  )
})

test('Task9D D1 P0 GREEN — root-pinned producer envelopes admit only their precomputed signer attestations', () => {
  const authority = trustedAuthorityBundle()
  const input = ordinaryInput(authority)

  assertAuthorityHeld(boundHandoff(input, authority))

  const handwrittenSuccess = structuredClone(input)
  handwrittenSuccess.independent_review.signature = Buffer.alloc(64).toString('base64')
  assertEvidenceHeld(
    boundHandoff(handwrittenSuccess, authority),
    'a copied root pin and a handcrafted clear verdict do not replace the producer signature',
  )
})

test('Task9D D1 — precomputed fixture records verify against only their root-pinned producer keys', () => {
  const ordinaryHandoff = buildOrdinaryHandoff()
  const ordinary = ordinaryDeliveryProof(ordinaryHandoff)
  const directHandoff = buildDirectHandoff()
  const direct = directStackTask7Replay(directHandoff)
  const vectors = [
    ['ordinary independent review', ordinaryHandoff.trusted_authority_bundle, 'independent_review', ordinaryHandoff.independent_review],
    ['ordinary Computer Use verifier', ordinaryHandoff.trusted_authority_bundle, 'computer_use_verifier', ordinaryHandoff.computer_use_verifier],
    ['ordinary binder', ordinaryHandoff.trusted_authority_bundle, 'binder', ordinaryHandoff.binder],
    ['ordinary CheckRun', ordinaryHandoff.trusted_authority_bundle, 'checkrun_publisher', ordinaryHandoff.check_run],
    ['ordinary outer replay', ordinaryHandoff.trusted_authority_bundle, 'ordinary_replay', ordinary],
    ...Object.entries(ordinary.payload.source_attestations).map(([name, record]) => [`ordinary ${name}`, ordinaryHandoff.trusted_authority_bundle, name, record]),
    ['direct outer replay', directHandoff.trusted_authority_bundle, 'direct_stack_replay', direct],
    ...Object.entries(direct.payload.task7_replay.source_attestations).map(([name, record]) => [`direct ${name}`, directHandoff.trusted_authority_bundle, name, record]),
  ]
  for (const [label, authority, name, record] of vectors) {
    assert.equal(hasValidPrecomputedRecordSignature(authority, name, record), true, label)
  }
})

test('Task9B A P0 RED — a coupled candidate authority, CheckRun source, and publisher forgery cannot replace the coordinator trust root', () => {
  const authority = trustedAuthorityBundle()
  const input = ordinaryInput(authority)
  const forgedSource = {
    app_slug: 'monkey1sai-codex',
    app_id: 999999,
    check_name: 'monkey1sai-codex/ready',
    publisher_issuer: 'issuer:forged-app',
    ...authoritySourcePin('issuer:forged-app', 'base:forged-app-source', sha('9'), digest('9'), input.candidate.base_sha),
  }
  input.observed_activation.external_app_id = 999999
  input.check_run.payload.source = structuredClone(forgedSource)
  input.check_run.payload.publisher_issuer = 'issuer:forged-app'
  input.roles.checkrun_publisher.identity = 'session:forged-publisher'
  input.check_run.payload.publisher_identity = 'session:forged-publisher'

  assertEvidenceHeld(boundHandoff(input, authority))
})

test('AC-13/25 — every generation, scope, lease, context, worktree, evidence, and authority proof is mandatory', () => {
  const cases = [
    ['missing plan generation', (input) => { delete input.plan.generation }],
    ['missing candidate scope', (input) => { delete input.candidate.scope_digest }],
    ['missing candidate lease', (input) => { delete input.candidate.lease_id }],
    ['missing execution context', (input) => { delete input.candidate.execution_context_id }],
    ['missing worktree identity', (input) => { delete input.candidate.worktree_id }],
    ['missing worktree digest', (input) => { delete input.candidate.worktree_path_digest }],
    ['missing evidence references', (input) => { delete input.candidate.evidence_refs }],
    ['missing self-diagnostic evidence', (input) => { delete input.self_diagnostic.evidence_digest }],
    ['missing observed activation', (input) => { delete input.observed_activation }],
    ['wrong observed activation policy', (input) => { input.observed_activation.policy_digest = digest('9') }],
    ['unbounded reviewer extension', (input) => { input.independent_review.payload.untrusted_extra = true }],
  ]

  for (const [name, mutate] of cases) {
    const input = ordinaryInput()
    mutate(input)
    assertEvidenceHeld(boundHandoff(input, trustedAuthorityBundle()), name)
  }
})

test('AC-33 — every promotion role is identity-separated and capability-closed', () => {
  const collidingReviewer = ordinaryInput()
  collidingReviewer.roles.independent_reviewer.identity = collidingReviewer.roles.writer.identity
  assertEvidenceHeld(boundHandoff(collidingReviewer, trustedAuthorityBundle()))

  const candidateOwnedPublisher = ordinaryInput()
  candidateOwnedPublisher.roles.checkrun_publisher.identity = candidateOwnedPublisher.candidate.owner_identity
  assertEvidenceHeld(boundHandoff(candidateOwnedPublisher, trustedAuthorityBundle()))

  const widenedPublisher = ordinaryInput()
  widenedPublisher.roles.checkrun_publisher.capabilities.push('merge_exact_head')
  assertEvidenceHeld(boundHandoff(widenedPublisher, trustedAuthorityBundle()))

  const selfReview = ordinaryInput()
  selfReview.self_diagnostic.verdict = 'clear'
  assertEvidenceHeld(boundHandoff(selfReview, trustedAuthorityBundle()))

  const candidateReview = ordinaryInput()
  candidateReview.independent_review.payload.identity = candidateReview.candidate.owner_identity
  assertEvidenceHeld(boundHandoff(candidateReview, trustedAuthorityBundle()))
})

test('AC-34 — only a complete prior-pinned monkey1sai-codex exact-head success check can enter a handoff', () => {
  const cases = [
    ['wrong app slug', (input) => { input.check_run.payload.source.app_slug = 'other-check-app' }],
    ['wrong app id', (input) => { input.check_run.payload.source.app_id += 1 }],
    ['wrong source SHA', (input) => { input.check_run.payload.source.source_sha = sha('9') }],
    ['wrong check name', (input) => { input.check_run.payload.source.check_name = 'monkey1sai-codex/other' }],
    ['wrong check head', (input) => { input.check_run.payload.head_sha = sha('9') }],
    ['neutral conclusion', (input) => { input.check_run.payload.conclusion = 'neutral' }],
    ['skipped conclusion', (input) => { input.check_run.payload.conclusion = 'skipped' }],
    ['timeout conclusion', (input) => { input.check_run.payload.conclusion = 'timed_out' }],
    ['incomplete check', (input) => { input.check_run.payload.status = 'in_progress' }],
    ['partial pagination', (input) => { input.check_run.payload.pagination.complete = false }],
    ['missing pagination page', (input) => { input.check_run.payload.pagination.observed_pages = 0 }],
    ['ambiguous review verdict', (input) => { input.independent_review.payload.verdict = 'ambiguous' }],
    ['unresolved finding', (input) => { input.independent_review.payload.unresolved_findings = 1 }],
    ['partial review pagination', (input) => { input.independent_review.payload.pagination.observed_count = 0 }],
  ]

  for (const [name, mutate] of cases) {
    const input = ordinaryInput()
    mutate(input)
    assertEvidenceHeld(boundHandoff(input, trustedAuthorityBundle()), name)
  }
})

test('AC-33 — the published CheckRun must bind its own identity, never just a detached role declaration', () => {
  const missingPublisher = ordinaryInput()
  delete missingPublisher.check_run.payload.publisher_identity
  assertEvidenceHeld(boundHandoff(missingPublisher, trustedAuthorityBundle()))
  const candidateOwnedPublisher = ordinaryInput()
  candidateOwnedPublisher.check_run.payload.publisher_identity = candidateOwnedPublisher.candidate.owner_identity
  assertEvidenceHeld(boundHandoff(candidateOwnedPublisher, trustedAuthorityBundle()))
})

test('AC-35 — recursive secret, raw host-identity, transcript, and external-sink inputs are rejected before handoff', () => {
  const cases = [
    ['embedded token', (input) => { input.candidate.evidence_refs[0] = 'evidence:ghp_abcdefghijklmnop' }],
    ['raw environment', (input) => { input.plan.raw_env = 'DATABASE_URL=value' }],
    ['raw SID', (input) => { input.candidate.execution_context_id = 'S-1-5-21-1001' }],
    ['raw PID', (input) => { input.candidate.execution_context_id = '12345' }],
    ['transcript', (input) => { input.independent_review.payload.transcript = 'private discussion' }],
    ['embedded role PID', (input) => {
      input.roles.self_diagnostic.identity = 'session:12345'
      input.self_diagnostic.identity = input.roles.self_diagnostic.identity
    }],
  ]
  for (const [name, mutate] of cases) {
    const input = ordinaryInput()
    mutate(input)
    assertEvidenceHeld(boundHandoff(input, trustedAuthorityBundle()), name)
  }

  let externalSinkCalls = 0
  const sinkAttempt = ordinaryInput()
  sinkAttempt.external_sink = () => { externalSinkCalls += 1 }
  assertEvidenceHeld(boundHandoff(sinkAttempt, trustedAuthorityBundle()))
  assert.equal(externalSinkCalls, 0)
})

test('AC-32 — direct-stack handoff carries one frozen, ordered member vector', () => {
  const input = directStackInput()

  const handoff = buildDirectHandoff(input)

  assert.equal(handoff.handoff_kind, 'direct_stack_vector')
  assert.equal(handoff.stack.stack_id, input.stack.stack_id)
  assert.equal(handoff.stack.selected_top_pr, input.candidate.pr_number)
  assert.equal(handoff.stack.members.at(-1).head_sha, input.candidate.head_sha)
  assert.equal(handoff.stack.ordered_member_vector_digest, digestCanonical(handoff.stack.members))
  assert.equal(Object.isFrozen(handoff.stack), true)
  assert.equal(Object.isFrozen(handoff.stack.members), true)
})

test('AC-42 — an otherwise complete Task7 replay is held after its frozen stack envelope expires', () => {
  const handoff = buildDirectHandoff()
  const direct_stack = directStackTask7Replay(handoff)

  const terminal = projectPromotionTerminal({ handoff, direct_stack }, directTrustedAuthorityBundle())

  assertEvidenceHeld(terminal)
  assert.equal(Object.isFrozen(terminal), true)
  assertEvidenceHeld(projectPromotionTerminal(
    { handoff, direct_stack: { internal_state: 'STACK_DELIVERY_VERIFIED' } },
    directTrustedAuthorityBundle(),
  ))
})

test('Task9B B P0 RED — a hand-written STACK_DELIVERY_VERIFIED packet without a Task7 replay is held', () => {
  const handoff = buildDirectHandoff()
  const manual = directStackProjection(handoff)

  assert.deepEqual(
    projectPromotionTerminal({ handoff, direct_stack: manual }, directTrustedAuthorityBundle()),
    {
      phase: 'CLOSED',
      terminal_class: 'HELD',
      reason_code: 'PREMERGE_EVIDENCE_INVALID',
    },
  )
})

test('Task9B B P0 GREEN — a full Task7 reducer replay cannot outlive its signed stack envelope', () => {
  const handoff = buildDirectHandoff()
  const direct_stack = directStackTask7Replay(handoff)

  assertEvidenceHeld(projectPromotionTerminal({ handoff, direct_stack }, directTrustedAuthorityBundle()))
})

test('Task9B B P0 — ordinary delivery rejects a forged source-pinned ancestry, fresh-main, deployment, or postverify proof', () => {
  const handoff = buildOrdinaryHandoff()
  const ordinary = ordinaryDeliveryProof(handoff)
  ordinary.payload.source_attestations.deployment.payload.source_digest = digest('9')

  assert.deepEqual(
    projectPromotionTerminal({ handoff, ordinary }, trustedAuthorityBundle()),
    {
      phase: 'CLOSED',
      terminal_class: 'HELD',
      reason_code: 'PREMERGE_EVIDENCE_INVALID',
    },
  )
  const arbitraryDigest = ordinaryDeliveryProof(handoff)
  arbitraryDigest.payload.observation.post_deploy_verification_digest = digest('9')
  assertEvidenceHeld(projectPromotionTerminal({ handoff, ordinary: arbitraryDigest }, trustedAuthorityBundle()))
})

test('Task9B B P0 GREEN — ordinary delivery uses full independently source-pinned proof before Task7 verification', () => {
  const handoff = buildOrdinaryHandoff()
  const ordinary = ordinaryDeliveryProof(handoff)

  assert.deepEqual(
    projectPromotionTerminal({ handoff, ordinary }, trustedAuthorityBundle()),
    {
      phase: 'CLOSED',
      terminal_class: 'DELIVERED',
      reason_code: 'DELIVERY_VERIFIED',
    },
  )
})

test('Task9B C P1 — a candidate cannot be reused under a different plan generation or evidence-ref set', () => {
  const input = ordinaryInput()
  input.plan.generation = 999

  assertEvidenceHeld(boundHandoff(input, trustedAuthorityBundle()))
})

test('Task9B C P1 GREEN — plan, candidate, review, verifier, binder, CheckRun, and delivery evidence share one exact tuple and closed ref set', () => {
  const cases = [
    ['candidate plan reuse', (input) => { input.candidate.plan_id = 'plan:reused' }],
    ['candidate repository identity drift', (input) => { input.candidate.repo_identity_digest = digest('9') }],
    ['candidate tuple reuse', (input) => { input.candidate.head_sha = sha('9') }],
    ['review evidence-ref swap', (input) => { input.independent_review.payload.evidence_ref = 'evidence:swapped' }],
    ['verifier evidence digest swap', (input) => { input.computer_use_verifier.payload.evidence_digest = digest('9') }],
    ['binder correlation swap', (input) => { input.binder.payload.correlation.generation = 2 }],
    ['CheckRun correlation swap', (input) => { input.check_run.payload.correlation.tuple_digest = digest('9') }],
    ['candidate evidence-ref order swap', (input) => { input.candidate.evidence_refs.reverse() }],
  ]
  for (const [name, mutate] of cases) {
    const input = ordinaryInput()
    mutate(input)
    assertEvidenceHeld(boundHandoff(input, trustedAuthorityBundle()), name)
  }

  const handoff = buildDirectHandoff()
  const direct_stack = directStackTask7Replay(handoff)
  direct_stack.payload.task7_replay.evidence_refs = [...direct_stack.payload.task7_replay.evidence_refs, 'evidence:swapped']
  assert.deepEqual(projectPromotionTerminal({ handoff, direct_stack }, directTrustedAuthorityBundle()), {
    phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_EVIDENCE_INVALID',
  })
})

test('Task9B D P2 RED — exported build and project boundaries never throw for malformed or throwing proxy input', () => {
  const throwing = new Proxy({}, {
    ownKeys: () => { throw new Error('hostile-own-keys') },
  })
  let buildResult
  let projectResult

  assert.doesNotThrow(() => { buildResult = buildPromotionHandoff(throwing, trustedAuthorityBundle()) })
  assert.doesNotThrow(() => { projectResult = projectPromotionTerminal(throwing, trustedAuthorityBundle()) })
  assert.deepEqual(buildResult, {
    phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_EVIDENCE_INVALID',
  })
  assert.deepEqual(projectResult, {
    phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_EVIDENCE_INVALID',
  })
})

test('Task9B D P2 GREEN — public boundaries sanitize get/ownKeys/private/unknown failures, preserve zero-sink behavior, and classify unavailable authority', () => {
  const throwingGetter = {}
  Object.defineProperty(throwingGetter, 'schema_version', {
    enumerable: true,
    get: () => { throw new Error('hostile-getter') },
  })
  let externalSinkCalls = 0
  const privateInput = ordinaryInput()
  privateInput.candidate.secret = 'redacted'
  const unknownInput = ordinaryInput()
  unknownInput.external_sink = () => { externalSinkCalls += 1 }
  const cases = [throwingGetter, privateInput, unknownInput, { unknown: true }]
  for (const candidate of cases) {
    let result
    assert.doesNotThrow(() => { result = buildPromotionHandoff(candidate, trustedAuthorityBundle()) })
    assertEvidenceHeld(result)
    assert.equal(Object.isFrozen(result), true)
    assert.deepEqual(Object.keys(result).sort(), ['phase', 'reason_code', 'terminal_class'])
  }
  assert.equal(externalSinkCalls, 0)

  const unavailableAuthority = new Proxy({}, { ownKeys: () => { throw new Error('hostile-authority') } })
  const authorityResult = buildPromotionHandoff(ordinaryInput(), unavailableAuthority)
  assert.deepEqual(authorityResult, {
    phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_AUTHORITY_UNAVAILABLE',
  })

  const handoff = buildOrdinaryHandoff()
  let projectResult
  assert.doesNotThrow(() => {
    projectResult = projectPromotionTerminal({ handoff, ordinary: { unknown: true } }, trustedAuthorityBundle())
  })
  assertEvidenceHeld(projectResult)
  assert.equal(externalSinkCalls, 0)
})

test('AC-32 — ordinary projection requires the full exact-head merge, fresh-main, and deployment observation', () => {
  const handoff = buildOrdinaryHandoff()
  const ordinary = ordinaryDeliveryProof(handoff)

  assert.deepEqual(projectPromotionTerminal({ handoff, ordinary }, trustedAuthorityBundle()), {
    phase: 'CLOSED',
    terminal_class: 'DELIVERED',
    reason_code: 'DELIVERY_VERIFIED',
  })
})

test('AC-14/42 — the external projector emits only CLOSED DELIVERED, FAILED, or HELD terminals from reducer-derived evidence', () => {
  const handoff = buildDirectHandoff()
  const delivered = directStackTask7Replay(handoff)
  assertEvidenceHeld(projectPromotionTerminal({ handoff, direct_stack: delivered }, directTrustedAuthorityBundle()))
  const wrongDelivered = structuredClone(delivered)
  wrongDelivered.payload.task7_replay.deployment.deployed_commit_sha = sha('f')
  assertEvidenceHeld(projectPromotionTerminal({ handoff, direct_stack: wrongDelivered }, directTrustedAuthorityBundle()))
  const arbitraryDigest = directStackTask7Replay(handoff)
  arbitraryDigest.payload.task7_replay.deployment.group_verification_digest = digest('9')
  assertEvidenceHeld(projectPromotionTerminal({ handoff, direct_stack: arbitraryDigest }, directTrustedAuthorityBundle()))

  const failed = directStackTask7Replay(handoff, {
    command_state: 'failed',
    deployed_commit_sha: null,
    post_deploy_status: 'not_started',
    group_verification_digest: digest('8'),
  })
  assertEvidenceHeld(
    projectPromotionTerminal({ handoff, direct_stack: failed }, directTrustedAuthorityBundle()),
    'a failed deployment without a valid signed failure vector cannot be projected',
  )
  const wrongFailed = structuredClone(failed)
  wrongFailed.payload.task7_replay.source_attestations.postverify.payload.source_digest = digest('9')
  assertEvidenceHeld(projectPromotionTerminal({ handoff, direct_stack: wrongFailed }, directTrustedAuthorityBundle()))
  const missingFailedSource = structuredClone(failed)
  delete missingFailedSource.payload.task7_replay.source_attestations.ancestry
  assertEvidenceHeld(
    projectPromotionTerminal({ handoff, direct_stack: missingFailedSource }, directTrustedAuthorityBundle()),
    'failure projection validates every source attestation before classification',
  )

  const timeout = directStackTask7Replay(handoff)
  timeout.payload.task7_replay.poll = {
    schema_version: 'direct-stack-poll/v1',
    status: 'timeout',
    observed_at: timeout.payload.task7_replay.poll.observed_at,
    stack_id: timeout.payload.task7_replay.plan.frozen_stack.stack_id,
    repository: timeout.payload.task7_replay.plan.repository,
    request_digest: timeout.payload.task7_replay.plan.request_digest,
    operation: structuredClone(timeout.payload.task7_replay.accepted.operation),
  }
  timeout.payload.task7_replay.merged = {}
  assert.deepEqual(projectPromotionTerminal({ handoff, direct_stack: timeout }, directTrustedAuthorityBundle()), {
    phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'MERGE_OUTCOME_UNVERIFIED',
  })
  const authorityUnavailable = directStackTask7Replay(handoff)
  authorityUnavailable.payload.task7_replay.observation.capability_state = 'unsupported'
  assert.deepEqual(projectPromotionTerminal({ handoff, direct_stack: authorityUnavailable }, directTrustedAuthorityBundle()), {
    phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_AUTHORITY_UNAVAILABLE',
  })
  const policyDrift = directStackTask7Replay(handoff, { deployed_commit_sha: sha('f') })
  assert.deepEqual(projectPromotionTerminal({ handoff, direct_stack: policyDrift }, directTrustedAuthorityBundle()), {
    phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'POLICY_OR_SETTINGS_DRIFT',
  })
  const legacy = { internal_state: 'DEPLOYMENT_BLOCKED' }
  assertEvidenceHeld(projectPromotionTerminal({ handoff, direct_stack: legacy }, directTrustedAuthorityBundle()))
})

test('Task9 repair RED — legacy direct promotion exports synchronously close without a base-owned authority-use port', () => {
  const authority = trustedAuthorityBundle()

  const result = buildPromotionHandoff(ordinaryInput(authority), authority)

  assertAuthorityHeld(result)
  assert.equal(Object.isFrozen(result), true)
})

test('Task9 P1 — a caller-forged cas_winner authority-use receipt cannot mint a v5 handoff', async () => {
  const authority = trustedAuthorityBundle()
  let calls = 0
  const bridge = promotionBridgeModule.createPromotionBridge({
    authorityUsePort: { rereadAndConsume: () => { calls += 1; return { cas_winner: true } } },
  })

  const result = await bridge.buildPromotionHandoff(ordinaryInput(authority), authority)

  assertAuthorityHeld(result)
  assert.equal(calls, 0)
})

test('Task9 P1 — an async candidate authority-use port is also inert before external activation', async () => {
  const authority = trustedAuthorityBundle()
  let calls = 0
  const port = { rereadAndConsume: async () => { calls += 1; return { cas_winner: true } } }

  assert.equal(typeof promotionBridgeModule.createPromotionBridge, 'function')
  const bridge = promotionBridgeModule.createPromotionBridge({ authorityUsePort: port })
  const handoff = await bridge.buildPromotionHandoff(ordinaryInput(authority), authority)

  assertAuthorityHeld(handoff)
  assert.equal(calls, 0)
})
