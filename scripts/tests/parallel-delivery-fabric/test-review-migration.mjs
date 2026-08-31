import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTONOMOUS_CODEX_REVIEW_PHASES,
  loadAutonomousCodexReviewPolicy,
  validateReviewCheckPacket,
} from '../../lib/autonomous-codex-review-check.mjs'

const packet = () => ({
  schema_version: 'autonomous-codex-review-check-packet/v1',
  repository: 'monkey1sai/AI-BIM-governance',
  pr_number: 711,
  base_sha: 'a'.repeat(40),
  head_sha: 'b'.repeat(40),
  changed_files_sha256: 'c'.repeat(64),
  reviewer_engine: 'monkey1sai-codex',
  evidence_sha256: 'd'.repeat(64),
  identities: {
    writer_execution_id: 'execution:writer',
    fixer_execution_id: 'execution:fixer',
    reviewer_execution_id: 'execution:reviewer',
  },
  check_run: {
    source: {
      source_kind: 'github_app',
      source_ref: 'base:monkey1sai-codex',
      app_slug: 'monkey1sai-codex',
      app_id: 481516,
      check_name: 'monkey1sai-codex/ready',
    },
    head_sha: 'b'.repeat(40),
    status: 'completed',
    conclusion: 'success',
    required: true,
    pagination_complete: true,
  },
})

test('AC-14 — review migration stays LEGACY_GUARDED and cannot retire the counted vote', () => {
  const policy = loadAutonomousCodexReviewPolicy()
  assert.equal(policy.phase, 'LEGACY_GUARDED')
  assert.deepEqual(policy.phase_order, AUTONOMOUS_CODEX_REVIEW_PHASES)
  assert.equal(policy.legacy_gate.counted_review_required, true)
  assert.equal(policy.legacy_gate.direct_stack, 'HELD')
  assert.equal(policy.external_activation.machine_sink_enabled, false)
  const decision = validateReviewCheckPacket(packet())
  assert.equal(decision.decision, 'HELD')
  assert.equal(decision.status, 'HELD_EXTERNAL_ACTIVATION')
  assert.equal(decision.phase, 'LEGACY_GUARDED')
})

test('AC-08 — direct_stack remains HELD until external activation', () => {
  const policy = loadAutonomousCodexReviewPolicy()
  assert.equal(policy.phase, 'LEGACY_GUARDED')
  assert.notEqual(policy.phase, 'AUTONOMOUS_ACTIVE')
  assert.equal(policy.legacy_gate.direct_stack, 'HELD')
})

test('AC-10 — runtime third-seat allocation remains HELD without runtime-capacity authority', () => {
  const policy = loadAutonomousCodexReviewPolicy()
  assert.equal(policy.external_activation.candidate_inaccessible_authenticity, 'HELD_EXTERNAL_ACTIVATION')
})

test('AC-12 — live Merge Queue enqueue remains HELD in shadow observation', () => {
  const policy = loadAutonomousCodexReviewPolicy()
  assert.equal(policy.legacy_gate.direct_stack, 'HELD')
  assert.equal(policy.external_activation.machine_sink_enabled, false)
})

test('AC-22 — Computer Use plus Playwright exact-head binding stays external until activation', () => {
  const policy = loadAutonomousCodexReviewPolicy()
  assert.ok(policy.external_activation.evidence_refs.includes('external:activation-canary'))
})

test('AC-23 — per-head interaction evidence cannot be satisfied by local fixtures', () => {
  const decision = validateReviewCheckPacket(packet())
  assert.equal(decision.status, 'HELD_EXTERNAL_ACTIVATION')
  assert.equal(decision.disposition, 'SHADOW_ADVISORY')
})

test('AC-24 — runtime-preflight authority remains HELD without an independent record', () => {
  const policy = loadAutonomousCodexReviewPolicy()
  assert.equal(policy.external_activation.candidate_inaccessible_authenticity, 'HELD_EXTERNAL_ACTIVATION')
})
