import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
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

const createInjectedStore = () => {
  const calls = { read: 0, cas: 0 }
  const ref = 'refs/ai-bim/session-leases'
  let sequence = 0
  let current = { ref, oid: ZERO_OID, record: null }
  const store = {
    commonDirDigest: COMMON_DIR_DIGEST,
    async read() {
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
  }
  return { calls, store: Object.freeze(store) }
}

const leaseRequest = (store, index, provider) => {
  const tag = `${provider}-${index}`
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
    scope_digest: SHA256(['f', 'e', 'd', 'c', 'b', 'a'][index]),
    head_sha: SHA1(['a', 'b', 'c', 'd', 'e', 'f'][index]),
    resource_keys: [`path:src/ac02-${tag}.mjs`],
    nonce: NONCE(`ac02-${tag}`),
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
  test(`AC-02 — ${leftProvider}+${rightProvider} share global writer cap two`, async () => {
    const { calls, store } = createInjectedStore()
    const clock = Object.freeze({ now: () => NOW })
    const registry = createLeaseRegistry({ store, clock, writerCap: 2 })
    assert.equal(Object.isFrozen(registry), true)
    assert.equal(Object.isFrozen(store), true)
    assert.deepEqual(Object.keys(store).sort(), ['cas', 'commonDirDigest', 'read'])

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

    for (const [offset, thirdProvider] of ['codex', 'claude'].entries()) {
      const thirdInput = leaseRequest(store, offset + 2, thirdProvider)
      const thirdBefore = structuredClone(thirdInput)
      const beforeQueued = { ...calls }
      const third = await registry.admit(thirdInput)
      assert.deepEqual({ status: third.status, reason: third.reason }, {
        status: 'QUEUED_FOR_LEASE',
        reason: 'WRITER_CAPACITY',
      })
      assert.equal(calls.read, beforeQueued.read + 1)
      assert.equal(calls.cas, beforeQueued.cas)
      assert.deepEqual(thirdInput, thirdBefore)
      const beforeUnchangedRead = calls.read
      const unchanged = await registry.inspect()
      assert.equal(calls.read, beforeUnchangedRead + 1)
      assert.equal(calls.cas, beforeQueued.cas)
      assert.deepEqual(unchanged.record, fullBefore.record)
      assert.equal(unchanged.oid, fullBefore.oid)
    }

    const beforeEnd = { ...calls }
    const endRequest = await registry.endRequest({
      lease_id: firstInput.lease_id,
      expected_oid: fullBefore.oid,
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

    const beforeMissingEvidenceQueue = { ...calls }
    const blockedAfterMissingEvidence = await registry.admit(leaseRequest(store, 4, 'codex'))
    assert.deepEqual({ status: blockedAfterMissingEvidence.status, reason: blockedAfterMissingEvidence.reason }, {
      status: 'QUEUED_FOR_LEASE',
      reason: 'WRITER_CAPACITY',
    })
    assert.equal(calls.read, beforeMissingEvidenceQueue.read + 1)
    assert.equal(calls.cas, beforeMissingEvidenceQueue.cas)
    const beforeMissingEvidenceSnapshot = calls.read
    const afterMissingEvidenceQueue = await registry.inspect()
    assert.equal(calls.read, beforeMissingEvidenceSnapshot + 1)
    assert.equal(calls.cas, beforeMissingEvidenceQueue.cas)
    assert.equal(afterMissingEvidenceQueue.oid, pendingRelease.oid)
    assert.deepEqual(afterMissingEvidenceQueue.record, pendingRelease.record)

    const admissionInput = admissionRequest(store, 9, 'claude', pendingRelease.record.generation)
    const admissionBefore = structuredClone(admissionInput)
    const beforePureAdmission = { ...calls }
    const pureAdmission = evaluateAdmission(pendingRelease.record, admissionInput)
    assert.deepEqual({ status: pureAdmission.status, reason: pureAdmission.reason }, {
      status: 'QUEUED_FOR_LEASE',
      reason: 'WRITER_CAPACITY',
    })
    assert.equal(Object.isFrozen(pureAdmission), true)
    assert.deepEqual(admissionInput, admissionBefore)
    assert.deepEqual(calls, beforePureAdmission)
    const finalSnapshot = await registry.inspect()
    assert.equal(finalSnapshot.oid, pendingRelease.oid)
    assert.deepEqual(finalSnapshot.record, pendingRelease.record)
  })
}
