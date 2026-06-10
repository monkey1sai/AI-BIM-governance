export const meta = {
  name: 'fe-redesign-alignment-audit',
  description: '前端設計重構：以 582273a baseline 程式碼比對 frontend-redesign-ia-and-phases.html 六維度，對抗驗證後回結構化 差異/疑慮/矛盾',
  phases: [
    { title: 'Audit', detail: '6 維度各一 auditor 讀碼比對設計文件' },
    { title: 'Verify', detail: '對抗驗證每維度的矛盾/疑慮/高風險差異' },
  ],
}

const BASE = [
  '稽核基準：repo C:/Repos/active/iot/AI-BIM-governance，git main 已 fast-forward 到整合 baseline 582273a（= codex/runtime-orchestrator-phase-1 rebase 保 #187）。',
  '前端在 web-viewer-sample/src/ 與 web-viewer-sample/src/console/；coordinator 後端在 bim-review-coordinator/（用 Grep/Glob 找）。設計文件全文在 frontend-redesign-ia-and-phases.html（可 Read 取脈絡）。',
  '這是「靜態程式碼 vs 設計文件」稽核；可操作性/瀏覽器證據另由主流程用 gstack 收集，你聚焦：程式碼是否存在、設計 token 是否一致、結構是否對齊。',
  '重要分類規則：設計文件是 2026-06-05 的「目標態藍圖」，內含明確未來項（★新增、A4–A10 disabled、CH-G URL 收斂未做）。',
  '  - 文件標為未來、現未實作 → gaps 但 severity=planned。',
  '  - 文件說「現況該有 / 已 asbuilt」但程式碼沒有或相反 → gaps（low/medium/high/critical）。',
  '  - 文件自身或與既有鐵律（誠實降級、coordinator :8004 唯一可達面、前端不直連 _bim-control）互相打架 → contradictions。',
  '  - 看不準、需執行期才能確認 → concerns。',
  '每個發現附 file:line 證據。只輸出結構化資料，不要客套話。'
].join('\n')

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    aligned: { type: 'array', items: { type:'object', additionalProperties:false, properties:{ item:{type:'string'}, evidence:{type:'string'} }, required:['item','evidence'] } },
    gaps: { type:'array', items:{ type:'object', additionalProperties:false, properties:{ item:{type:'string'}, doc_says:{type:'string'}, code_is:{type:'string'}, severity:{type:'string', enum:['planned','low','medium','high','critical']}, evidence:{type:'string'} }, required:['item','doc_says','code_is','severity','evidence'] } },
    concerns: { type:'array', items:{ type:'object', additionalProperties:false, properties:{ item:{type:'string'}, why:{type:'string'}, evidence:{type:'string'} }, required:['item','why','evidence'] } },
    contradictions: { type:'array', items:{ type:'object', additionalProperties:false, properties:{ item:{type:'string'}, doc_says:{type:'string'}, conflicts_with:{type:'string'}, evidence:{type:'string'} }, required:['item','doc_says','conflicts_with','evidence'] } },
  },
  required: ['dimension','aligned','gaps','concerns','contradictions'],
}

const VERIFY_SCHEMA = {
  type:'object', additionalProperties:false,
  properties:{ dimension:{type:'string'}, verdicts:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{ claim:{type:'string'}, kind:{type:'string', enum:['gap','concern','contradiction']}, verdict:{type:'string', enum:['confirmed','refuted','uncertain']}, note:{type:'string'} }, required:['claim','kind','verdict','note'] } } },
  required:['dimension','verdicts'],
}

