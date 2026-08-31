import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createVerificationPlan } from '../../lib/verification-plan.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MAP_PATH = path.join(REPO_ROOT, 'agent-contracts', 'parallel-delivery-fabric-ac-map.json')
const POLICY_PATH = path.join(REPO_ROOT, 'scripts', 'autonomous-codex-review-policy.json')
const SCHEMA_PATH = path.join(REPO_ROOT, 'scripts', 'tests', 'autonomous-codex-review-policy.schema.json')
const OPERATOR_DOC = path.join(REPO_ROOT, 'docs', 'agents', 'parallel-delivery-fabric.md')
const WORKFLOW_DOC = path.join(REPO_ROOT, 'docs', 'agents', 'codex-loop-workflows.md')
const VERIFICATION_MANIFEST = path.join(REPO_ROOT, 'scripts', 'verification-manifest.json')
const SCRIPT_REGISTRY = path.join(REPO_ROOT, 'scripts', 'script-registry.json')
const SCRIPT_CONTRACT = path.join(REPO_ROOT, 'scripts', 'SCRIPT_CONTRACT.md')
const STATIC_WRAPPER = path.join(REPO_ROOT, 'scripts', 'tests', 'test-parallel-delivery-fabric-static-policy.ps1')
const GOVERNANCE_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'agent-governance.yml')
const STATIC_GATE_ID = 'parallel-delivery-fabric-static-policy'
const ASSERTION_KINDS = new Set(['positive', 'negative', 'no-side-effect'])

const globRegex = (glob) => {
  let expression = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*' && glob[index + 1] === '*') {
      index += 1
      if (glob[index + 1] === '/') {
        index += 1
        expression += '(?:.*/)?'
      } else expression += '.*'
    } else if (char === '*') expression += '[^/]*'
    else if (char === '?') expression += '[^/]'
    else expression += char.replace(/[\\^$+.()|{}\[\]]/gu, '\\$&')
  }
  return new RegExp(`${expression}$`, 'u')
}

const validateAcceptanceMap = (map, manifest) => {
  const staticTargets = manifest.targets.filter((target) => (
    [...target.fast_gates, ...target.contract_gates, ...target.slow_evidence_gates].includes(STATIC_GATE_ID)
  ))
  for (const row of map.acceptance) {
    for (const assertion of row.assertions) {
      if (!ASSERTION_KINDS.has(assertion.kind)) throw new Error('acceptance_assertion_kind_invalid')
      if (!assertion.test_name.startsWith(`${row.id} — `)) throw new Error('acceptance_test_name_mismatch')
      const targetOwnsPath = staticTargets.some((target) => (
        target.path_globs.some((glob) => globRegex(glob).test(assertion.test_file))
      ))
      if (!targetOwnsPath) throw new Error('acceptance_test_path_glob_mismatch')
      const plan = createVerificationPlan(manifest, { changedPaths: [assertion.test_file] })
      const enforced = plan.targets.some((target) => target.required && target.gates.some((gate) => gate.id === STATIC_GATE_ID))
      if (!enforced) throw new Error('acceptance_test_not_enforced')
    }
  }
}

test('Task12 repair RED — AC map rejects cross-AC names and tests outside the enforced target', () => {
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'))
  const manifest = JSON.parse(readFileSync(VERIFICATION_MANIFEST, 'utf8'))
  const swapped = structuredClone(map)
  const firstName = swapped.acceptance[0].assertions[0].test_name
  swapped.acceptance[0].assertions[0].test_name = swapped.acceptance[1].assertions[0].test_name
  swapped.acceptance[1].assertions[0].test_name = firstName
  assert.throws(() => validateAcceptanceMap(swapped, manifest), /acceptance_test_name_mismatch/u)

  const outsideTarget = structuredClone(map)
  outsideTarget.acceptance[0].assertions[0].test_file = 'README.md'
  assert.throws(() => validateAcceptanceMap(outsideTarget, manifest), /acceptance_test_path_glob_mismatch/u)

  const missingPathGlob = structuredClone(manifest)
  const governanceTarget = missingPathGlob.targets.find(({ id }) => id === 'agent-governance')
  governanceTarget.path_globs = governanceTarget.path_globs.filter((glob) => glob !== 'scripts/**')
  assert.throws(() => validateAcceptanceMap(map, missingPathGlob), /acceptance_test_path_glob_mismatch/u)
})

