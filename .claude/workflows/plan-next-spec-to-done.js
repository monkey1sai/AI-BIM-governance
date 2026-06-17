export const meta = {
  name: 'plan-next-spec-to-done',
  description: 'Analyze docs/plans specs against current build state to recommend the next spec-to-done item',
  phases: [
    { title: 'Understand', detail: 'parallel spec readers + repo build-state probes' },
    { title: 'Synthesize', detail: 'gap analysis -> ranked next-item candidates' },
    { title: 'Verify', detail: 'adversarially check top candidates against the real repo' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', description: 'milestone | a-item | interaction-card | decision | open-item | gap | standard | design' },
          title: { type: 'string' },
          scope: { type: 'string' },
          dod: { type: 'string', description: 'definition of done / acceptance criteria' },
          dependencies: { type: 'array', items: { type: 'string' } },
          measured_status: { type: 'string', description: 'working | partial | broken | not-built | unknown' },
        },
        required: ['id', 'kind', 'title'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['source', 'items'],
}

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    area: { type: 'string' },
    built: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          feature: { type: 'string' },
          evidence: { type: 'string', description: 'file:line or route' },
          status: { type: 'string', description: 'real | demo | stub | partial' },
        },
        required: ['feature', 'status'],
      },
    },
    notBuilt: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['area', 'built'],
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    currentState: { type: 'string', description: 'where the project sits on M0-M8 / A1-A10; what is the frontier' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rank: { type: 'number' },
          id: { type: 'string' },
          title: { type: 'string' },
          why: { type: 'string' },
          scope: { type: 'string' },
          dod: { type: 'string' },
          dependencies: { type: 'array', items: { type: 'string' } },
          dependenciesMet: { type: 'boolean' },
          risk: { type: 'string' },
          estimatedSize: { type: 'string', description: 'S | M | L' },
        },
        required: ['rank', 'id', 'title', 'why', 'scope', 'dod', 'dependenciesMet'],
      },
    },
    recommendation: { type: 'string' },
  },
  required: ['currentState', 'candidates', 'recommendation'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidateId: { type: 'string' },
    verdict: { type: 'string', description: 'confirmed-next | blocked-by-dependency | already-built | wrong-scope' },
    reasoning: { type: 'string' },
    blockingDependencies: { type: 'array', items: { type: 'string' } },
    alreadyBuiltEvidence: { type: 'string' },
  },
  required: ['candidateId', 'verdict', 'reasoning'],
}

const REPO = 'C:/Repos/active/iot/AI-BIM-governance'
const PLANS = REPO + '/docs/plans'

phase('Understand')
log('讀 3 份規格 + 探前端/後端現狀(5 路平行)')

