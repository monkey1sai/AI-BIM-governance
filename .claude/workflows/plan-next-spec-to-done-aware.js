export const meta = {
  name: 'plan-next-spec-to-done-aware',
  description: 'Recommend the next spec-to-done for AI-BIM-governance, aware of merged + in-flight branch work',
  phases: [
    { title: 'Understand', detail: '3 規格讀 + 前後端現狀 + git/in-flight 狀態(6 路平行)' },
    { title: 'Synthesize', detail: '排除已 merged/在飛項目 → 排序候選' },
    { title: 'Verify', detail: '對抗驗證 top 候選(含 already-built / in-flight / 依賴未足)' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    source: { type: 'string' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' }, kind: { type: 'string' }, title: { type: 'string' },
        scope: { type: 'string' }, dod: { type: 'string' },
        dependencies: { type: 'array', items: { type: 'string' } },
        measured_status: { type: 'string' },
      }, required: ['id', 'kind', 'title'] } },
    notes: { type: 'string' },
  }, required: ['source', 'items'],
}

const PROBE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    area: { type: 'string' },
    built: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { feature: { type: 'string' }, evidence: { type: 'string' }, status: { type: 'string' } },
      required: ['feature', 'status'] } },
    notBuilt: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  }, required: ['area', 'built'],
}

const FLIGHT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    merged: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string' }, title: { type: 'string' }, pr: { type: 'string' }, mergedCommit: { type: 'string' } },
      required: ['id', 'title'] } },
    inFlight: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' }, title: { type: 'string' }, branch: { type: 'string' },
        progress: { type: 'string', description: 'how far: which tasks committed vs remaining' },
        merged: { type: 'boolean' }, prOpen: { type: 'boolean' },
        remaining: { type: 'string', description: 'what is left to finish it' },
      }, required: ['id', 'title', 'branch', 'merged'] } },
    notes: { type: 'string' },
  }, required: ['merged', 'inFlight'],
}

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    currentState: { type: 'string' },
    inFlightVerdict: { type: 'string', description: 'evidence-based disposition of mapped in-flight product work, or an explicit statement that none exists' },
    candidates: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        rank: { type: 'number' }, id: { type: 'string' }, title: { type: 'string' },
        why: { type: 'string' }, scope: { type: 'string' }, dod: { type: 'string' },
        dependencies: { type: 'array', items: { type: 'string' } },
        dependenciesMet: { type: 'boolean' }, risk: { type: 'string' }, estimatedSize: { type: 'string' },
      }, required: ['rank', 'id', 'title', 'why', 'scope', 'dod', 'dependenciesMet'] } },
    recommendation: { type: 'string' },
  }, required: ['currentState', 'inFlightVerdict', 'candidates', 'recommendation'],
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    candidateId: { type: 'string' },
    verdict: { type: 'string', description: 'confirmed-next | blocked-by-dependency | already-built | in-flight-already | wrong-scope' },
    reasoning: { type: 'string' },
    blockingDependencies: { type: 'array', items: { type: 'string' } },
    alreadyBuiltEvidence: { type: 'string' },
  }, required: ['candidateId', 'verdict', 'reasoning'],
}

const REPO = 'C:/Repos/active/iot/AI-BIM-governance'
const PLANS = REPO + '/docs/plans'

phase('Understand')
log('6 路平行：3 組 TRUTH/TARGET/PROCESS 抽取 + 前端/後端現狀 + git merged/in-flight 狀態')