test('AC-14 — static policy keeps one review-policy source and a closed AC-01..AC-45 map', () => {
  assert.equal(existsSync(MAP_PATH), true)
  assert.equal(existsSync(POLICY_PATH), true)
  assert.equal(existsSync(SCHEMA_PATH), true)
  assert.equal(existsSync(OPERATOR_DOC), true)
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'))
  assert.equal(map.schema_version, 'parallel-delivery-fabric-ac-map/v1')
  assert.deepEqual(Object.keys(map).sort(), ['acceptance', 'schema_version'])
  assert.equal(map.acceptance.length, 45)
  const ids = map.acceptance.map((row) => row.id)
  const expected = Array.from({ length: 45 }, (_unused, index) => `AC-${String(index + 1).padStart(2, '0')}`)
  assert.deepEqual(ids, expected)
  const names = new Map()
  for (const row of map.acceptance) {
    assert.deepEqual(Object.keys(row).sort(), ['assertions', 'id'], row.id)
    assert.equal(row.assertions.length >= 1, true, row.id)
    for (const assertion of row.assertions) {
      assert.deepEqual(Object.keys(assertion).sort(), ['kind', 'test_file', 'test_name'], row.id)
      assert.equal(assertion.kind, 'positive', row.id)
      assert.equal(path.isAbsolute(assertion.test_file), false, assertion.test_file)
      assert.equal(assertion.test_file.split(/[\\/]+/).includes('..'), false, assertion.test_file)
      const filePath = path.join(REPO_ROOT, assertion.test_file)
      assert.equal(existsSync(filePath), true, assertion.test_file)
      const source = readFileSync(filePath, 'utf8')
      const needle = `test('${assertion.test_name}'`
      const count = source.split(needle).length - 1
      assert.equal(count, 1, assertion.test_name)
      const previous = names.get(assertion.test_name)
      assert.equal(previous, undefined, assertion.test_name)
      names.set(assertion.test_name, assertion.test_file)
    }
  }
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'))
  assert.equal(policy.phase, 'LEGACY_GUARDED')
  assert.equal(policy.legacy_gate.counted_review_required, true)

  const manifest = JSON.parse(readFileSync(VERIFICATION_MANIFEST, 'utf8'))
  validateAcceptanceMap(map, manifest)
  const gate = manifest.gates.find((item) => item.id === 'parallel-delivery-fabric-static-policy')
  assert.deepEqual(gate, {
    id: 'parallel-delivery-fabric-static-policy',
    capabilities: ['contract'],
    enforcement: 'required',
    command: {
      executable: 'pwsh',
      args: ['-NoProfile', '-NonInteractive', '-File', 'scripts/tests/test-parallel-delivery-fabric-static-policy.ps1'],
    },
    cwd: '.',
    evidence_class: 'contract',
    configured: true,
    not_configured_reason: null,
  })
  const governanceTarget = manifest.targets.find((item) => item.id === 'agent-governance')
  assert.equal(governanceTarget.contract_gates.includes(gate.id), true)

  const registry = JSON.parse(readFileSync(SCRIPT_REGISTRY, 'utf8'))
  const cliEntries = registry.scripts.filter((item) => item.path === 'scripts/dev/parallel-delivery-fabric.mjs')
  assert.equal(cliEntries.length, 1)
  assert.equal(cliEntries[0].role, 'shadow-control-plane')

  const wrapper = readFileSync(STATIC_WRAPPER, 'utf8')
  assert.match(wrapper, /test-autonomous-codex-review-policy\.mjs/)
  assert.match(wrapper, /tests[\\/]test_parallel_delivery_fabric_schema\.py/)
  assert.match(wrapper, /-p['\"]?,?\s*['\"]?no:cacheprovider/)

  const governanceWorkflow = readFileSync(GOVERNANCE_WORKFLOW, 'utf8')
  assert.match(governanceWorkflow, /Run Parallel Delivery Fabric static policy[\s\S]*matrix\.shard == 'core'[\s\S]*test-parallel-delivery-fabric-static-policy\.ps1/u)
  assert.match(governanceWorkflow, /Setup pinned Python for governance tests[\s\S]*python-version: '3\.12'/u)
  assert.match(governanceWorkflow, /Install Parallel Delivery Fabric static-policy dependencies[\s\S]*jsonschema==4\.26\.0 --hash=sha256:/u)

  const operatorDoc = readFileSync(OPERATOR_DOC, 'utf8')
  assert.match(operatorDoc, /HELD_EXTERNAL_ACTIVATION/)
  assert.match(operatorDoc, /WRITER_CAPACITY/)
  assert.match(operatorDoc, /submit.*advance.*reconcile.*drain.*release.*inspect/s)
  assert.match(operatorDoc, /parallel-delivery-fabric-static-policy/)
  assert.match(operatorDoc, /retained for review|RETAINED_FOR_REVIEW/i)

  const workflowDoc = readFileSync(WORKFLOW_DOC, 'utf8')
  assert.match(workflowDoc, /docs\/agents\/parallel-delivery-fabric\.md/)
  assert.match(workflowDoc, /count is not an admission gate/i)
  assert.match(workflowDoc, /WRITER_CAPACITY/)

  const scriptContract = readFileSync(SCRIPT_CONTRACT, 'utf8')
  assert.match(scriptContract, /scripts\/dev\/parallel-delivery-fabric\.mjs/)
  assert.match(scriptContract, /shadow-only/)
  assert.match(scriptContract, /network.*merge.*deploy.*cleanup/s)
})
