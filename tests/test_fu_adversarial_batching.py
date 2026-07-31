import json
import pathlib
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / ".claude/workflows/fu-adversarial-verify-generic.js"


HARNESS = r"""
const fs = require('fs')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let source = fs.readFileSync(process.argv[1], 'utf8')
source = source.replace('export const meta =', 'const meta =')
const findings = JSON.parse(process.argv[2])
const mode = process.argv[3]
const calls = []
let verifierCall = 0
const HEAD = 'a'.repeat(40)
const BASE = 'c'.repeat(40)
const TARGET = 'd'.repeat(40)
const ROOT = 'C:/repo'

const commandText = (strings, values) => strings.reduce(
  (result, part, index) => result + part + (index < values.length ? String(values[index]) : ''), '')
const dollar = (strings, ...values) => {
  const command = commandText(strings, values)
  return { text: async () => {
    if (command === `git -C ${ROOT} status --porcelain`) return ''
    if (command === `git -C ${ROOT} rev-parse HEAD`) return HEAD
    if (command === `git -C ${ROOT} cat-file -t ${TARGET}`) return 'commit\n'
    if (command === `git -C ${ROOT} cat-file -t ${BASE}`) return 'commit\n'
    if (command === `git -C ${ROOT} cat-file -t ${HEAD}`) return 'commit\n'
    if (command === `git -C ${ROOT} merge-base ${TARGET} ${HEAD}`) return BASE
    if (command === `git -C ${ROOT} show ${HEAD}:src/x.py`) {
      return `${Array(6).fill('// context').join('\n')}\nconst observed = true\n`
    }
    throw new Error(`unexpected command: ${command}`)
  } }
}

const batchFromPrompt = (prompt) => {
  const match = prompt.match(/<untrusted-findings-json>([\s\S]*?)<\/untrusted-findings-json>/)
  if (!match) throw new Error('missing encoded findings')
  return JSON.parse(JSON.parse(match[1]))
}

const evidence = () => ({ file: 'src/x.py', line: 7, quote: 'const observed = true' })
const verdict = (id) => ({
  finding_id: id,
  verdict: 'refuted',
  disposition: 'none',
  scope: 'in_scope',
  reason: `refuted:${id}`,
  unblock_condition: null,
  evidence: evidence(),
})

const agent = async (prompt, options) => {
  if (options.label.startsWith('governance:apex:')) {
    return { allowDispatch: true, Scope: 's', Evidence: 'e', Finding: 'f', Uncertainty: 'u', Risk: 'r', 'Next step': 'n' }
  }
  calls.push(options.label)
  if (options.label.startsWith('verify-batch:')) {
    verifierCall += 1
    if (mode === 'null-batch' && verifierCall === 1) return null
    const verdicts = batchFromPrompt(prompt).map(({ id }) => verdict(id))
    if (mode === 'duplicate-output' && verifierCall === 1 && verdicts.length > 1) {
      verdicts[1].finding_id = verdicts[0].finding_id
    }
    return { verdicts }
  }
  if (options.label.startsWith('critic:')) return { issues: [] }
  throw new Error(`unexpected agent label: ${options.label}`)
}
const parallel = async (thunks) => Promise.all(thunks.map((thunk) => thunk()))
const run = new AsyncFunction('args', 'phase', 'log', 'parallel', 'agent', '$', source)
run({
  root: ROOT,
  label: 'batch-contract',
  targetSha: TARGET,
  baseSha: BASE,
  subjectSha: HEAD,
  domainContext: 'generic batch verification contract',
  findings,
  maxVerifierBatches: 2,
  remainingAgentCalls: 40,
  p5Round: 1,
}, () => {}, () => {}, parallel, agent, dollar)
  .then((out) => process.stdout.write(JSON.stringify({ out, calls })))
  .catch((error) => {
    process.stderr.write(error.stack || String(error))
    process.exitCode = 1
  })
"""


def _run(findings, mode="normal"):
    proc = subprocess.run(
        ["node", "-e", HARNESS, str(JS), json.dumps(findings), mode],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


def _findings(count):
    return [
        {"id": f"f-{index:02d}", "q": f"verify finding {index}", "suspectFile": "src/x.py"}
        for index in range(count)
    ]


def test_twenty_two_findings_use_two_batches_then_one_critic():
    result = _run(_findings(22))
    assert result["calls"] == [
        "verify-batch:1",
        "verify-batch:2",
        "critic:batch-contract",
    ]
    assert result["out"]["verifierBatchCount"] == 2
    assert result["out"]["agentCallsUsed"] == 4
    assert [item["finding_id"] for item in result["out"]["verdicts"]] == [
        item["id"] for item in _findings(22)
    ]


def test_duplicate_input_ids_fail_before_spawning_agents():
    findings = _findings(2)
    findings[1]["id"] = findings[0]["id"]
    result = _run(findings)
    assert result["calls"] == []
    assert result["out"]["held"] == "bad_findings"


def test_more_than_registry_budget_fails_closed():
    result = _run(_findings(33))
    assert result["calls"] == []
    assert result["out"]["held"] == "run_budget_exhausted"


def test_null_or_duplicate_batch_output_is_reviewer_failure():
    null_result = _run(_findings(4), "null-batch")
    duplicate_result = _run(_findings(4), "duplicate-output")
    assert null_result["out"]["held"] == "reviewer_agent_failed"
    assert duplicate_result["out"]["held"] == "reviewer_agent_failed"


def test_source_has_no_per_finding_parallel_fanout():
    source = JS.read_text(encoding="utf-8")
    assert "FINDINGS.map((f) => () =>" not in source
    assert "MAX_VERIFIER_BATCHES = 2" in source
    assert "MAX_FINDINGS = 32" in source
