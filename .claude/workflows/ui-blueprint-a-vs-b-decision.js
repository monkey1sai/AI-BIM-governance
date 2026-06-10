export const meta = {
  name: 'ui-blueprint-A-vs-B-decision',
  description: '評估兩套 /ui 設計藍圖二選一：Option A(frontend-redesign-ia-and-phases / OperatorConsole / 現 main) vs Option B(設計規格+prototype / EdgeConsole / stash WIP)，5 維度 judge + 對抗驗證 → 推薦',
  phases: [
    { title: 'Judge', detail: '5 維度各一評審讀實檔評 A/B 分數+勝者' },
    { title: 'Verify', detail: '逐維度對抗驗證評審結論是否站得住' },
  ],
}

const BASE = [
  'repo C:/Repos/active/iot/AI-BIM-governance。這是一個「兩套 /ui 前端設計藍圖二選一」的產品決策評估。',
  '',
  '【Option A】= frontend-redesign-ia-and-phases.html（repo 根目錄）。UnifiedConsole / OperatorConsole：coordinator :8004 為瀏覽器唯一可達面；2-plane（GOVERNANCE PLATFORM 零GPU #/coordinator #/intake #/runtime #/review #/kit + GOVERNANCE A1–A10）；A1–A10 治理「疊在 primary viewer 的 GovernanceOverlay」；console 不長 WebRTC、3D 一律 /ui/open 302 handoff；slate #020617 + JetBrains Mono + cyan #22d3ee；primary/spectator + aria-disabled 誠實 banner。**這就是現在 main(582273a→1445c39) 已實作的方向**（web-viewer-sample/src/console/OperatorConsole.tsx 為掛載入口；A1–A3 asbuilt 真資料走 governanceProxy→:49102）。',
  '',
  '【Option B】= docs/plans/ai-bim-governance-設計規格.md + docs/plans/ai-bim-governance-prototype.html（1030 行可點原型）。EdgeConsole：三欄式（左 4 群導覽 / 中央工作區 / 右 Chat USD Agent）；左欄群＝工作台 + 核心治理 CORE(A1–A5 無 GPU 可先賣) + OMNIVERSE RUNTIME(GPU 加值 A6–A10+審查室) + SYSTEM + 落地端控制台(轉檔排程/Session/Kit·GPU 機隊/MinIO，對齊真實 MinIO 結構與 NVIDIA 官方 1-GPU-per-stream / no-migrate)；per-app 引導式 stepper（A1 五步閉環）；誠實四標記 已實作/實測/示範/待建(AS-BUILT/artifact/DEMO DATA/NOT BUILT)；token #0c0f11 底 + #84c714 綠 + 15px 系統 sans（非 JetBrains Mono）。**這就是我先前 stash 的 WIP（product-governance-console-integration）方向，也是先前部署陳舊 dist-ui 照到的那套**。',
  '',
  '【已知 ground-truth（前面稽核已驗，可信）】',
  '- 現 main 實作 = Option A 的 OperatorConsole（精簡 6 路由：coordinator/intake/runtime/review/kit/demo-control；#/overview #/issues #/apps #/a1-a10 不存在、fallback coordinator）。EdgeConsole 在現 main 是 dead code（tree-shaken）。',
  '- Option B 的程式碼以未提交 stash 形式存在（11 檔、+575 行；pages.tsx +327、EdgeConsole.tsx +105…），pop 到現 main 只有 edge-console.css 真衝突、其餘多可 auto-merge（但 AGENTS/CLAUDE auto-merge 語意要人工檢查）。',
  '- repo 剛確立「四套工具治理管線」契約（AGENTS.md §0.1）：Superpowers(plan)→GitNexus(impact)→實作→gstack(UI/E2E 驗收唯一證據)→detect_changes→PR；誠實鐵律(無 backend 處 UI 標 DEMO DATA/NOT BUILT/not observed)；OpenSpec 流程已退役。',
  '- 邊界鐵律：前端只打 coordinator :8004、不直連 :49102/:8010/:49101；「不要把 Kit 包裝成 governance 賣點」；AI 只在 session layer 操作不改 source model。',
  '- A1–A10 權威：05 BIM治理 為 10 大產品項、06 操作介面總覽 為 UX 北極星；A1–A3 已 asbuilt。',
  '',
  '請務實、有證據（file:line 或具體段落），不要客套。也評估「hybrid（取 A 的某面 + B 的某面）」是否更優，在 rationale 註明。',
].join('\n')

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    scoreA: { type: 'integer', minimum: 1, maximum: 5 },
    scoreB: { type: 'integer', minimum: 1, maximum: 5 },
    winner: { type: 'string', enum: ['A', 'B', 'tie'] },
    rationale: { type: 'string' },
    evidence: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { point: { type: 'string' }, where: { type: 'string' } }, required: ['point', 'where'] } },
    hybridNote: { type: 'string' },
    risksOfWinner: { type: 'string' },
  },
  required: ['dimension', 'scoreA', 'scoreB', 'winner', 'rationale', 'evidence', 'hybridNote', 'risksOfWinner'],
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    challenge: { type: 'string' },
    verdict: { type: 'string', enum: ['holds', 'weakened', 'overturned'] },
    adjustedWinner: { type: 'string', enum: ['A', 'B', 'tie'] },
    note: { type: 'string' },
  },
  required: ['dimension', 'challenge', 'verdict', 'adjustedWinner', 'note'],
}

