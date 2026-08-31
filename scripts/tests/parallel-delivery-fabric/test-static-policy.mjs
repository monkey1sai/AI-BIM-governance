import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MAP_PATH = path.join(REPO_ROOT, 'agent-contracts', 'parallel-delivery-fabric-ac-map.json')
const POLICY_PATH = path.join(REPO_ROOT, 'scripts', 'autonomous-codex-review-policy.json')
const SCHEMA_PATH = path.join(REPO_ROOT, 'scripts', 'tests', 'autonomous-codex-review-policy.schema.json')
const OPERATOR_DOC = path.join(REPO_ROOT, 'docs', 'agents', 'parallel-delivery-fabric.md')

test('AC-14 — static policy keeps one review-policy source and a closed AC-01..AC-45 map', () => {
  assert.equal(existsSync(MAP_PATH), true)
  assert.equal(existsSync(POLICY_PATH), true)
  assert.equal(existsSync(SCHEMA_PATH), true)
  assert.equal(existsSync(OPERATOR_DOC), true)
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'))
  assert.equal(map.schema_version, 'parallel-delivery-fabric-ac-map/v1')
  assert.equal(map.acceptance.length, 45)
  const ids = map.acceptance.map((row) => row.id)
  const expected = Array.from({ length: 45 }, (_unused, index) => `AC-${String(index + 1).padStart(2, '0')}`)
  assert.deepEqual(ids, expected)
  const names = new Map()
  for (const row of map.acceptance) {
    assert.equal(row.assertions.length >= 1, true, row.id)
    for (const assertion of row.assertions) {
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
})
