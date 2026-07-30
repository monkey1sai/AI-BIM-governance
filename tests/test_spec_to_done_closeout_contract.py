import json
import pathlib
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / ".claude/workflows/std-evidence-closeout.js"


HARNESS = r"""
const fs = require('fs')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let source = fs.readFileSync(process.argv[1], 'utf8')
source = source.replace('export const meta =', 'const meta =')
const mode = process.argv[2]
const calls = []
let attempt = 0
const taskIds = ['10.1', '10.2', '10.3', '10.4', '10.5']

const agent = async (_prompt, options) => {
  if (options.label.startsWith('governance:apex:')) {
    return { allowDispatch: true, Scope: 's', Evidence: 'e', Finding: 'f', Uncertainty: 'u', Risk: 'r', 'Next step': 'n' }
  }
  calls.push(options.label)
  if (options.label.startsWith('closeout:execute:')) {
    attempt += 1
    return {
      status: mode === 'scope-drift' ? 'SCOPE_DRIFT' : 'DONE',
      completedTaskIds: taskIds,
      changedFiles: mode === 'nested-docs-bypass' ? ['src/docs/evil.js']
        : mode === 'other-change' ? ['openspec/changes/other/tasks.md']
        : mode === 'spec-rewrite' ? ['openspec/changes/demo/specs/logging/spec.md']
        : mode === 'absolute-path' ? ['C:/repo/docs/evidence/demo.md']
        : ['docs/evidence/demo.md'],
      productionFilesChanged: mode === 'scope-drift' ? ['src/product.py'] : [],
      evidenceHead: mode === 'stale' ? '1234567' : 'abcdef1',
      evidencePaths: mode === 'empty-evidence' ? []
        : mode === 'evidence-path-bypass' ? ['src/secret.txt']
        : ['docs/evidence/demo.md'],
      commitSha: '7654321',
      gaps: [],
      summary: 'done',
    }
  }
  if (options.label.startsWith('closeout:verify:')) {
    const shouldRetry = mode === 'retry' && attempt === 1
    return {
      ok: !shouldRetry,
      evidenceHead: 'abcdef1',
      taskVerdicts: taskIds.map((id) => ({ id, closed: !shouldRetry, reason: shouldRetry ? 'thin' : 'closed' })),
      findings: shouldRetry || mode === 'findings-with-ok' ? [{ id: 'e1', q: 'evidence too thin' }] : [],
    }
  }
  throw new Error(`unexpected agent label: ${options.label}`)
}

const run = new AsyncFunction('args', 'phase', 'log', 'agent', source)
run({
  worktreeRoot: 'C:/repo',
  changePath: 'C:/repo/openspec/changes/demo',
  closeoutTaskIds: taskIds,
  expectedHead: 'abcdef1',
  maxEvidenceAttempts: 2,
  remainingAgentCalls: 40,
}, () => {}, () => {}, agent)
  .then((out) => process.stdout.write(JSON.stringify({ out, calls })))
  .catch((error) => {
    process.stderr.write(error.stack || String(error))
    process.exitCode = 1
  })
"""


def _run(mode="normal"):
    proc = subprocess.run(
        ["node", "-e", HARNESS, str(JS), mode],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


def test_closeout_runs_only_executor_and_independent_verifier():
    result = _run()
    assert result["calls"] == ["closeout:execute:r1", "closeout:verify:r1"]
    assert result["out"]["ok"] is True
    assert result["out"]["completedTaskIds"] == ["10.1", "10.2", "10.3", "10.4", "10.5"]
    assert result["out"]["agentCallsUsed"] == 2


def test_scope_drift_and_stale_evidence_fail_closed():
    drift = _run("scope-drift")["out"]
    stale = _run("stale")["out"]
    assert drift["held"] == "scope_drift"
    assert stale["held"] == "evidence_stale"


def test_scope_path_bypasses_and_empty_evidence_fail_closed():
    for mode in (
        "nested-docs-bypass",
        "other-change",
        "spec-rewrite",
        "absolute-path",
    ):
        assert _run(mode)["out"]["held"] == "scope_drift"
    for mode in ("empty-evidence", "evidence-path-bypass"):
        invalid = _run(mode)
        assert invalid["out"]["held"] == "evidence_not_closing"
        assert invalid["out"]["evidenceAttemptsUsed"] == 2
        assert invalid["calls"] == ["closeout:execute:r1", "closeout:execute:r2"]


def test_contradictory_ok_verdict_cannot_discard_findings():
    result = _run("findings-with-ok")
    assert result["out"]["held"] == "evidence_not_closing"
    assert result["out"]["findings"] == [{"id": "e1", "q": "evidence too thin"}]
    assert result["calls"] == [
        "closeout:execute:r1",
        "closeout:verify:r1",
        "closeout:execute:r2",
        "closeout:verify:r2",
    ]


def test_evidence_retry_is_bounded_to_two_attempts():
    result = _run("retry")
    assert result["calls"] == [
        "closeout:execute:r1",
        "closeout:verify:r1",
        "closeout:execute:r2",
        "closeout:verify:r2",
    ]
    assert result["out"]["ok"] is True
    assert result["out"]["evidenceAttemptsUsed"] == 2
    assert result["out"]["agentCallsUsed"] == 4
