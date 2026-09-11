import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'

const names = ['std-plan', 'std-implement', 'std-evidence', 'std-evidence-closeout',
  'plan-next-spec-to-done-aware', 'spec-to-done-adversarial-verify']
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
for (const name of names) {
  test(name + ' is retired without reading args or invoking capabilities', async () => {
    const source = await readFile(new URL('../.claude/workflows/' + name + '.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\b(?:import|require|fetch|process|globalThis)\b/)
    const execute = new AsyncFunction('args', 'phase', 'log', 'agent', 'parallel', source.replace(/^export\s+/gm, ''))
    let calls = 0
    const forbidden = () => { calls++; throw new Error('retired workflow invoked a capability') }
    const hostileArgs = new Proxy({}, { get: forbidden, ownKeys: forbidden })
    for (const args of [undefined, null, 'invalid', { specPath: 'spec.md', mode: 'fix' }, hostileArgs]) {
      const result = await execute(args, forbidden, forbidden, forbidden, forbidden)
      assert.equal(result.ok, false)
      assert.equal(result.held, 'retired_workflow')
      assert.equal(result.workflow, name)
      assert.equal(result.agentCallsUsed, 0)
      assert.equal(calls, 0)
    }
  })
}
test('discovery and writers are retired while shared readers remain', async () => {
  const manifest = JSON.parse(await readFile(new URL('../agent-skills-manifest.json', import.meta.url), 'utf8'))
  assert.ok(!manifest.skills.some(skill => skill.id === 'spec-to-done' || skill.name === 'spec-to-done'))
  for (const root of ['.claude', '.codex', '.agents']) {
    await assert.rejects(access(new URL('../' + root + '/skills/spec-to-done/SKILL.md', import.meta.url)), { code: 'ENOENT' })
  }
  for (const file of ['append-new-run.mjs', 'parse-plan.mjs', 'review-dispatch.mjs']) {
    await assert.rejects(access(new URL('../.claude/skills/spec-to-done/' + file, import.meta.url)), { code: 'ENOENT' })
  }
  for (const file of ['scripts/lib/legacy-spec-to-done/validate-state.mjs',
    'scripts/lib/legacy-spec-to-done/trusted-git.mjs', 'scripts/dev/ensure-host-native-ports-free.ps1']) {
    await access(new URL('../' + file, import.meta.url))
  }
})
