import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'


const workflowUrl = new URL('../.claude/workflows/ship-item.js', import.meta.url)
const source = await readFile(workflowUrl, 'utf8')
const block = source.match(/\/\/ <routing:gen>[\s\S]*?\/\/ <\/routing:gen>/)?.[0]
assert.ok(block, 'generated routing block must exist')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function loadDispatch(rawAgent) {
  const factory = new AsyncFunction('agent', `${block}\nreturn { governedAgent }`)
  return factory(rawAgent)
}

const gateVerdict = {
  allowDispatch: true,
  Scope: 'bounded',
  Evidence: 'label and phase inspected',
  Finding: 'dispatch may proceed',
  Uncertainty: 'none',
  Risk: 'bounded',
  'Next step': 'run child',
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

test('secondary fan-out first obtains one successful Fable/max apex and never exceeds two active children', async () => {
  const calls = []
  let active = 0
  let maxActive = 0
  const { governedAgent } = await loadDispatch(async (_prompt, options) => {
    calls.push(options)
    active += 1
    maxActive = Math.max(maxActive, active)
    await tick()
    active -= 1
    return options.label.startsWith('governance:apex:') ? gateVerdict : { ok: true }
  })

  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) => governedAgent(`task-${index}`, {
      label: `scan:${index}`,
      phase: 'Scan',
      model: 'sonnet',
      effort: 'medium',
      schema: { type: 'object' },
    })),
  )

  assert.equal(calls.length, 7)
  assert.match(calls[0].label, /^governance:apex:/)
  assert.equal(calls[0].model, 'fable')
  assert.equal(calls[0].effort, 'max')
  assert.equal(calls[0].agentType, 'code-reviewer')
  assert.ok(results.every((result) => result?.ok === true))
  assert.ok(maxActive <= 2, `observed ${maxActive} active agents`)
})

test('synthetic apex null verdict prevents every secondary dispatch', async () => {
  const calls = []
  const { governedAgent } = await loadDispatch(async (_prompt, options) => {
    calls.push(options)
    return null
  })

  const results = await Promise.allSettled([
    governedAgent('one', { label: 'scan:one', phase: 'Scan', model: 'sonnet', effort: 'medium' }),
    governedAgent('two', { label: 'scan:two', phase: 'Scan', model: 'sonnet', effort: 'medium' }),
  ])

  assert.equal(calls.length, 1)
  assert.match(calls[0].label, /^governance:apex:/)
  assert.ok(results.every((result) => result.status === 'rejected' && /HELD: apex_unavailable_or_denied/.test(result.reason.message)))
})

test('requested apex must actually return before a concurrent secondary can run', async () => {
  const calls = []
  const { governedAgent } = await loadDispatch(async (_prompt, options) => {
    calls.push(options)
    await tick()
    return null
  })

  const [apex, secondary] = await Promise.allSettled([
    governedAgent('judge', { label: 'ship:arbiter:7', phase: 'Arbitrate', model: 'fable', effort: 'max' }),
    governedAgent('scan', { label: 'scan:repo', phase: 'Scan', model: 'sonnet', effort: 'medium' }),
  ])

  assert.equal(calls.length, 1)
  assert.equal(calls[0].label, 'ship:arbiter:7')
  assert.equal(apex.status, 'fulfilled')
  assert.equal(apex.value, null)
  assert.equal(secondary.status, 'rejected')
  assert.match(secondary.reason.message, /HELD: apex_unavailable_or_denied/)
})

test('nested fan-out shares the same two-child semaphore', async () => {
  let active = 0
  let maxActive = 0
  const { governedAgent } = await loadDispatch(async (_prompt, options) => {
    if (options.label.startsWith('governance:apex:')) return gateVerdict
    active += 1
    maxActive = Math.max(maxActive, active)
    await tick()
    active -= 1
    return { ok: true }
  })

  await Promise.all(Array.from({ length: 3 }, (_, outer) => Promise.all(
    Array.from({ length: 3 }, (_, inner) => governedAgent('nested', {
      label: `nested:${outer}:${inner}`,
      phase: 'Verify',
      model: 'opus',
      effort: 'xhigh',
    })),
  )))

  assert.ok(maxActive <= 2, `nested fan-out observed ${maxActive} active agents`)
})

test('a throwing child releases its slot for later work', async () => {
  let attempts = 0
  const { governedAgent } = await loadDispatch(async (_prompt, options) => {
    if (options.label.startsWith('governance:apex:')) return gateVerdict
    attempts += 1
    if (options.label === 'throw') throw new Error('expected')
    return { ok: true }
  })

  await assert.rejects(
    governedAgent('throw', { label: 'throw', phase: 'Verify', model: 'opus', effort: 'xhigh' }),
    /expected/,
  )
  const result = await governedAgent('after', { label: 'after', phase: 'Verify', model: 'opus', effort: 'xhigh' })
  assert.deepEqual(result, { ok: true })
  assert.equal(attempts, 2)
})