const DIMS = [
  { key: 'arch', title: '架構與邊界對齊',
    lens: 'coordinator :8004 唯一可達面、前端不直連內部服務、「不要把 Kit 包裝成 governance 賣點」、session-layer-only、primary/spectator。哪個藍圖更貼合 AGENTS.md 邊界與系統架構？B 的「落地端控制台(轉檔/Session/機隊)」與 A 的「console 不長 WebRTC、一律 handoff」各自如何符合或違反邊界？' },
  { key: 'honesty', title: '誠實降級鐵律 + 四工具契約相容',
    lens: '誠實標記嚴謹度（A：aria-disabled+理由 banner+A4–A10 disabled；B：已實作/實測/示範/待建 四標記、port-has-listen≠frame）。哪個更貼合剛 merged 的四工具契約（gstack 為 UI 驗收唯一證據）與 DEMO DATA/NOT BUILT/not observed？哪個更不會「假裝完成」？' },
  { key: 'cost', title: '落地成本與現況程式碼距離',
    lens: 'A = 現 main 已實作（OperatorConsole shipped、A1–A3 asbuilt）→ 採 A 幾乎零重做。B = stash WIP 部分 + 還缺三欄殼/落地端控制台/per-app stepper/新 token 系統 + 與現 main 衝突。逐項估「從現況到該藍圖」的工時/風險。讀 web-viewer-sample/src/console/OperatorConsole.tsx 與 EdgeConsole.tsx 對照。' },
  { key: 'product', title: '產品 / 商業敘事與 UX 北極星(06)',
    lens: 'B 明確切 CORE(無 GPU 可先賣)/OMNIVERSE(GPU 加值)/落地端控制台(維運) + per-app 引導式 stepper + 三欄 Chat USD Agent；A 是精簡治理 console + viewer overlay。哪個對「賣點分層、新手 onboarding、對齊 05 BIM治理/06 操作介面北極星」更強？B 是否過度膨脹？' },
  { key: 'runtime', title: 'Kit/GPU runtime 現實、維運完整度與設計 token',
    lens: 'B 引 NVIDIA 官方(1 GPU/stream、無 migrate API、terminate+recreate、shader cache) + 落地端控制台(機隊/Session 端點池/真實 MinIO 結構)；A 的 handoff + endpoint pool。哪個對「多 GPU/多 session 維運」更完整且不誤導？另比較兩套 design token(#020617+JetBrains Mono vs #0c0f11+#84c714 15px sans) 與現 edge-console.css(#0b0d10) 的遷移成本與一致性。' },
]

const results = await pipeline(
  DIMS,
  d => agent(
    BASE + '\n\n# 評審維度：' + d.title + '\n\n## 評估重點\n' + d.lens +
    '\n\n## 必讀檔\n- Option A：frontend-redesign-ia-and-phases.html\n- Option B：docs/plans/ai-bim-governance-設計規格.md、docs/plans/ai-bim-governance-prototype.html\n- 契約/邊界：AGENTS.md（§0.1 開發管線）\n- 現況碼：web-viewer-sample/src/console/OperatorConsole.tsx、EdgeConsole.tsx（按需 Grep）\n\n給 scoreA/scoreB(1–5)、winner、rationale、evidence(附 where)、hybridNote(是否該混搭)、risksOfWinner。',
    { label: 'judge:' + d.key, phase: 'Judge', schema: JUDGE_SCHEMA }
  ),
  (j, d) => agent(
    BASE + '\n\n# 對抗驗證：維度「' + d.title + '」\n\n評審結論：winner=' + j.winner + '（A=' + j.scoreA + ' / B=' + j.scoreB + '）。rationale：' + j.rationale +
    '\n\n請當 devil’s advocate：盡力反駁這個 winner（找反證、被忽略的成本/邊界/誠實風險、或證據是否站得住）。回到實檔查證。verdict=holds/weakened/overturned；adjustedWinner=你查證後的勝者；note 寫關鍵反證或為何結論仍成立。',
    { label: 'verify:' + d.key, phase: 'Verify', schema: VERIFY_SCHEMA }
  ).then(v => ({ judge: j, verify: v }))
)

return results