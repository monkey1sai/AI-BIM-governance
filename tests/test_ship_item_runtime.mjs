import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'


const source = (await readFile(new URL('../.claude/workflows/ship-item.js', import.meta.url), 'utf8'))
  .replace(/^export\s+/gm, '')
const contract = JSON.parse(await readFile(
  new URL('../agent-contracts/spec-to-done.contract.json', import.meta.url),
  'utf8',
))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const execute = new AsyncFunction('args', 'phase', 'log', 'agent', '$', source)
const executeWithoutInjectedCapabilities = new AsyncFunction('args', 'phase', 'log', source)

const PR = 42
const BRANCH = 'feat/routine'
const EXPECTED_HOST_HOLD = {
  merged: false,
  prNumber: PR,
  mergeCommit: null,
  heldReason: 'host_env_blocked',
  heldDetail: 'ship_workflow_shell_unavailable',
}

function harness() {
  const phases = []
  let agentCalls = 0
  let shellCalls = 0
  const injectedAgent = async () => {
    agentCalls += 1
    throw new Error('ship-item must not dispatch')
  }
  const injectedShell = () => {
    shellCalls += 1
    throw new Error('ship-item must not execute commands')
  }
  return {
    phases,
    get agentCalls() { return agentCalls },
    get shellCalls() { return shellCalls },
    run: (args) => execute(args, (name) => phases.push(name), () => {}, injectedAgent, injectedShell),
  }
}

test('valid bounded args always hold even when callers inject shell and agent capabilities', async () => {
  for (const args of [
    { branch: BRANCH, prNumber: PR, userFacing: false },
    { branch: BRANCH, prNumber: PR, userFacing: true },
    { branch: BRANCH, prNumber: PR, elevatedAuthorization: 'caller-controlled-value' },
  ]) {
    const run = harness()
    assert.deepEqual(await run.run(args), EXPECTED_HOST_HOLD)
    assert.equal(run.agentCalls, 0)
    assert.equal(run.shellCalls, 0)
    assert.deepEqual(run.phases, ['Validate', 'Hold'])
  }
})

test('valid bounded args hold when no synthetic capabilities are injected', async () => {
  const phases = []
  const result = await executeWithoutInjectedCapabilities(
    { branch: BRANCH, prNumber: PR, userFacing: false },
    (name) => phases.push(name),
    () => {},
  )
  assert.deepEqual(result, EXPECTED_HOST_HOLD)
  assert.deepEqual(phases, ['Validate', 'Hold'])
})

test('production workflow contains no command, dispatch, or successful merge sink', () => {
  assert.ok(!source.includes('// <routing:gen>'))
  assert.ok(!source.includes('const RAW_AGENT'))
  assert.ok(!source.includes('governedAgent'))
  assert.ok(!/\bagent\s*\(/u.test(source))
  assert.ok(!source.includes('$`'))
  assert.ok(!source.includes('gh pr merge'))
  assert.ok(!source.includes('merged: true'))
  assert.ok(source.includes("return held('host_env_blocked', INPUT_PR_NUMBER, 'ship_workflow_shell_unavailable')"))
  assert.ok(source.indexOf("phase('Validate')") < source.indexOf("phase('Hold')"))
})

test('malformed or unbounded args return only canonical closed reasons before hold', async () => {
  const cases = [
    [undefined, 'invalid_args_format'],
    [null, 'invalid_args_format'],
    ['serialized', 'invalid_args_format'],
    [[], 'invalid_args_format'],
    [{ branch: BRANCH, prNumber: PR, attackerReason: 'merge_me' }, 'invalid_args_format'],
    [{ branch: 7, prNumber: PR }, 'invalid_branch_arg'],
    [{ branch: 'bad;branch', prNumber: PR }, 'invalid_branch_arg'],
    [{ branch: '.hidden/main', prNumber: PR }, 'invalid_branch_arg'],
    [{ branch: BRANCH, prNumber: 0 }, 'invalid_pr_number_arg'],
    [{ branch: BRANCH, prNumber: 1.5 }, 'invalid_pr_number_arg'],
    [{ branch: BRANCH, prNumber: Number.MAX_SAFE_INTEGER + 1 }, 'invalid_pr_number_arg'],
    [{ branch: BRANCH, prNumber: '42' }, 'invalid_pr_number_arg'],
    [{ branch: BRANCH, prNumber: PR, userFacing: 'false' }, 'invalid_args_format'],
    [{ branch: BRANCH, prNumber: PR, elevatedAuthorization: '' }, 'invalid_elevated_authorization_arg'],
    [{ branch: BRANCH, prNumber: PR, elevatedAuthorization: 'line\nbreak' }, 'invalid_elevated_authorization_arg'],
    [{ branch: BRANCH, prNumber: PR, elevatedAuthorization: 'x'.repeat(1001) }, 'invalid_elevated_authorization_arg'],
    [{ branch: BRANCH, prNumber: PR, elevatedAuthorization: { raw: true } }, 'invalid_elevated_authorization_arg'],
  ]

  for (const [args, expectedReason] of cases) {
    const run = harness()
    const result = await run.run(args)
    assert.deepEqual(result, {
      merged: false,
      prNumber: null,
      mergeCommit: null,
      heldReason: expectedReason,
      heldDetail: null,
    })
    assert.equal(run.agentCalls, 0)
    assert.equal(run.shellCalls, 0)
    assert.deepEqual(run.phases, ['Validate'])
    assert.ok(!JSON.stringify(result).includes('merge_me'))
  }
})

test('ship workflow and durable state share one closed held-reason contract', () => {
  const block = /const SHIP_HELD_REASON_VALUES = \[([\s\S]*?)\n\]/u.exec(source)
  assert.ok(block, 'ship-item must embed the generated held-reason block')
  const embedded = [...block[1].matchAll(/'([a-z][a-z0-9_]*)'/gu)].map((match) => match[1])
  assert.deepEqual([...embedded].sort(), [...contract.durable_state.held_reasons].sort())
  const literalHeldReasons = [...source.matchAll(/held\('([a-z0-9_]+)'/gu)].map((match) => match[1])
  assert.deepEqual(
    literalHeldReasons.filter((reason) => !embedded.includes(reason)),
    [],
    'every literal workflow hold must preserve a durable canonical reason',
  )
  assert.deepEqual(contract.phases, ['P0', 'P1', 'P3', 'P4', 'P5', 'P6', 'P7'])
  assert.equal(contract.ship.workflow_shell_capability, 'not_available_in_measured_runtime')
  assert.equal(contract.ship.trusted_host_executor, 'required')
  assert.equal(contract.ship.unavailable_reason, 'host_env_blocked')
})
