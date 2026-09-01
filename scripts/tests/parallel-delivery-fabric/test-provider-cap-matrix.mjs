import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { FABRIC_SCHEMA_VERSION, digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import { createLeaseRegistry } from '../../lib/parallel-delivery-fabric-registry.mjs'
import { evaluateAdmission } from '../../lib/parallel-delivery-fabric-admission.mjs'

const ZERO_OID = '0'.repeat(40)
const NOW = '2026-08-29T00:00:00.000Z'
const SHA1 = (hex) => hex.repeat(40)
const SHA256 = (hex) => hex.repeat(64)
const NONCE = (suffix) => `${suffix}`.padEnd(32, 'n').slice(0, 32)
const COMMON_DIR_DIGEST = digestCanonical({ common_dir: 'synthetic-common-dir' })
const PROVIDER_PAIRS = [
  ['codex', 'codex'],
  ['claude', 'claude'],
  ['claude', 'codex'],
]

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const planRecord = () => {
  const plan = {
    schema_version: FABRIC_SCHEMA_VERSION,
    plan_id: 'plan:ac02-matrix',
    generation: 1,
    repo_identity: { full_name: 'acme/bim', repository_id: 1, common_dir_digest: COMMON_DIR_DIGEST },
    created_at: NOW,
    coordinator_session: 'session:ac02-coordinator',
    baseline_ref: 'origin/main',
    resolved_baseline_sha: SHA1('a'),
    tasks: [{
      task_id: 'task:ac02-matrix',
      outcome: 'provider-cap-matrix',
      provider_preference: 'codex',
      owner_session: 'session:ac02-owner',
      scope: {
        owning_service: 'delivery-fabric',
        public_entrypoint: 'scripts/lib/parallel-delivery-fabric-registry.mjs',
        resources: [{ kind: 'path', path: 'src/ac02-matrix.mjs' }],
        expected_tests: ['test:provider-cap-matrix'],
        e2e_required: false,
      },
      dependencies: [],
      risk: 'bounded',
      e2e_required: false,
    }],
    requested_capacity: { writers: 1, runtime_leases: 0 },
    branch_profile: 'trunk',
    acceptance_criteria: ['criterion:provider-cap-matrix'],
    promotion_mode: 'single_pr',
    requested_execution_level: 'plan_only',
    authority_reference: 'authority:ac02-plan',
    governance_source_refs: ['openspec:parallel-delivery-fabric'],
  }
  const base = {
    schema_version: 'delivery-plan-registry/v1', generation: 1, nonce: NONCE('ac02-plan'),
    created_at: NOW, updated_at: NOW, plan, plan_digest: digestCanonical(plan),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  }
  return { ...base, canonical_digest: digestCanonical(base) }
}

const createInjectedStore = () => {
  const calls = { read: 0, cas: 0 }
  const ref = 'refs/ai-bim/session-leases'
  const planRef = 'refs/ai-bim/delivery-plans'
  const plan = { ref: planRef, oid: SHA1('f'), record: planRecord() }
  let sequence = 0
  let current = { ref, oid: ZERO_OID, record: null }
  const store = {
    commonDirDigest: COMMON_DIR_DIGEST,
    async read(requestedRef) {
      if (requestedRef === planRef) return structuredClone(plan)
      if (typeof requestedRef === 'string' && requestedRef.startsWith(`${planRef}/`)) {
        return { ref: requestedRef, oid: ZERO_OID, record: null }
      }
      calls.read += 1
      return structuredClone(current)
    },
    async cas({ expected_oid: expectedOid, record }) {
      calls.cas += 1
      if (expectedOid !== current.oid) {
        return {
          status: 'CONFLICT',
          reason: 'CAS_CONFLICT',
          expected_oid: expectedOid,
          actual_oid: current.oid,
          current: structuredClone(current),
        }
      }
      sequence += 1
      const oid = createHash('sha1').update(`${sequence}:${JSON.stringify(record)}`).digest('hex')
      current = { ref, oid, record: structuredClone(record) }
      return { status: 'STORED', ref, oid, previous_oid: expectedOid, record: structuredClone(record) }
    },
    async casGuarded({ ref: guardedRef, expected_oid: expectedOid, record, guard_ref: guardRef, guard_oid: guardOid }) {
      if (guardRef !== planRef || guardOid !== plan.oid) {
        return { status: 'CONFLICT', reason: 'GUARD_CONFLICT', ref: guardedRef, expected_oid: expectedOid, actual_oid: current.oid, actual_guard_oid: ZERO_OID }
      }
      return this.cas({ ref: guardedRef, expected_oid: expectedOid, record })
    },
  }
  return { calls, store: Object.freeze(store) }
}

const leaseRequest = (store, index, provider) => {
  const tag = `${provider}-${index}`
  const resourceKeys = [`path:src/ac02-${tag}.mjs`]
  return deepFreeze({
    lease_id: `lease:ac02-${tag}`,
    plan_id: 'plan:ac02-matrix',
    generation: 1,
    task_id: `task:ac02-${tag}`,
    provider,
    owner_session: `session:ac02-${tag}`,
    provider_session_id: `provider:ac02-${tag}`,
    execution_context_id: `context:ac02-${tag}`,
    context_attestation_ref: `attestation:ac02-${tag}`,
    common_dir_digest: store.commonDirDigest,
    worktree_id: `worktree:ac02-${tag}`,
    worktree_path_digest: SHA256(['a', 'b', 'c', 'd', 'e', 'f'][index]),
    branch: `${provider}/ac02-${tag}`,
    scope_digest: digestCanonical([{ kind: 'path', path: `src/ac02-${tag}.mjs` }]),
    head_sha: SHA1(['a', 'b', 'c', 'd', 'e', 'f'][index]),
    resource_keys: resourceKeys,
    nonce: NONCE(`ac02-${tag}`),
    expected_plan_oid: SHA1('f'),
  })
}

const admissionRequest = (store, index, provider, generation) => {
  const tag = `${provider}-candidate-${index}`
  const scope = [{ kind: 'path', path: `src/ac02-${tag}.mjs` }]
  return deepFreeze({
    schema_version: 'admission-request/v1',
    lease_kind: 'writer_seat',
    lease_id: `lease:admission-${tag}`,
    plan_id: 'plan:ac02-matrix',
    generation,
    task_id: `task:admission-${tag}`,
    provider,
    owner_session: `session:admission-${tag}`,
    provider_session_id: `provider:admission-${tag}`,
    execution_context_id: `context:admission-${tag}`,
    repo_identity_digest: SHA256('1'),
    common_dir_digest: store.commonDirDigest,
    worktree_id: `worktree:admission-${tag}`,
    worktree_path_digest: SHA256('2'),
    branch: `${provider}/admission-${tag}`,
    scope,
    scope_digest: digestCanonical(scope),
    baseline_sha: SHA1('3'),
    head_sha: SHA1('4'),
    base_ref: 'origin/main',
    base_sha: SHA1('3'),
    expected_remote_sha: SHA1('3'),
    action: 'admit',
    runtime_kind: null,
  })
}

for (const [leftProvider, rightProvider] of PROVIDER_PAIRS) {
  test(`AC-02 — ${leftProvider}+${rightProvider} admit disjoint writers without a count cap`, async () => {
    const { calls, store } = createInjectedStore()
    const clock = Object.freeze({ now: () => NOW })
    const registry = createLeaseRegistry({ store, clock, writerCap: 2 })
    assert.equal(Object.isFrozen(registry), true)
    assert.equal(Object.isFrozen(store), true)
    assert.deepEqual(Object.keys(store).sort(), ['cas', 'casGuarded', 'commonDirDigest', 'read'])

    const firstInput = leaseRequest(store, 0, leftProvider)
    const secondInput = leaseRequest(store, 1, rightProvider)
    const firstBefore = structuredClone(firstInput)
    const secondBefore = structuredClone(secondInput)
    const first = await registry.admit(firstInput)
    const second = await registry.admit(secondInput)
    assert.equal(first.status, 'ADMITTED')
    assert.equal(second.status, 'ADMITTED')
    assert.deepEqual(calls, { read: 2, cas: 2 })
    assert.deepEqual(firstInput, firstBefore)
    assert.deepEqual(secondInput, secondBefore)

    const fullBefore = await registry.inspect()
    assert.equal(fullBefore.record.writer_cap, 2)
    assert.equal(Object.values(fullBefore.record.leases).length, 2)
    assert.deepEqual(
      Object.values(fullBefore.record.leases).map((lease) => lease.provider),
      [leftProvider, rightProvider],
    )

    const rejectedInput = leaseRequest(store, 5, 'nested')
    const rejectedBefore = structuredClone(rejectedInput)
    const beforeRejected = { ...calls }
    await assert.rejects(
      registry.admit(rejectedInput),
      (error) => error?.code === 'invalid_value',
    )
    assert.deepEqual(calls, beforeRejected)
    assert.deepEqual(rejectedInput, rejectedBefore)
    const afterRejected = await registry.inspect()
    assert.equal(afterRejected.oid, fullBefore.oid)
    assert.deepEqual(afterRejected.record, fullBefore.record)

    const thirdInput = leaseRequest(store, 2, 'codex')
    const thirdBefore = structuredClone(thirdInput)
    const beforeThird = { ...calls }
    const third = await registry.admit(thirdInput)
    assert.equal(third.status, 'ADMITTED')
    assert.equal(calls.read, beforeThird.read + 1)
    assert.equal(calls.cas, beforeThird.cas + 1)
    assert.deepEqual(thirdInput, thirdBefore)

    const afterThird = await registry.inspect()
    const sameBranchInput = {
      ...leaseRequest(store, 3, 'claude'),
      branch: firstInput.branch,
    }
    const sameBranchBefore = structuredClone(sameBranchInput)
    const beforeContention = { ...calls }
    const contended = await registry.admit(sameBranchInput)
    assert.deepEqual({ status: contended.status, reason: contended.reason }, {
      status: 'QUEUED_FOR_LEASE',
      reason: 'BRANCH_CONTENTION',
    })
    assert.equal(calls.read, beforeContention.read + 1)
    assert.equal(calls.cas, beforeContention.cas)
    assert.deepEqual(sameBranchInput, sameBranchBefore)
    const unchanged = await registry.inspect()
    assert.deepEqual(unchanged.record, afterThird.record)
    assert.equal(unchanged.oid, afterThird.oid)

    const beforeEnd = { ...calls }
    const endRequest = await registry.endRequest({
      lease_id: firstInput.lease_id,
      expected_oid: afterThird.oid,
      nonce: NONCE(`ac02-end-${leftProvider}-${rightProvider}`),
      reason: 'handoff',
      handoff_or_candidate_reference: `handoff:ac02-${leftProvider}-${rightProvider}`,
    })
    assert.equal(endRequest.status, 'END_REQUESTED')
    assert.equal(calls.read, beforeEnd.read + 1)
    assert.equal(calls.cas, beforeEnd.cas + 1)
    const pendingRelease = await registry.inspect()
    const pendingLease = pendingRelease.record.leases[firstInput.lease_id]
    assert.equal(pendingLease.state, 'END_REQUESTED')
    assert.equal(pendingLease.release_evidence_ref, null)

    const admissionInput = admissionRequest(store, 9, 'claude', pendingRelease.record.generation)
    const admissionBefore = structuredClone(admissionInput)
    const beforePureAdmission = { ...calls }
    const pureAdmission = evaluateAdmission(pendingRelease.record, admissionInput)
    assert.equal(pureAdmission.status, 'ADMITTED')
    assert.equal(Object.isFrozen(pureAdmission), true)
    assert.deepEqual(admissionInput, admissionBefore)
    assert.deepEqual(calls, beforePureAdmission)
    const finalSnapshot = await registry.inspect()
    assert.equal(finalSnapshot.oid, pendingRelease.oid)
    assert.deepEqual(finalSnapshot.record, pendingRelease.record)
  })
}