const DIMENSIONS = [
  { key:'ia', title:'IA / 可達面 / 路由',
    spec:[
      '瀏覽器唯一可達面 = coordinator :8004。:8004/ui = UnifiedConsole（正規 console 入口，合併後・項目4/5）。',
      'Plane GOVERNANCE PLATFORM（零 GPU）路由：#/coordinator（控制台 移植・真實）、#/intake（Model Intake + 開模 + Binding）、#/runtime（Kit 綁定/串流觀測）、#/review（失敗構件派工 handoff）、#/kit（Kit 模型台，經 /api/kit proxy）。',
      'Plane GOVERNANCE A1–A10 路由：#/overview、#/issues、#/apps …；Review Room → primary viewer overlay 深連結。',
      ':8004/ui/open?session=… = handoff 302 → viewer（逐字節凍結・CI guard）。',
      'coordinator 後端：coordinator REST（session/intake/runtime）、governanceProxy（A1–A3 → :49102）、kitProxy ★新增（/api/kit/* → :8010）。',
      'internal/loopback（瀏覽器不可達）：governance-service :49102、kit-manager :8010→loopback（前端退役）、streaming-server（Signaling :1280、Media :1281）。'
    ].join('\n'),
    files:'web-viewer-sample/src/console/routing.ts、pages.tsx、main.tsx；coordinator 路由與 proxy：bim-review-coordinator/ 內 Grep "/api/kit"、"governanceProxy"、"/ui/open"、"302"、":49102"、":8010"；compose.runtime-manager.yml、compose.host-kit.yml' },

  { key:'tokens', title:'設計風格 / design tokens',
    spec:[
      '設計尺規 = Anthropic 前端原則 + NVIDIA Kit primary/spectator。字型 JetBrains Mono + Noto Sans TC, monospace。',
      'body 背景 #020617、文字白。語意色：cyan #22d3ee（前端）、emerald #34d399（coordinator 後端）、amber #fbbf24（Kit/proxy）、violet #a78bfa（治理權威/DB）、rose #fb7185（handoff/critical）。NVIDIA green #76b900（強調/分期標）。',
      'card：背景 rgba(15,23,42,0.5)、border #1e293b、圓角；grid 背景線 #1e293b。'
    ].join('\n'),
    files:'web-viewer-sample/src/console/edge-console.css、components.tsx；web-viewer-sample/src/ 其他 *.css；比對上述 CSS 變數/顏色/字型是否一致、有無散落硬編碼或偏離 token' },

  { key:'viewer', title:'viewer 元件結構（USDStage / ViewportLayer / GovernanceOverlay / BindingComposer）',
    spec:[
      'viewer <App/> 經 /ui/open 進場、WebRTC 連 streaming-server。',
      '<USDStage> 左側 USD 樹（項目1）：點 prim path → 相機以該元件聚焦；viewport 點選 → 回灌樹 + 展開祖先；useViewerInteraction（A1/A2/A3 共用）。',
      '<ViewportLayer> 16:10 WebRTC：primary 操作・spectator 唯讀跟隨；DataChannel: open/focus/select/highlight。',
      '<GovernanceOverlay> 右側治理疊層：<OperationBar> + <ObservationPanel>（項目1，rule-run/issue/BCF）；<BindingComposer mode=live> ★主入口（選 N 個 USDC・指定 primary・重載 stage，項目3）；spectator → 全 aria-disabled + 誠實 banner。'
    ].join('\n'),
    files:'web-viewer-sample/src/ 的 App 進場與 viewer 元件；Grep USDStage、ViewportLayer、BindingComposer、OperationBar、ObservationPanel、useViewerInteraction；web-viewer-sample/src/console/GovernanceOverlay.tsx、console/viewer/' },

  { key:'ps', title:'primary/spectator 一致性 + 誠實降級',
    spec:[
      '單一判定來源：viewer 走 resolveGovPanelState，console 走 operatorOpsState。',
      '三層縱深：UI disabled → send no-op → 後端 source_client_id（權威）。',
      'spectator 不隱藏按鈕：aria-disabled + 理由 banner（誠實鐵律）。',
      '前端 gate 僅 UX，非授權邊界（文件須明示）。'
    ].join('\n'),
    files:'Grep resolveGovPanelState、operatorOpsState、source_client_id、aria-disabled、spectator、banner（web-viewer-sample/ 全域 + bim-review-coordinator/ 後端 source_client_id 驗證）' },

  { key:'phases', title:'分期 CH-A→CH-G + 三條紅線 + 關鍵裁決',
    spec:[
      '依賴鏈：CH-A(P0 設計token+共用元件骨架,低風險純前端) → CH-B(P1 viewer樹→聚焦,A1操作/觀測+gate,高風險改 Window.tsx) →(CH-C P1.5並行 streaming角色權威 source_client_id 驗證,跨sub-repo)→ CH-D(P2 kit /api/kit/* reverse-proxy,邊界風險先行PR) → CH-E(P3 console handoff+合併頁項2+4,高風險 bootstrap) → CH-F(P4 Binding主入口 overlay+intake,高風險雙寫一致) → CH-G(P5 URL收斂 移除舊別名,CRITICAL)。',
      '項目→change：項目1→CH-B、項目2→CH-E、項目3→CH-F、項目4→CH-D+CH-E、項目5→CH-G；每期 done = browser E2E evidence。',
      '三條紅線：RK6 CRITICAL（CH-G redirect 必精確列舉，禁 /ui/* 萬用 會吃掉 /ui/open + CI guard）；RK5 HIGH（P1/P3/P4 都改 Window.tsx，動前 MUST gitnexus_impact，邏輯抽 hook）；RK1 HIGH（kitProxy 只 forward，Kit 控制權威留 kit-manager）。',
      '關鍵裁決：/ui/console 不存在 → 301 安全網收斂到 /ui；console 不長 WebRTC，3D 操作一律 handoff 跳 primary viewer；:8010 經 /api/kit/* proxy 化、改 loopback、前端退役；A1 先落地抽象，A2/A3 接同一 hook 列後續 change。'
    ].join('\n'),
    files:'Grep "/api/kit"、"/ui/console"、"301"、"/ui/*"、wildcard、Window.tsx、kitProxy、kit-manager；openspec/changes/ 下相關 change 與 specs/roadmap；git log --oneline -30；判斷 CH-A~CH-G 哪些已落地（582273a baseline）' },

  { key:'a1a10', title:'A1–A10（A1–A3 asbuilt / A4–A10 disabled）',
    spec:[
      'Plane 2：A1–A3 asbuilt（真實資料、可操作），A4–A10 願景（disabled）。',
      'routing 認得 a1..a10；Review Room → primary viewer overlay 深連結。'
    ].join('\n'),
    files:'web-viewer-sample/src/console/routing.ts、pages.tsx、data.ts；Grep a1..a10 路由與渲染、A1/A2/A3 真實資料來源（governanceProxy/:49102）、A4–A10 disabled/vision 標記' },
]

