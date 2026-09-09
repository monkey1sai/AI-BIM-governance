import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parsePlan, readPlanPacket } from '../.claude/skills/spec-to-done/parse-plan.mjs'
import { reviewDispatch } from '../.claude/skills/spec-to-done/review-dispatch.mjs'

const ROOT = 'C:/fixture/worktree'
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40)
const PLAN = 'docs/superpowers/plans/2026-09-09-demo.md'
const AXES = ['completeness', 'spec-alignment', 'task-decomposition', 'buildability']
const goodReview = () => ({ specOk: true, gaps: [], criticalCount: 0, importantCount: 0, minorNotes: [], detail: '' })
const meta = (overrides = {}) => ({ files: ['src/demo.js'], symbols: [], userFacingTouch: false, securitySensitive: false, ...overrides })
const task = (n = 1, metadata = meta()) => [
  `### Task ${n}: Demo ${n}`, '```spec-task', JSON.stringify(metadata), '```',
  'Acceptance: real behavior.', 'Verify: node --test tests/demo.mjs', '',
].join('\n')
const packet = (text = task()) => ({
  schema_version: 'spec-plan-packet/v1', attestation: 'coordinator-attested',
  worktreeRoot: ROOT, planPath: PLAN,
  planSha256: createHash('sha256').update(text).digest('hex'), tasks: parsePlan(text),
})
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
async function harness(name, respond = () => undefined) {
  const source = (await readFile(new URL(`../.claude/workflows/${name}.js`, import.meta.url), 'utf8')).replace(/^export\s+/gm, '')
  // No shell, fs, import, or custom helper is injected into the Workflow runtime.
  const execute = new AsyncFunction('args', 'phase', 'log', 'agent', 'parallel', source)
  const calls = [], prompts = []
  const p = packet()
  const agent = async (prompt, options) => {
    calls.push(options.label); prompts.push(prompt)
    const supplied = respond(options.label, prompt, calls)
    if (supplied !== undefined) return supplied
    if (options.label.startsWith('governance:apex:')) return { allowDispatch: true }
    if (options.label === 'plan:author') return {
      planPath: PLAN, planSha256: p.planSha256, taskCount: 1, committed: true,
      tasks: [{ index: 0, title: 'Demo 1', files: ['src/demo.js'], symbols: [], mechanical: false, userFacingTouch: false }],
    }
    if (options.label === 'plan-review:combined') return { axes: AXES.map(axis => ({axis, approved:true, issues:[]})) }
    if (options.label.startsWith('impl:')) return { status:'DONE', commitSha:HEAD, summary:'implemented', concerns:[], detectVerdict:'pass' }
    if (options.label.startsWith('task-review:')) return goodReview()
    if (options.label.startsWith('security-review:')) return {criticalCount:0,importantCount:0,minorNotes:[],detail:''}
    if (options.label === 'final-review') return {ok:true,findings:[]}
    throw new Error(`unexpected call ${options.label}`)
  }
  return {
    calls, prompts,
    run: (overrides = {}) => execute({
      specPath:'spec.md', slug:'demo', dateStamp:'2026-09-09', branch:'feat/demo', worktreeRoot:ROOT,
      remainingAgentCalls:40, planPath:PLAN, planSha256:p.planSha256, planPacket:p, baseSha:BASE, ...overrides,
    }, () => {}, () => {}, agent, jobs => Promise.all(jobs.map(job => job()))),
  }
}