const reads = await parallel([
  () => agent(
    `Read the file ${PLANS}/ai-bim-governance-開發軌跡與執行計畫.md IN FULL. This is the v3 trajectory — the AUTHORITATIVE IMPLEMENTATION-ORDER document for the AI-BIM-governance product. Extract a structured inventory:\n` +
    `- Every milestone M0..M8: id, kind='milestone', title, scope, dod (its Definition of Done), dependencies (ids of milestones/items it gates on).\n` +
    `- Every App API draft with its DoD (kind='a-item' if it maps to an A1..A10 item, else kind='milestone').\n` +
    `- Decisions D1..D9 (kind='decision') and open items O1..O6 (kind='open-item').\n` +
    `Be precise about the FIXED SEQUENCE (M0 地基 -> M1 A1 核心閉環 P0 純CPU -> M2 轉檔 -> M3 串流 -> M4 3D 連動 -> M5+) and which milestone gates which. Set measured_status='unknown' (this doc states the plan, not current build state). Analysis only; do NOT modify any file.`,
    { label: 'spec:v3-trajectory', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Read the file ${PLANS}/ai-bim-governance-互動實作規格與標準對齊.md IN FULL. This is the HIGHEST-AUTHORITY behavior contract. Extract:\n` +
    `- PART A 實測差距 (measured gaps vs the current build): each as kind='gap' with measured_status (working|partial|broken|not-built) and dod = what 'fixed' looks like. THESE ARE THE MOST CONCRETE next-work candidates — be exhaustive here.\n` +
    `- PART B interaction cards IX-xx (state machine / API / acceptance): each as kind='interaction-card', dod = acceptance criteria.\n` +
    `- PART C three-domain official-standard alignment (IfcOpenShell / Omniverse / NVIDIA): key binding constraints as kind='standard'.\n` +
    `Return per schema. Analysis only; do NOT modify any file.`,
    { label: 'spec:interaction-gaps', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Read the file ${PLANS}/ai-bim-governance-設計規格.md IN FULL (v2 design spec). Extract the A1..A10 interface analysis: for each A-item return id (A1..A10), kind='a-item', title, scope (what the feature does), dod (interface-level acceptance), dependencies. Also capture the MinIO three-tier storage structure and any cross-cutting Issue/BCF schema notes as kind='design'. Return per schema. Analysis only; do NOT modify any file.`,
    { label: 'spec:design-a-items', phase: 'Understand', schema: SPEC_SCHEMA, model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Audit the CURRENT BUILD STATE of the AI-BIM-governance FRONTEND in repo ${REPO}. The product shell is a React 18 + TypeScript "EdgeConsole" served by the coordinator at /ui (look for build:ui, a hash router, page components). Route contract (hash, NO slash): #home #a1 #a2 #viewer #conv #sessions #instances #minio #review, plus operator tools #kit #demo-control.\n` +
    `For EACH route/feature decide: is it REALLY built and wired to a real backend, PARTIAL/DEMO (mock/DEMO-DATA/placeholder), or NOT built? Locate the EdgeConsole source first (find the route table + page components). Report built[] (feature, evidence=file:line or route, status=real|demo|stub|partial) and notBuilt[]. BE HONEST — flag any mock data, fake buttons, or DEMO-DATA markers. Read-only; do not modify anything.`,
    { label: 'repo:frontend-routes', phase: 'Understand', schema: PROBE_SCHEMA, agentType: 'Explore', model: 'sonnet', effort: 'medium' }
  ),
  () => agent(
    `Audit the CURRENT BUILD STATE of the AI-BIM-governance BACKEND in repo ${REPO}. Services: coordinator :8004 (session/instance lifecycle + /api/* + /api/governance/* proxy), governance-service :49102 (rules / Issue / BCF, CPU), conversion (host-native IFC->USD), Kit WebRTC streaming, MinIO / local_fs storage.\n` +
    `Determine which backend capabilities are actually IMPLEMENTED vs STUBBED for: A1 rule-check + Issue + BCF closed loop; A2 version diff via ifcdiff (GlobalId-keyed JSON); conversion pipeline + mapping-coverage report (G_<guid> prims); Kit session lifecycle (create/terminate/recreate, 1 GPU=1 stream, no live migration); MinIO intake + polling auto-intake; 3D viewer DataChannel (highlightPrimsRequest). Report built[] (feature, evidence=file:line, status=real|partial|stub) and notBuilt[]. Read-only; do not modify anything.`,
    { label: 'repo:backend-capabilities', phase: 'Understand', schema: PROBE_SCHEMA, agentType: 'Explore', model: 'sonnet', effort: 'medium' }
  ),
])

const specReads = [reads[0], reads[1], reads[2]].filter(Boolean)
const repoReads = [reads[3], reads[4]].filter(Boolean)
log(`規格抽取 ${specReads.length}/3、現狀探測 ${repoReads.length}/2 完成`)

phase('Synthesize')
const synthesis = await agent(
  `You are the lead architect selecting the NEXT single "spec-to-done" work item for the AI-BIM-governance repo.\n\n` +
  `AUTHORITY ORDER (higher wins): 互動實作規格(behavior/standards) > v3 計畫(order/DoD) > v2 規格(interface) > html prototypes.\n` +
  `FIXED IMPLEMENTATION ORDER: M0 地基 -> M1 A1 核心閉環 (P0, pure CPU, no 3D) -> M2 轉檔 -> M3 串流 -> M4 3D 連動 -> M5+.\n\n` +
  `=== STRUCTURED SPEC EXTRACTION (3 docs) ===\n${JSON.stringify(specReads)}\n\n` +
  `=== CURRENT REPO BUILD-STATE AUDIT (frontend + backend) ===\n${JSON.stringify(repoReads)}\n\n` +
  `TASK:\n` +
  `1) currentState: one tight paragraph — where the project actually sits on the M0-M8 / A1-A10 timeline, what is DONE, and what is the FRONTIER (the next unmet milestone DoD or measured gap).\n` +
  `2) candidates: 2-3 ranked next-item options. Each MUST (a) respect the fixed milestone order, (b) have dependencies already met (set dependenciesMet), (c) be a coherent SINGLE spec-to-done scope (not a whole milestone). PREFER items that close a PART A measured gap or complete the current milestone's DoD over starting a brand-new milestone. Each candidate: rank, id, title, why, scope, dod, dependencies, dependenciesMet, risk, estimatedSize (S|M|L).\n` +
  `3) recommendation: which candidate and why, in 2-3 sentences.\n` +
  `Ground every claim in the provided data; if the audit and the spec disagree, say so. Analysis only; do not modify any file.`,
  { label: 'synthesize:gap-analysis', phase: 'Synthesize', schema: SYNTH_SCHEMA, model: 'opus', effort: 'high' }
)

phase('Verify')
const top = (synthesis && synthesis.candidates ? synthesis.candidates : [])
  .slice()
  .sort((a, b) => (a.rank || 99) - (b.rank || 99))
  .slice(0, 3)

const verdicts = await parallel(top.map((c) => () => agent(
  `Adversarially verify this PROPOSED next work item for AI-BIM-governance (repo ${REPO}). Default to skepticism.\n\n` +
  `CANDIDATE:\n${JSON.stringify(c)}\n\n` +
  `Check against the ACTUAL repository code (search for real evidence):\n` +
  `1) Is it ALREADY built or partially built? Find file:line evidence.\n` +
  `2) Is it BLOCKED by an unbuilt earlier-milestone dependency (per the M0->M5 order)?\n` +
  `3) Is the scope right for ONE spec-to-done, or too big / too small?\n` +
  `Verdict must be one of: confirmed-next | blocked-by-dependency | already-built | wrong-scope. Give reasoning with file:line evidence, list blockingDependencies if any, and alreadyBuiltEvidence if found. Read-only; do not modify anything.`,
  { label: `verify:${c.id}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus', effort: 'high' }
)))

return {
  currentState: synthesis ? synthesis.currentState : null,
  recommendation: synthesis ? synthesis.recommendation : null,
  candidates: synthesis ? synthesis.candidates : [],
  verdicts: verdicts.filter(Boolean),
  specCoverage: `${specReads.length}/3 specs, ${repoReads.length}/2 probes`,
}
