import json
import pathlib
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[1]


def _run_harness(script, body, *args):
    proc = subprocess.run(
        ["node", "-e", body, str(ROOT / script), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


def test_plan_reviewers_run_in_waves_of_at_most_two():
    harness = r"""
const fs = require('fs')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let source = fs.readFileSync(process.argv[1], 'utf8').replace('export const meta =', 'const meta =')
let live = 0
let maxLive = 0
const calls = []
const agent = async (_prompt, options) => {
  if (options.label.startsWith('governance:apex:')) {
    return { allowDispatch: true, Scope: 's', Evidence: 'e', Finding: 'f', Uncertainty: 'u', Risk: 'r', 'Next step': 'n' }
  }
  calls.push(options.label)
  live += 1
  maxLive = Math.max(maxLive, live)
  await new Promise((resolve) => setTimeout(resolve, 5))
  live -= 1
  if (options.label === 'plan:author') {
    return { planPath: 'docs/superpowers/plans/demo.md', taskCount: 0, tasks: [], committed: true }
  }
  if (options.label.startsWith('plan-review:')) {
    return { axis: options.label.slice('plan-review:'.length), approved: true, issues: [] }
  }
  throw new Error(`unexpected call: ${options.label}`)
}
const parallel = (jobs) => Promise.all(jobs.map((job) => job()))
const run = new AsyncFunction('args', 'phase', 'log', 'agent', 'parallel', source)
run({
  specPath: 'openspec/changes/demo/spec.md', slug: 'demo', dateStamp: '2026-07-29',
  branch: 'codex/demo', worktreeRoot: 'C:/repo', remainingAgentCalls: 40,
}, () => {}, () => {}, agent, parallel)
  .then((out) => process.stdout.write(JSON.stringify({ out, calls, maxLive })))
  .catch((error) => { console.error(error); process.exitCode = 1 })
"""
    result = _run_harness(".claude/workflows/std-plan.js", harness)
    assert result["out"]["ok"] is True
    assert result["maxLive"] == 2
    assert result["out"]["agentCallsUsed"] == 5


def test_evidence_stops_before_second_call_when_run_budget_is_spent():
    harness = r"""
const fs = require('fs')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let source = fs.readFileSync(process.argv[1], 'utf8').replace('export const meta =', 'const meta =')
const calls = []
const agent = async (_prompt, options) => {
  if (options.label.startsWith('governance:apex:')) {
    return { allowDispatch: true, Scope: 's', Evidence: 'e', Finding: 'f', Uncertainty: 'u', Risk: 'r', 'Next step': 'n' }
  }
  calls.push(options.label)
  return { engine: 'playwright', detail: 'ready' }
}
const run = new AsyncFunction('args', 'phase', 'log', 'agent', source)
run({
  worktreeRoot: 'C:/repo', slug: 'demo', specPath: 'spec.md', planPath: 'plan.md',
  remainingAgentCalls: 1, evidenceAttempt: 1,
}, () => {}, () => {}, agent)
  .then((out) => process.stdout.write(JSON.stringify({ out, calls })))
  .catch((error) => { console.error(error); process.exitCode = 1 })
"""
    result = _run_harness(".claude/workflows/std-evidence.js", harness)
    assert result["calls"] == ["probe:engine"]
    assert result["out"]["held"] == "run_budget_exhausted"
    assert result["out"]["agentCallsUsed"] == 1
    assert result["out"]["evidenceAttemptsUsed"] == 1


def test_agent_budget_is_required_and_cannot_exceed_run_limit():
    for script in (
        ".claude/workflows/std-plan.js",
        ".claude/workflows/std-implement.js",
        ".claude/workflows/std-evidence.js",
    ):
        source = (ROOT / script).read_text(encoding="utf-8")
        assert "A.remainingAgentCalls === undefined ? 40" not in source
        assert "REMAINING_AGENT_CALLS > MAX_AGENT_CALLS" in source


def test_implement_reports_zero_call_budget_exhaustion():
    harness = r"""
const fs = require('fs')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let source = fs.readFileSync(process.argv[1], 'utf8').replace('export const meta =', 'const meta =')
const calls = []
const agent = async (_prompt, options) => {
  if (options.label.startsWith('governance:apex:')) {
    return { allowDispatch: true, Scope: 's', Evidence: 'e', Finding: 'f', Uncertainty: 'u', Risk: 'r', 'Next step': 'n' }
  }
  calls.push(options.label); throw new Error('must not run') }
const run = new AsyncFunction('args', 'phase', 'log', 'agent', source)
run({
  planPath: 'plan.md', worktreeRoot: 'C:/repo', branch: 'codex/demo', specPath: 'spec.md',
  remainingAgentCalls: 0,
}, () => {}, () => {}, agent)
  .then((out) => process.stdout.write(JSON.stringify({ out, calls })))
  .catch((error) => { console.error(error); process.exitCode = 1 })
"""
    result = _run_harness(".claude/workflows/std-implement.js", harness)
    assert result["calls"] == []
    assert result["out"]["held"] == "run_budget_exhausted"
    assert result["out"]["agentCallsUsed"] == 0
