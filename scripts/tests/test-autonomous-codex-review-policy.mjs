import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const policyPath = path.join(repoRoot, 'scripts', 'autonomous-codex-review-policy.json')
const schemaPath = path.join(repoRoot, 'scripts', 'tests', 'autonomous-codex-review-policy.schema.json')
const openSpecPath = path.join(repoRoot, 'openspec', 'specs', 'ai-coding-governance', 'spec.md')
const moduleUrl = new URL('../lib/autonomous-codex-review-check.mjs', import.meta.url)
const POLICY_FILE_MAX_BYTES = 8 * 1024

const PHASES = [
  'LEGACY_GUARDED',
  'SHADOW_DUAL',
  'CUTOVER_ARMED',
  'CANARY_ACTIVE',
  'AUTONOMOUS_ACTIVE',
]

const clone = (value) => JSON.parse(JSON.stringify(value))
const readCanonical = async () => JSON.parse(await readFile(policyPath, 'utf8'))
const readSchema = async () => JSON.parse(await readFile(schemaPath, 'utf8'))
const loadApi = async () => import(moduleUrl.href)

const createIsolatedPolicyRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autonomous-codex-review-policy-root-'))
  const modulePath = path.join(root, 'scripts', 'lib', 'autonomous-codex-review-check.mjs')
  const isolatedPolicyPath = path.join(root, 'scripts', 'autonomous-codex-review-policy.json')
  const isolatedSchemaPath = path.join(root, 'scripts', 'tests', 'autonomous-codex-review-policy.schema.json')
  const isolatedOpenSpecPath = path.join(root, 'openspec', 'specs', 'ai-coding-governance', 'spec.md')
  await mkdir(path.dirname(modulePath), { recursive: true })
  await mkdir(path.dirname(isolatedSchemaPath), { recursive: true })
  await mkdir(path.dirname(isolatedOpenSpecPath), { recursive: true })
  await cp(fileURLToPath(moduleUrl), modulePath)
  await cp(policyPath, isolatedPolicyPath)
  await cp(schemaPath, isolatedSchemaPath)
  await cp(openSpecPath, isolatedOpenSpecPath)
  return { root, modulePath, isolatedPolicyPath, isolatedSchemaPath, isolatedOpenSpecPath }
}

const expectCode = (code, action, label) => {
  assert.throws(action, (error) => error?.code === code, label)
}

