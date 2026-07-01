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
    inFlightVerdict: { type: 'string', description: 'the immediate-next obligation: finish the in-flight item, or it is already mergeable' },
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
log('6 路平行：3 規格抽取 + 前端/後端現狀 + git merged/in-flight 狀態')

const reads = await parallel([
  () => agent(
    `Read ${PLANS}/ai-bim-governance-開發軌跡與執行計畫.md IN FULL — the v3 trajectory, the AUTHORITATIVE implementation-order doc. Extract: every milestone M0..M8 (id, kind='milestone', title, scope, dod, dependencies); App API drafts (kind='a-item' if mapping to A1..A10 else 'milestone'); decisions D1..D9 (kind='decision'); open items O1..O6 (kind='open-item'). Be precise about the FIXED SEQUENCE M0->M1(A1 pure CPU)->M2 轉檔->M3 串流->M4 3D->M5+ and which milestone gates which. measured_status='unknown'. Analysis only; do NOT modify any file.`,
    { label: 'spec:v3-trajectory', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Read ${PLANS}/ai-bim-governance-互動實作規格與標準對齊.md IN FULL — the HIGHEST-AUTHORITY behavior contract. Extract: PART A 實測差距 (each kind='gap', measured_status working|partial|broken|not-built, dod=what 'fixed' looks like — be exhaustive, these are the most concrete candidates); PART B interaction cards IX-xx (kind='interaction-card', dod=acceptance) — EXPLICITLY capture EVERY IX-CV-0x AND IX-SS-0x AND IX-KG-0x card with whether it is marked 待建/已建; PART C three-domain standard alignment (kind='standard'). Analysis only; do NOT modify any file.`,
    { label: 'spec:interaction-gaps', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Read ${PLANS}/ai-bim-governance-設計規格.md IN FULL (v2 design). Extract A1..A10 interface analysis: each id (A1..A10), kind='a-item', title, scope, dod (interface acceptance), dependencies. Also MinIO three-tier storage + Issue/BCF schema as kind='design'. Analysis only; do NOT modify any file.`,
    { label: 'spec:design-a-items', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
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
    `Establish the MERGED-vs-IN-FLIGHT spec-to-done state for repo ${REPO}. Use git + the state files under ${REPO}/artifacts/spec-to-done/*.md.\n` +
    `1) MERGED: read 'git -C ${REPO} log --oneline -40 origin/main'. Identify recently merged spec-to-done features and their IX-xx id where stated (e.g. M2-a coverage report #218 = IX-CV-02, M2-b prioritize/retry #221 = IX-CV-03). Return merged[] {id, title, pr, mergedCommit}.\n` +
    `2) IN-FLIGHT: list worktrees ('git -C ${REPO} worktree list') and for each non-main branch inspect 'git -C <worktree> log --oneline -15' and 'git -C <worktree> status -s'. The branch claude/peaceful-payne-6785a9 (worktree .claude/worktrees/peaceful-payne-6785a9) is the conv-watch-toggle / IX-CV-04 / M2-c work. Read its state file ${REPO}/artifacts/spec-to-done/conv-watch-toggle-state.md. Determine: branch, how many plan tasks are committed vs remaining, whether a PR is open ('gh pr list --state open'), merged=false if not on origin/main, and what remains to finish. Return inFlight[] {id, title, branch, progress, merged, prOpen, remaining}.\n` +
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
  `AUTHORITY ORDER (higher wins): 互動實作規格(behavior/standards) > v3 計畫(order/DoD) > v2 規格(interface).\n` +
  `FIXED IMPLEMENTATION ORDER: M0 -> M1 (A1 核心閉環, pure CPU) -> M2 轉檔 -> M3 串流 -> M4 3D 連動 -> M5+.\n\n` +
  `=== STRUCTURED SPEC EXTRACTION (3 docs) ===\n${JSON.stringify(specReads)}\n\n` +
  `=== CURRENT REPO BUILD-STATE AUDIT (frontend + backend, from main) ===\n${JSON.stringify(repoReads)}\n\n` +
  `=== MERGED + IN-FLIGHT spec-to-done STATE ===\n${JSON.stringify(flight)}\n\n` +
  `HARD CONSTRAINTS:\n` +
  `- EXCLUDE any item already in 'merged' — it is done.\n` +
  `- The item(s) in 'inFlight' are NOT valid "next new" candidates — they are already being built on a branch. Instead, summarize them in inFlightVerdict as the IMMEDIATE obligation (finish-then-merge) the human must clear first.\n` +
  `- A candidate must be a UI-facing controlled action / feature whose backend + read-side dependencies are ALREADY met on main (per the audit), so it can be a clean single spec-to-done. If the read-side (real data feed) for an area is still DEMO, a write/controlled-action there is BLOCKED — say so and prefer something buildable now.\n\n` +
  `TASK:\n` +
  `1) currentState: one tight paragraph — where the project sits on M0-M8 / A1-A10, and the frontier (#conv controlled-action series IX-CV-02/03 merged, IX-CV-04 in flight).\n` +
  `2) inFlightVerdict: state plainly that the immediate next action is to finish + merge the in-flight conv-watch-toggle (IX-CV-04 / M2-c), with what remains.\n` +
  `3) candidates: 2-4 ranked options for the NEXT NEW spec-to-done to start AFTER the in-flight one merges. Respect milestone order; dependencies must be met (set dependenciesMet); each a coherent SINGLE spec-to-done scope. Consider: remaining #conv polish, the IX-SS-03/04 runtime-session controlled actions (force-release / terminate) IF #sessions shows real data, A2 version-diff continuation, or any PART A measured gap. Each: rank, id, title, why, scope, dod, dependencies, dependenciesMet, risk, estimatedSize (S|M|L).\n` +
  `4) recommendation: which candidate and why (2-3 sentences), explicitly noting it comes AFTER conv-watch-toggle merges.\n` +
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
  `2) ALREADY in-flight on a branch (e.g. conv-watch-toggle)? If so verdict=in-flight-already.\n` +
  `3) BLOCKED by an unbuilt earlier-milestone dependency, OR by its own read-side data still being DEMO (a controlled action on mock data violates the 誠實鐵律)? List blockingDependencies.\n` +
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