const reads = await parallel([
  () => agent(
    `Read ${PLANS}/docs-plans-README.md, ${PLANS}/BACKLOG.md, and ${PLANS}/PROCESS.md IN FULL. Extract: every ordered active gap from BACKLOG §1 (kind='gap', preserve id/route/title/DONE/blocker/dependencies in scope+dod+dependencies); every unresolved decision from BACKLOG §2 (kind='open-item', preserve trigger and default); and the built/acceptance/document anti-corruption gates from PROCESS (kind='standard'). BACKLOG order is the implementation priority; historical M0..M8 wording is not an active task queue. measured_status='unknown'. Analysis only; do NOT modify any file.`,
    { label: 'plans:backlog-process', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Read ${PLANS}/TRUTH.md and ${PLANS}/TARGET-contracts.md IN FULL. From TRUTH extract every route/A1..A10/viewer status and evidence gap (kind='gap', measured_status working|partial|broken|not-built; never upgrade PARTIAL/not observed). From TARGET-contracts extract the 13 backend-freeze items + 4 approved exceptions, 22 canonical routes + 9 aliases + #review retained page, official standards, and EVERY IX-TN-01..04 card (kind='standard' or 'interaction-card', dod=acceptance). Analysis only; do NOT modify any file.`,
    { label: 'plans:truth-contracts', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Read ${PLANS}/TARGET-shell.md and ${PLANS}/TARGET-viewer.md IN FULL. Extract A1..A10 and all 22 route target slices (kind='a-item' for A1..A10, otherwise kind='design'; preserve API, UI, acceptance and dependencies), EVERY route-owned IX card (IX-A1×8, IX-CV×4, IX-SS×5, IX-KG×4), EVERY IX-3D-01..05 card, viewer AC-1..21, and M0..M8 milestone vocabulary. These are target requirements only; measured_status='unknown' and actual build state must come from TRUTH. Analysis only; do NOT modify any file.`,
    { label: 'plans:target-slices', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Audit the CURRENT BUILD STATE of the AI-BIM-governance FRONTEND in repo ${REPO}. Shell = React 18 + TS "EdgeConsole" served by coordinator at /ui (build:ui, hash router). Routes (hash, NO slash): #home #a1 #a2 #viewer #conv #sessions #instances #minio #review + operator #kit #demo-control. For EACH route decide REALLY built+wired-to-real-backend vs PARTIAL/DEMO (mock/DEMO-DATA/placeholder) vs NOT built. CRITICAL FOCUS: for #conv report the state of each controlled action (coverage expand, prioritize, retry, watch toggle); for #sessions / #instances report whether they show REAL runtime/session data or DEMO DATA, and whether any session controlled action (force-release stale endpoint, terminate session) exists or is disabled/mock. Report built[] (feature, evidence=file:line or route, status=real|demo|stub|partial) and notBuilt[]. BE HONEST about mock/DEMO-DATA. Read-only.`,
    { label: 'repo:frontend-routes', phase: 'Understand', schema: PROBE_SCHEMA, agentType: 'Explore', model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Audit the CURRENT BUILD STATE of the AI-BIM-governance BACKEND in repo ${REPO}. Services: coordinator :8004 (session/instance lifecycle + /api/* + governance proxy), governance-service :49102, conversion (host-native IFC->USD), Kit WebRTC, MinIO/local_fs. Determine IMPLEMENTED vs STUBBED for: #conv controlled actions (POST .../prioritize, POST .../retry, PUT /api/conversion/watch); Kit session lifecycle (create/terminate/recreate, 1 GPU=1 stream); session controlled actions (POST /api/sessions/:id/endpoints/:ep/release force-release, POST /api/sessions/:id/terminate) — DO THESE ENDPOINTS EXIST?; runtime status feed GET /api/runtime/status (real vs demo); A2 version diff ifcdiff; 3D DataChannel highlightPrimsRequest. Report built[] (feature, evidence=file:line, status=real|partial|stub) and notBuilt[]. Read-only.`,
    { label: 'repo:backend-capabilities', phase: 'Understand', schema: PROBE_SCHEMA, agentType: 'Explore', model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Establish the MERGED-vs-IN-FLIGHT spec-to-done state for repo ${REPO}. Use git, open PRs, BACKLOG ids, and matching state files under ${REPO}/artifacts/spec-to-done/*.md.\n` +
    `1) MERGED: read 'git -C ${REPO} log --oneline -40 origin/main'. Map only evidence-backed product items to their BACKLOG/TARGET/IX id; do not infer completion from milestone prose. Return merged[] {id, title, pr, mergedCommit}.\n` +
    `2) IN-FLIGHT: list every non-main worktree ('git -C ${REPO} worktree list'); inspect each branch with 'git -C <worktree> log --oneline -15' and 'git -C <worktree> status -s'; cross-check 'gh pr list --state open' and any matching state file. Do not assume a named branch or hard-code an item. Return active product work that maps to a BACKLOG/TARGET id as inFlight[] {id, title, branch, progress, merged, prOpen, remaining}. Put unrelated docs/governance/infra branches, dirty safety copies, and uncertain mappings in notes rather than treating them as the next product obligation.\n` +
    `Be precise and evidence-based (commit hashes). Read-only; do NOT modify, commit, or push anything.`,
    { label: 'repo:merged-and-inflight', phase: 'Understand', schema: FLIGHT_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
])

const specReads = [reads[0], reads[1], reads[2]].filter(Boolean)
const repoReads = [reads[3], reads[4]].filter(Boolean)
const flight = reads[5]
log(`規格 ${specReads.length}/3、現狀 ${repoReads.length}/2、git狀態 ${flight ? 'ok' : 'MISSING'}`)

phase('Synthesize')
const synthesis = await agent(
  `You are the lead architect selecting the NEXT single "spec-to-done" work item for AI-BIM-governance.\n\n` +
  `AUTHORITY MODEL: executable code/tests are runtime truth. In docs, TRUTH owns measured state/evidence; TARGET-* owns desired contracts; BACKLOG owns ordered active gaps and unresolved decisions; PROCESS owns delivery gates. Same-axis conflict is a documentation bug, not a reason to revive deleted-doc precedence.\n` +
  `IMPLEMENTATION PRIORITY: preserve BACKLOG §1 order after filtering by its declared blockers/dependencies and current evidence. M0..M8 is target vocabulary only, never a fixed task queue.\n\n` +
  `=== STRUCTURED SPEC EXTRACTION (3 source groups) ===\n${JSON.stringify(specReads)}\n\n` +
  `=== CURRENT REPO BUILD-STATE AUDIT (frontend + backend, from main) ===\n${JSON.stringify(repoReads)}\n\n` +
  `=== MERGED + IN-FLIGHT spec-to-done STATE ===\n${JSON.stringify(flight)}\n\n` +
  `HARD CONSTRAINTS:\n` +
  `- EXCLUDE any item already in 'merged' — it is done.\n` +
  `- Items in 'inFlight' are NOT valid "next new" candidates. Summarize their evidence and disposition in inFlightVerdict; only call one an immediate finish-then-merge obligation when it maps to active BACKLOG product work and is actually ready to converge.\n` +
  `- A candidate must be a UI-facing controlled action / feature whose backend + read-side dependencies are ALREADY met on main (per the audit), so it can be a clean single spec-to-done. If the read-side (real data feed) for an area is still DEMO, a write/controlled-action there is BLOCKED — say so and prefer something buildable now.\n\n` +
  `TASK:\n` +
  `1) currentState: one tight paragraph grounded in TRUTH plus the current code audit; use A1..A10 or M0..M8 only as descriptive vocabulary, never as inferred completion or priority.\n` +
  `2) inFlightVerdict: disposition every evidence-backed in-flight product item and say explicitly when none exists; do not promote unrelated/stale/safety-copy branches into product obligations.\n` +
  `3) candidates: 2-4 options for the NEXT NEW single spec-to-done, ranked by BACKLOG §1 after excluding merged/in-flight work and enforcing declared blockers/dependencies (set dependenciesMet). Each: rank, id, title, why, scope, dod, dependencies, dependenciesMet, risk, estimatedSize (S|M|L).\n` +
  `4) recommendation: select the highest buildable BACKLOG candidate in 2-3 sentences and name any real prerequisite or in-flight convergence gate; do not inject a historical fixed sequence.\n` +
  `Ground every claim in the provided data; flag audit-vs-spec disagreements. Analysis only; do not modify any file.`,
  { label: 'synthesize:gap-analysis', phase: 'Synthesize', schema: SYNTH_SCHEMA, model: 'opus', effort: 'high' }
)

phase('Verify')
const top = (synthesis && synthesis.candidates ? synthesis.candidates : [])
  .slice().sort((a, b) => (a.rank || 99) - (b.rank || 99)).slice(0, 3)

const verdicts = await parallel(top.map((c) => () => agent(
  `Adversarially verify this PROPOSED next work item for AI-BIM-governance (repo ${REPO}). Default to skepticism — try to DISQUALIFY it.\n\n` +
  `CANDIDATE:\n${JSON.stringify(c)}\n\n` +
  `MERGED + IN-FLIGHT context (do not re-recommend these):\n${JSON.stringify(flight)}\n\n` +
  `Check against ACTUAL repo code + git (search for real evidence):\n` +
  `1) ALREADY built or merged? Find file:line / commit evidence.\n` +
  `2) ALREADY in-flight on any evidence-backed branch? If so verdict=in-flight-already.\n` +
  `3) BLOCKED by an unmet dependency/blocker declared in BACKLOG/TARGET, OR by its own read-side data still being DEMO (a controlled action on mock data violates the 誠實鐵律)? List blockingDependencies.\n` +
  `4) Scope right for ONE spec-to-done (not a whole milestone)?\n` +
  `Verdict ∈ {confirmed-next, blocked-by-dependency, already-built, in-flight-already, wrong-scope}. Reasoning with file:line/commit evidence. Read-only; do not modify anything.`,
  { label: `verify:${c.id}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus', effort: 'high' }
)))

return {
  currentState: synthesis ? synthesis.currentState : null,
  inFlightVerdict: synthesis ? synthesis.inFlightVerdict : null,
  recommendation: synthesis ? synthesis.recommendation : null,
  candidates: synthesis ? synthesis.candidates : [],
  verdicts: verdicts.filter(Boolean),
  coverage: `${specReads.length}/3 specs, ${repoReads.length}/2 probes, flight=${flight ? 'ok' : 'missing'}`,
}