const validPacket = () => ({
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

test('AC-14 — the sole review policy is legacy-guarded and pinned to an ancestor base blob', async () => {
  const { loadAutonomousCodexReviewPolicy } = await loadApi()
  const policy = loadAutonomousCodexReviewPolicy()

  assert.equal(Object.isFrozen(policy), true)
  assert.equal(policy.schema_version, 'autonomous-codex-review-policy/v1')
  assert.equal(policy.phase, 'LEGACY_GUARDED')
  assert.deepEqual(policy.phase_order, PHASES)
  assert.deepEqual(policy.open_spec, {
    source_kind: 'base_pinned_openspec',
    source_path: 'openspec/specs/ai-coding-governance/spec.md',
    base_sha: 'a0ab7065131914e548e1d79a1c683c8b14b07de4',
    source_sha256: '27c687fff38b1f791565708090611114970a993bd3b126addf34829cc8e11168',
  })
  assert.deepEqual(policy.external_check, {
    source_kind: 'github_app',
    source_ref: 'base:monkey1sai-codex',
    app_slug: 'monkey1sai-codex',
    app_id: 481516,
    check_name: 'monkey1sai-codex/ready',
    required: true,
  })
  assert.deepEqual(policy.publisher_capabilities, {
    can_checks: true,
    can_contents: false,
    can_approve: false,
    can_merge: false,
  })
  assert.equal(policy.legacy_gate.counted_review_required, true)
  assert.equal(policy.legacy_gate.direct_stack, 'HELD')
  assert.deepEqual(policy.external_activation.evidence_refs, [
    'external:settings-lease',
    'external:rollback-snapshot',
    'external:authoritative-reread',
    'external:activation-canary',
  ])
  assert.equal(policy.external_activation.candidate_inaccessible_authenticity, 'HELD_EXTERNAL_ACTIVATION')
})

test('AC-36 — policy validator fails closed for phases, source pins, capabilities, and secret-shaped fields', async () => {
  const { validateAutonomousCodexReviewPolicy } = await loadApi()
  const policy = await readCanonical()
  const cases = [
    ['missing phase', (value) => delete value.phase, 'policy_missing_key'],
    ['alias phase', (value) => { value.phase = 'CANARY' }, 'policy_phase_invalid'],
    ['unknown phase', (value) => { value.phase = 'UNKNOWN' }, 'policy_phase_invalid'],
    ['reordered phase enum', (value) => { value.phase_order.reverse() }, 'policy_phase_order_invalid'],
    ['duplicate phase enum', (value) => { value.phase_order[1] = 'LEGACY_GUARDED' }, 'policy_phase_order_invalid'],
    ['candidate source', (value) => { value.open_spec.source_kind = 'candidate_openspec' }, 'policy_source_untrusted'],
    ['local source', (value) => { value.open_spec.source_kind = 'local_openspec' }, 'policy_source_untrusted'],
    ['wrong base source', (value) => { value.open_spec.base_sha = 'a'.repeat(40) }, 'policy_source_pin_invalid'],
    ['wrong source digest', (value) => { value.open_spec.source_sha256 = 'a'.repeat(64) }, 'policy_source_pin_invalid'],
    ['wrong app', (value) => { value.external_check.app_slug = 'other-app' }, 'policy_check_pin_invalid'],
    ['wrong app id', (value) => { value.external_check.app_id = 1 }, 'policy_check_pin_invalid'],
    ['wrong check', (value) => { value.external_check.check_name = 'monkey1sai-codex/other' }, 'policy_check_pin_invalid'],
    ['missing required capability', (value) => delete value.publisher_capabilities.can_merge, 'policy_missing_key'],
    ['contents capability', (value) => { value.publisher_capabilities.can_contents = true }, 'policy_capability_invalid'],
    ['approve capability', (value) => { value.publisher_capabilities.can_approve = true }, 'policy_capability_invalid'],
    ['merge capability', (value) => { value.publisher_capabilities.can_merge = true }, 'policy_capability_invalid'],
    ['missing evidence ref', (value) => value.external_activation.evidence_refs.pop(), 'policy_external_evidence_invalid'],
    ['private key', (value) => { value.private_key = 'not-a-real-key' }, 'policy_secret_material'],
    ['nested token', (value) => { value.external_activation.token = 'not-a-real-token' }, 'policy_secret_material'],
    ['unknown key', (value) => { value.unexpected = true }, 'policy_unknown_key'],
  ]

  for (const [label, mutate, code] of cases) {
    const candidate = clone(policy)
    mutate(candidate)
    expectCode(code, () => validateAutonomousCodexReviewPolicy(candidate), label)
  }
})

test('AC-36 — caller-supplied policy roots are not authority', async () => {
  const { loadAutonomousCodexReviewPolicy } = await loadApi()
  expectCode('policy_source_untrusted', () => loadAutonomousCodexReviewPolicy({
    repoRoot: os.tmpdir(),
  }), 'candidate policy root override')
})

test('AC-36 — committed Draft 2020-12 schema validates the policy and rejects nested relaxation or corruption', async () => {
  const { validatePolicySchemaDocument } = await loadApi()
  const policy = await readCanonical()
  const schema = await readSchema()
  assert.deepEqual(JSON.parse(JSON.stringify(validatePolicySchemaDocument(schema, policy))), policy)

  const schemaCases = [
    ['nested const relaxation', (value) => { value.properties.external_check.properties.app_id.const = 1 }],
    ['nested required relaxation', (value) => { value.properties.external_check.required.pop() }],
    ['nested additional-properties relaxation', (value) => { value.properties.external_check.additionalProperties = true }],
    ['nested type relaxation', (value) => { value.properties.external_check.properties.app_id.type = 'string' }],
    ['draft corruption', (value) => { value.$schema = 'https://example.invalid/not-draft-2020-12' }],
  ]
  for (const [label, mutate] of schemaCases) {
    const corrupted = clone(schema)
    mutate(corrupted)
    expectCode('policy_schema_invalid', () => validatePolicySchemaDocument(corrupted, policy), label)
  }

  for (const [label, mutate] of [
    ['nested const policy violation', (value) => { value.external_check.app_id = 1 }],
    ['nested required policy violation', (value) => delete value.external_check.check_name],
    ['nested additional property', (value) => { value.external_check.other = true }],
    ['nested type policy violation', (value) => { value.external_check.app_id = '481516' }],
  ]) {
    const invalid = clone(policy)
    mutate(invalid)
    expectCode('policy_schema_validation_failed', () => validatePolicySchemaDocument(schema, invalid), label)
  }
})

test('AC-36 — hostile accessors, Proxy values, cycles, and BigInt are rejected before policy semantics', async () => {
  const { validateAutonomousCodexReviewPolicy } = await loadApi()
  const policy = await readCanonical()
  const accessor = clone(policy)
  Object.defineProperty(accessor, 'phase', {
    enumerable: true,
    get: () => { throw new Error('hostile getter must not run') },
  })
  const proxy = new Proxy(policy, { ownKeys: () => { throw new Error('hostile ownKeys must not run') } })
  const cyclic = clone(policy)
  cyclic.loop = cyclic
  const bigInt = clone(policy)
  bigInt.phase_order[0] = 1n
  for (const [label, value] of [
    ['accessor', accessor], ['Proxy', proxy], ['cycle', cyclic], ['BigInt', bigInt],
  ]) expectCode('policy_hostile_input', () => validateAutonomousCodexReviewPolicy(value), label)

  const mutable = clone(policy)
  const snapshot = validateAutonomousCodexReviewPolicy(mutable)
  mutable.publisher_capabilities.can_merge = true
  assert.equal(snapshot.publisher_capabilities.can_merge, false)
  assert.equal(Object.isFrozen(snapshot.publisher_capabilities), true)
})

test('AC-36 — recursive case-insensitive alternate policy copies are rejected while explicit generated roots are ignored', async () => {
  const { inspectPolicyFileInventory } = await loadApi()
  const root = await mkdtemp(path.join(os.tmpdir(), 'autonomous-codex-review-policy-'))
  try {
    await mkdir(path.join(root, 'scripts', 'tests'), { recursive: true })
    await mkdir(path.join(root, 'openspec', 'changes', 'parallel-delivery-fabric', 'specs', 'parallel-delivery-fabric'), { recursive: true })
    await cp(policyPath, path.join(root, 'scripts', 'autonomous-codex-review-policy.json'))
    await cp(schemaPath, path.join(root, 'scripts', 'tests', 'autonomous-codex-review-policy.schema.json'))
    await cp(openSpecPath, path.join(root, 'openspec', 'specs', 'ai-coding-governance', 'spec.md'))
    assert.equal(inspectPolicyFileInventory(root).canonical_policy_count, 1)

    const nested = path.join(root, 'scripts', 'nested', 'AUTONOMOUS-CODEX-REVIEW-POLICY.JSON.bak')
    await mkdir(path.dirname(nested), { recursive: true })
    await writeFile(nested, '{}')
    expectCode('policy_source_duplicate', () => inspectPolicyFileInventory(root), 'nested case-folded backup copy')
    await rm(path.dirname(nested), { recursive: true, force: true })

    const generated = path.join(root, 'scripts', 'generated', 'autonomous-codex-review-policy.copy.json')
    await mkdir(path.dirname(generated), { recursive: true })
    await writeFile(generated, '{}')
    assert.equal(inspectPolicyFileInventory(root).canonical_policy_count, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('AC-36 — alternate policy inventory errors redact hostile filename details', async () => {
  const { inspectPolicyFileInventory } = await loadApi()
  const root = await mkdtemp(path.join(os.tmpdir(), 'autonomous-codex-review-policy-redaction-'))
  const hostileDirectory = 'C-drive-path-secret'
  const hostileFilename = 'AUTONOMOUS-CODEX-REVIEW-POLICY.token-S-1-5-21-111-222-333-1001.json'
  try {
    await mkdir(path.join(root, 'scripts', 'tests'), { recursive: true })
    await cp(policyPath, path.join(root, 'scripts', 'autonomous-codex-review-policy.json'))
    await cp(schemaPath, path.join(root, 'scripts', 'tests', 'autonomous-codex-review-policy.schema.json'))
    const hostilePath = path.join(root, 'scripts', hostileDirectory, hostileFilename)
    await mkdir(path.dirname(hostilePath), { recursive: true })
    await writeFile(hostilePath, '{}')

    let captured
    try { inspectPolicyFileInventory(root) } catch (error) { captured = error }
    assert.equal(captured?.code, 'policy_source_duplicate')
    assert.equal(captured?.message, 'policy_source_duplicate: inventory_candidates=1')
    assert.equal(captured.message.includes(hostileDirectory), false)
    assert.equal(captured.message.includes(hostileFilename), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Task11 P2 RED — canonical files use exact bounded stable reads and reject linked path components', async () => {
  const exact = await createIsolatedPolicyRoot()
  try {
    const bytes = await readFile(exact.isolatedPolicyPath)
    assert.equal(bytes.length < POLICY_FILE_MAX_BYTES, true)
    await writeFile(exact.isolatedPolicyPath, Buffer.concat([
      bytes,
      Buffer.alloc(POLICY_FILE_MAX_BYTES - bytes.length, 0x20),
    ]))
    const schemaBytes = await readFile(exact.isolatedSchemaPath)
    await writeFile(exact.isolatedSchemaPath, Buffer.concat([
      schemaBytes,
      Buffer.alloc(POLICY_FILE_MAX_BYTES - schemaBytes.length, 0x20),
    ]))
    const exactApi = await import(pathToFileURL(exact.modulePath).href)
    assert.equal(exactApi.loadAutonomousCodexReviewPolicy().phase, 'LEGACY_GUARDED')
  } finally {
    await rm(exact.root, { recursive: true, force: true })
  }

  for (const [label, property] of [
    ['policy', 'isolatedPolicyPath'],
    ['schema', 'isolatedSchemaPath'],
    ['OpenSpec', 'isolatedOpenSpecPath'],
  ]) {
    const oversized = await createIsolatedPolicyRoot()
    try {
      const target = oversized[property]
      const bytes = await readFile(target)
      await writeFile(target, Buffer.concat([
        bytes,
        Buffer.alloc(POLICY_FILE_MAX_BYTES + 1 - bytes.length, 0x20),
      ]))
      const oversizedApi = await import(pathToFileURL(oversized.modulePath).href)
      expectCode('policy_file_budget_exceeded', () => oversizedApi.loadAutonomousCodexReviewPolicy(), `max plus one ${label}`)
    } finally {
      await rm(oversized.root, { recursive: true, force: true })
    }
  }

  const linked = await createIsolatedPolicyRoot()
  try {
    const linkedDirectory = path.dirname(linked.isolatedOpenSpecPath)
    const externalDirectory = path.join(linked.root, 'external-openspec')
    await mkdir(externalDirectory)
    await cp(openSpecPath, path.join(externalDirectory, 'spec.md'))
    await rm(linkedDirectory, { recursive: true, force: true })
    await symlink(externalDirectory, linkedDirectory, 'junction')
    const linkedApi = await import(pathToFileURL(linked.modulePath).href)
    expectCode('policy_source_untrusted', () => linkedApi.loadAutonomousCodexReviewPolicy(), 'linked OpenSpec parent')
  } finally {
    await rm(linked.root, { recursive: true, force: true })
  }
})

test('AC-36 — inventory traversal limits and reparse entries fail closed before policy loading', async () => {
  const { inspectPolicyFileInventory } = await loadApi()
  const root = await mkdtemp(path.join(os.tmpdir(), 'autonomous-codex-review-policy-limits-'))
  try {
    await mkdir(path.join(root, 'scripts', 'tests'), { recursive: true })
    await cp(policyPath, path.join(root, 'scripts', 'autonomous-codex-review-policy.json'))
    await cp(schemaPath, path.join(root, 'scripts', 'tests', 'autonomous-codex-review-policy.schema.json'))

    const wide = path.join(root, 'scripts', 'wide')
    await mkdir(wide)
    await Promise.all(Array.from({ length: 508 }, (_, index) => writeFile(path.join(wide, `entry-${index}.txt`), 'x')))
    assert.equal(inspectPolicyFileInventory(root).canonical_policy_count, 1)
    await writeFile(path.join(wide, 'entry-508.txt'), 'x')
    expectCode('policy_inventory_budget_exceeded', () => inspectPolicyFileInventory(root), 'wide inventory')
    await rm(wide, { recursive: true, force: true })

    const localArtifacts = [
      ['.run', 400],
      ['__pycache__', 400],
      ['.venv', 400],
      ['.pytest_cache', 400],
    ]
    for (const [directoryName, fileCount] of localArtifacts) {
      const artifactRoot = path.join(root, 'scripts', directoryName, 'nested')
      await mkdir(artifactRoot, { recursive: true })
      await Promise.all(Array.from({ length: fileCount }, (_, index) => (
        writeFile(path.join(artifactRoot, `noise-${index}.txt`), 'x')
      )))
    }
    assert.equal(inspectPolicyFileInventory(root).canonical_policy_count, 1, 'gitignored local artifacts must not consume inventory budget')
    for (const [directoryName] of localArtifacts) {
      await rm(path.join(root, 'scripts', directoryName), { recursive: true, force: true })
    }

    let deep = path.join(root, 'scripts')
    for (let index = 0; index <= 12; index += 1) {
      deep = path.join(deep, `deep-${index}`)
      await mkdir(deep)
    }
    expectCode('policy_inventory_budget_exceeded', () => inspectPolicyFileInventory(root), 'deep inventory')
    await rm(path.join(root, 'scripts', 'deep-0'), { recursive: true, force: true })

    const target = path.join(root, 'inventory-target')
    const reparse = path.join(root, 'scripts', 'reparse-link')
    await mkdir(target)
    await symlink(target, reparse, 'junction')
    expectCode('policy_inventory_symlink', () => inspectPolicyFileInventory(root), 'reparse directory')
  } finally {
    await rm(root, { recursive: true, force: true })
  }

  const linkedRoot = await mkdtemp(path.join(os.tmpdir(), 'autonomous-codex-review-policy-linked-root-'))
  try {
    const externalScripts = path.join(linkedRoot, 'external-scripts')
    await mkdir(path.join(externalScripts, 'tests'), { recursive: true })
    await cp(policyPath, path.join(externalScripts, 'autonomous-codex-review-policy.json'))
    await cp(schemaPath, path.join(externalScripts, 'tests', 'autonomous-codex-review-policy.schema.json'))
    await symlink(externalScripts, path.join(linkedRoot, 'scripts'), 'junction')
    expectCode('policy_inventory_symlink', () => inspectPolicyFileInventory(linkedRoot), 'linked inventory root')
  } finally {
    await rm(linkedRoot, { recursive: true, force: true })
  }

  const source = await readFile(fileURLToPath(moduleUrl), 'utf8')
  assert.equal(source.split('inspectPolicyFileInventory(ROOT)').length - 1, 2, 'load revalidates inventory after canonical reads')
})

test('AC-33 — writer and fixer identities cannot be the reviewer identity', async () => {
  const { assertDistinctReviewIdentity } = await loadApi()
  assert.equal(assertDistinctReviewIdentity({
    writer_execution_id: 'execution:writer',
    fixer_execution_id: 'execution:fixer',
    reviewer_execution_id: 'execution:reviewer',
  }), true)
  for (const [label, identities] of [
    ['writer self-review', { writer_execution_id: 'execution:writer', fixer_execution_id: 'execution:fixer', reviewer_execution_id: 'execution:writer' }],
    ['fixer self-review', { writer_execution_id: 'execution:writer', fixer_execution_id: 'execution:fixer', reviewer_execution_id: 'execution:fixer' }],
  ]) expectCode('reviewer_identity_conflict', () => assertDistinctReviewIdentity(identities), label)
  for (const [label, writer] of [
    ['non-execution identity', 'candidate:writer'],
    ['identity whitespace', 'execution:writer two'],
    ['identity path separator', 'execution:writer/path'],
  ]) expectCode('review_identity_invalid', () => assertDistinctReviewIdentity({
    writer_execution_id: writer,
    fixer_execution_id: 'execution:fixer',
    reviewer_execution_id: 'execution:reviewer',
  }), label)
})

test('AC-34 — one exact review and CheckRun packet is source-pinned, cross-bound, and HELD in legacy mode', async () => {
  const { validateReviewCheckPacket } = await loadApi()
  const packet = validPacket()
  const result = validateReviewCheckPacket(packet)
  assert.equal(result.decision, 'HELD')
  assert.equal(result.status, 'HELD_EXTERNAL_ACTIVATION')
  assert.equal(result.disposition, 'SHADOW_ADVISORY')
  assert.equal(Object.hasOwn(result, 'approval_equivalent'), false)
  assert.equal(result.packet.head_sha, result.packet.check_run.head_sha)
  assert.equal(result.packet.repository, 'monkey1sai/AI-BIM-governance')
  expectCode('policy_call_override_forbidden', () => validateReviewCheckPacket(packet, { expectedHeadSha: 'f'.repeat(40) }), 'caller head override')

  const cases = [
    ['wrong repository', (value) => { value.repository = 'candidate/spoof' }, 'review_packet_binding_invalid'],
    ['wrong CheckRun head', (value) => { value.check_run.head_sha = 'e'.repeat(40) }, 'check_head_invalid'],
    ['wrong reviewer identity', (value) => { value.identities.reviewer_execution_id = value.identities.writer_execution_id }, 'reviewer_identity_conflict'],
    ['Windows path identity', (value) => { value.identities.writer_execution_id = 'C:\\Users\\operator\\review.json' }, 'policy_private_runtime_value'],
    ['UNC path identity', (value) => { value.identities.writer_execution_id = '\\\\host\\share\\review.json' }, 'policy_private_runtime_value'],
    ['Unix path identity', (value) => { value.identities.writer_execution_id = '/home/operator/review.json' }, 'policy_private_runtime_value'],
    ['raw SID identity', (value) => { value.identities.writer_execution_id = 'S-1-5-21-111-222-333-1001' }, 'policy_private_runtime_value'],
    ['raw PID identity', (value) => { value.identities.writer_execution_id = 'pid: 4242' }, 'policy_private_runtime_value'],
    ['process identity', (value) => { value.identities.writer_execution_id = 'process: node.exe' }, 'policy_private_runtime_value'],
    ['host identity', (value) => { value.identities.writer_execution_id = 'DESKTOP-7VF1E3D' }, 'policy_private_runtime_value'],
    ['host-labelled packet string', (value) => { value.repository = 'host: staging-machine' }, 'policy_private_runtime_value'],
    ['neutral conclusion', (value) => { value.check_run.conclusion = 'neutral' }, 'check_conclusion_invalid'],
    ['partial pagination', (value) => { value.check_run.pagination_complete = false }, 'check_pagination_incomplete'],
    ['unknown packet key', (value) => { value.trusted = true }, 'policy_unknown_key'],
  ]
  for (const [label, mutate, code] of cases) {
    const invalid = clone(packet)
    mutate(invalid)
    expectCode(code, () => validateReviewCheckPacket(invalid), label)
  }
})