const results = await pipeline(
  DIMENSIONS,
  d => agent(
    BASE + '\n\n# 稽核維度：' + d.title +
    '\n\n## 設計文件規格（節錄自 frontend-redesign-ia-and-phases.html）\n' + d.spec +
    '\n\n## 應檢視的程式碼\n' + d.files +
    '\n\n逐項比對規格與實際程式碼，輸出 aligned / gaps / concerns / contradictions（每項附 file:line 證據）。',
    { label:'audit:'+d.key, phase:'Audit', schema: FINDINGS_SCHEMA }
  ),
  (audit, d) => {
    const flags = [
      ...(audit.contradictions||[]).map(c => ({ kind:'contradiction', claim: c.item+' — 文件:'+c.doc_says+' ↔ 衝突:'+c.conflicts_with, evidence:c.evidence })),
      ...(audit.concerns||[]).map(c => ({ kind:'concern', claim: c.item+' — '+c.why, evidence:c.evidence })),
      ...(audit.gaps||[]).filter(g => g.severity==='high' || g.severity==='critical').map(g => ({ kind:'gap', claim: g.item+' — 文件:'+g.doc_says+' / 程式:'+g.code_is, evidence:g.evidence })),
    ]
    if (!flags.length) return { audit, verify: { dimension: d.title, verdicts: [] } }
    return agent(
      BASE + '\n\n# 對抗驗證：維度 ' + d.title +
      '\n\n下列是 auditor 提出的矛盾/疑慮/高風險差異。逐項回到證據（file:line）親自查證，預設懷疑、試圖反駁。只有親讀證據確認屬實才標 confirmed；查無據/誤判標 refuted；無法確定標 uncertain，note 寫關鍵理由。\n\n待驗清單：\n' +
      flags.map((f,i) => (i+1)+'. ['+f.kind+'] '+f.claim+'\n   證據：'+f.evidence).join('\n'),
      { label:'verify:'+d.key, phase:'Verify', schema: VERIFY_SCHEMA }
    ).then(v => ({ audit, verify: v }))
  }
)

return results