test('parser preserves task text, ignores headings inside code fences and returns ordered metadata', () => {
  const text = task() + '\n```text\n### Task 900: not a task\n```\n' + task(2)
  const tasks = parsePlan(text.replace(/\n/g, '\r\n'))
  assert.equal(tasks.length, 2)
  assert.deepEqual(tasks.map(t => t.index), [0,1])
  assert.ok(tasks[0].fullText.includes('### Task 900'))
  assert.equal(tasks[0].mechanical, false)
})
test('parser rejects missing/duplicate metadata, malformed order, unclosed fences and escaping paths', () => {
  for (const text of ['', '### Task 1: Missing\n', task(2), task()+task(), task().replace('```\nAcceptance', 'Acceptance'),
    task().replace('src/demo.js','../private.js'), task().replace('src/demo.js','C:\\\\private.js'),
    task().replace('src/demo.js','src/*'), task(1,{...meta(),extra:true}), task(1,{...meta(),securitySensitive:'false'}),
    task() + '\n```spec-task\n' + JSON.stringify(meta()) + '\n```']) assert.throws(() => parsePlan(text))
  assert.throws(() => parsePlan('x'.repeat(262145)))
})
test('host reader binds exact bytes and rejects a junction/symlink outside root', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(),'spec-workflow-'))
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'spec-workflow-'))
  t.after(() => rm(temp,{recursive:true,force:true}))
  const root = path.join(temp,'root'), outside = path.join(temp,'outside')
  await mkdir(root); await mkdir(outside)
  await writeFile(path.join(root,'plan.md'),task())
  await writeFile(path.join(outside,'plan.md'),task())
  const p = await readPlanPacket(root,'plan.md')
  assert.equal(p.planSha256,createHash('sha256').update(task()).digest('hex'))
  await assert.rejects(readPlanPacket(root,'../outside/plan.md'),/plan_path_invalid/)
  await symlink(outside,path.join(root,'escape'),process.platform==='win32'?'junction':'dir')
  await assert.rejects(readPlanPacket(root,'escape/plan.md'),/plan_path_escape/)
})
test('P1 needs one complete four-axis review, with honest real-call accounting', async () => {
  const h = await harness('std-plan'), result = await h.run()
  assert.equal(result.ok,true)
  assert.deepEqual(h.calls,['plan:author','plan-review:combined'])
  assert.equal(result.agentCallsUsed,h.calls.length)
})
test('P1 refuses an incomplete or contradictory approved review', async () => {
  for (const axes of [
    AXES.slice(0,3).map(axis=>({axis,approved:true,issues:[]})),
    AXES.map(axis=>({axis,approved:true,issues:[{severity:'major',detail:'unfixed'}]})),
  ]) {
    const h = await harness('std-plan', label => label==='plan-review:combined'?{axes}:undefined)
    assert.equal((await h.run()).held,'reviewer_agent_failed')
    assert.equal(h.calls.filter(x=>x==='plan-review:combined').length,2)
  }
})
test('P1 will not repeat a rejected plan when fixer reports the same digest', async () => {
  const h = await harness('std-plan',(label)=>{
    if(label==='plan-review:combined')return {axes:AXES.map(axis=>({axis,approved:false,issues:[{severity:'major',detail:'gap'}]}))}
    if(label.startsWith('plan-fix:'))return {fixed:true,summary:'unchanged',plan:{
      planPath:PLAN,planSha256:packet().planSha256,taskCount:1,committed:true,
      tasks:[{index:0,files:['src/demo.js'],symbols:[],userFacingTouch:false}],
    }}
  })
  const result = await h.run()
  assert.equal(result.held,'plan_not_aligned')
  assert.equal(result.note,'no_new_plan_evidence')
  assert.equal(h.calls.filter(x=>x==='plan-review:combined').length,1)
})
test('P3 uses no parser agent and no duplicate final review for one completed slice', async () => {
  const h=await harness('std-implement'),result=await h.run()
  assert.equal(result.ok,true)
  assert.equal(result.finalReview.reusedTaskReview,true)
  assert.equal(result.agentCallsUsed,h.calls.length)
  assert.equal(h.calls.length,3) // actual routing apex + implementer + combined reviewer
  assert.ok(!h.calls.some(x=>/parse:plan|spec-review|quality-review|final-review/.test(x)))
})
test('P3 rejects invalid/stale packets and missing binding before any dispatch', async () => {
  const mutations=[
    a=>{a.planPacket=undefined}, a=>{a.planSha256='c'.repeat(64)},a=>{a.planPacket.worktreeRoot='C:/elsewhere'},
    a=>{a.planPacket.tasks=[]},a=>{a.planPacket.tasks[0].index=3},a=>{a.planPacket.tasks[0].files=['../secret']},
    a=>{a.planPacket.tasks[0].fullText='wrong'},a=>{a.baseSha='short'},a=>{a.startTaskIndex=5},
    a=>{a.planPacket.tasks[0].securitySensitive='false'},
  ]
  for(const mutate of mutations){
    const h=await harness('std-implement'),overrides={planPacket:packet(),planSha256:packet().planSha256,baseSha:BASE}
    mutate(overrides)
    assert.equal((await h.run(overrides)).held,'plan_parse_failed')
    assert.equal(h.calls.length,0)
  }
})
test('zero/one-call budgets do not overspend the synthetic apex; every real dispatch is counted',async()=>{
  for(const remainingAgentCalls of [0,1,2,3]){
    const h=await harness('std-implement'),result=await h.run({remainingAgentCalls})
    assert.ok(h.calls.length<=remainingAgentCalls)
    assert.equal(result.agentCallsUsed,h.calls.length)
    if(remainingAgentCalls<3)assert.equal(result.held,'run_budget_exhausted')
  }
})
test('P3 leaves spec/quality blockers open and refuses same-commit re-review',async()=>{
  const h=await harness('std-implement',label=>{
    if(label.startsWith('task-review:'))return {...goodReview(),importantCount:1,detail:'real bug'}
    if(label.startsWith('task-fix:'))return {fixed:true,commitSha:HEAD,summary:'unchanged',detectVerdict:'pass'}
  })
  const result=await h.run()
  assert.equal(result.held,'quality_review_not_closing')
  assert.equal(result.note,'no_new_review_evidence')
  assert.equal(h.calls.filter(x=>x.startsWith('task-review:')).length,1)
})
test('security-sensitive slices require a separate security verdict and block on findings',async()=>{
  const p=packet(task(1,meta({securitySensitive:true})))
  const h=await harness('std-implement',label=>label.startsWith('security-review:')?
    {criticalCount:1,importantCount:0,minorNotes:[],detail:'permission bypass'}:undefined)
  assert.equal((await h.run({planPacket:p,planSha256:p.planSha256})).held,'quality_review_not_closing')
  assert.equal(h.calls.filter(x=>x.startsWith('security-review:')).length,1)
})
test('multiple slices retain one integration review',async()=>{
  const p=packet(task()+task(2)), h=await harness('std-implement')
  assert.equal((await h.run({planPacket:p,planSha256:p.planSha256})).ok,true)
  assert.equal(h.calls.filter(x=>x==='final-review').length,1)
})
test('native review admission shares existing evidence-delta semantics and never grants authority',()=>{
  const next={head_sha:HEAD,input_sha256:'1'.repeat(64),policy_sha256:'2'.repeat(64),
    verification_manifest_sha256:'3'.repeat(64),evidence_fingerprint:'4'.repeat(64)}
  assert.equal(reviewDispatch({previous:null,next}).decision,'INITIAL_REVIEW')
  assert.equal(reviewDispatch({previous:next,next:{...next}}).decision,'NO_RETRY')
  assert.equal(reviewDispatch({previous:next,next:{...next,evidence_fingerprint:'5'.repeat(64)}}).decision,'REVIEW_DELTA')
  assert.equal(reviewDispatch({previous:null,next}).authorization_granted,false)
  assert.throws(()=>reviewDispatch({previous:next,next:{...next,input_sha256:'made-up'}}))
})
