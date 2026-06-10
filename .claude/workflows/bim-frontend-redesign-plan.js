export const meta = {
  name: 'bim-frontend-redesign-plan',
  description: 'Readonly：收集 Claude/Anthropic 官方前端設計技能 + Kit primary/spectator 權威模型，據以規劃 5 項前端設計重構',
  phases: [
    { title: 'Foundations', detail: '官方設計技能 + Kit 串流權限 + 設計參考 repo + 現況程式碼錨點' },
    { title: 'PlanItems', detail: '5 個項目各自規劃' },
    { title: 'Synthesize', detail: '彙整一致設計系統 + IA + 分期落地' },
  ],
}

const GOV = 'C:/Repos/active/iot/AI-BIM-governance'
const DESIGN = 'C:/Repos/design/bim-desigin-arich/project'

// ---------- Phase 1: Foundations ----------
phase('Foundations')

const F = await parallel([
  // F1 — 官方前端設計技能（web research）
  () => agent(
    `唯讀研究任務：找出 **Anthropic / Claude Code 官方推薦的「前端設計」技能/指南**，整理成一份可直接套用的「設計系統規範」。
用 WebSearch + WebFetch 查這些方向（擇優取權威來源）：
- Anthropic 官方 agent skills（GitHub: anthropics/skills、anthropics/claude-cookbooks）中與 frontend / web design / artifacts / web-design-guidelines 相關的 skill 內容
- Claude 的「web aesthetic / design guidelines」官方說法（Anthropic 部落格或 docs）
- Claude Code 內建 'frontend-design' 實作型 skill 的設計原則
產出一份**具體、可檢核**的設計規範（不要空泛口號），至少涵蓋：
1) 設計 token：色彩系統(語意色/狀態色)、字級階梯(type scale)、間距尺度(spacing)、圓角/陰影/邊框、密度(density)
2) 版面與資訊架構：layout grid、導航模式、面板/抽屜/overlay 的使用時機
3) 元件狀態鐵律：default/hover/focus/active/disabled、loading/empty/error/skeleton
4) 無障礙(a11y)：focus ring、aria-disabled vs pointer-events、鍵盤操作、對比
5) 動效節制原則
6) 針對「即時 3D 協作 / 會議主持(primary)與旁觀(spectator)」這種介面，官方設計原則會強調哪些（權限可視性、唯讀降級的誠實標示、狀態回饋）
明確標註每條來自哪個來源 URL。只研究、不改任何檔案。輸出 markdown。`,
    { label: 'F1:official-design-skill', phase: 'Foundations', agentType: 'Explore' }
  ),

  // F2 — Kit/Omniverse primary/spectator 權威模型
  () => agent(
    `唯讀研究任務：整理 **NVIDIA Omniverse Kit App Streaming 的 primary(主持/操作) vs spectator(旁觀/唯讀) 權威模型**，作為前端權限設計的依據。
用 Kit MCP 工具(透過 ToolSearch 載入 mcp__claude_ai_Kit_MCP__* 例如 search_kit_knowledge / search_kit_extensions / get_kit_instructions)與 WebSearch/WebFetch 查 NVIDIA 官方文件，釐清：
1) Kit App Streaming 的串流分享模型：單一 Kit instance 的 viewport 如何被多個 client 觀看(viewport streaming / viewport sharing)
2) 誰能操作相機/選取/編輯 —— "presenter/host" 與 "viewer/spectator" 的官方權限界線；spectator 是否只收結果(stage selection / camera) 而不能主動下指令
3) follow mode / live session / presence 的官方概念與適用情境
4) 對映到本專案：primary 經 DataChannel 主動下指令(open/focus/highlight/select)，spectator 只接收 stageSelectionChanged 沿用 primary stage —— 這樣的設計是否對齊官方？官方建議的 spectator UX(唯讀標示、跟隨主持視角)有哪些?
列出「官方原則 → 對本專案 3D viewer 的具體要求」對照。標來源 URL。只研究、不改檔案。輸出 markdown。`,
    { label: 'F2:kit-primary-spectator', phase: 'Foundations', agentType: 'Explore' }
  ),

  // F3 — 設計參考 repo 萃取（Coordinator 控制台）
  () => agent(
    `唯讀分析任務：萃取設計參考 repo 的「Coordinator 控制台」頁面設計，作為項目4 移植(真實實作)的依據。讀：
${DESIGN}/coordinator/index.html
${DESIGN}/coordinator/console/app.jsx
${DESIGN}/coordinator/console/components.jsx
${DESIGN}/coordinator/console/data.jsx
${DESIGN}/coordinator/console/pages.jsx
${DESIGN}/coordinator/console/pages2.jsx
${DESIGN}/coordinator/console/tweaks-panel.jsx
也看 ${DESIGN}/README.md 了解設計意圖。
產出：
1) Coordinator 控制台提供哪些頁面/區塊/卡片，各自功能與操作
2) 視覺風格(色彩、排版、元件樣式、density)與互動模式
3) 元件清單(可重用的 UI 元件)與資料結構(data.jsx 的 mock 形狀)
4) 哪些是「設計願景但後端要真實實作」的功能 —— 列出對應需要的後端能力
注意：這是設計原型(mock 資料)，目標是在 ${GOV} 真實實作。只讀不改。輸出 markdown。`,
    { label: 'F3:design-ref-coordinator', phase: 'Foundations', agentType: 'Explore' }
  ),

  // F4a — 現況：viewer 3D 互動與 primary/spectator 程式碼錨點
  () => agent(
    `唯讀分析任務：建立「viewer 端 3D 互動 + primary/spectator」的程式碼錨點，供重構規劃使用。讀 ${GOV} 下：
web-viewer-sample/src/Window.tsx
web-viewer-sample/src/USDStage.tsx
web-viewer-sample/src/USDAsset.tsx
web-viewer-sample/src/StreamOnlyWindow.tsx
web-viewer-sample/src/AppStream.tsx
web-viewer-sample/src/clients/streamMessages.ts
web-viewer-sample/src/types/streamMessages.ts
web-viewer-sample/src/console/GovernanceOverlay.tsx
web-viewer-sample/src/console/governance/highlightBridge.ts
web-viewer-sample/src/console/governance/mappingCache.ts
web-viewer-sample/src/console/governance/windowOverlayGlue.ts
重點釐清(給出函式/檔案行號錨點)：
1) 左側是否已有 USD prim 樹(USDStage)? 如何 getChildren/展開/選取? 目前選樹節點會不會聚焦相機?
2) DataChannel 指令: focusPrimRequest / selectPrimsRequest / getChildrenRequest / highlightPrimsRequest 的送出與回應流程
3) primary vs spectator 目前如何判定(streamRole / viewport_sharing)、spectator 哪些操作被 gate
4) GovernanceOverlay 如何疊在 viewer、如何與 Window 溝通(windowOverlayGlue)、stage/artifact binding 目前有沒有 UI
5) 「選 prim path → 相機以該元件為中心」目前缺什麼
列出可重用的 hook/函式與重構切入點。只讀不改。輸出 markdown。`,
    { label: 'F4a:viewer-anchors', phase: 'Foundations', agentType: 'Explore' }
  ),

  // F4b — 現況：console + coordinator serving + kit-manager + 轉檔
  () => agent(
    `唯讀分析任務：建立「console / coordinator 服務層 / kit-manager / 轉檔」的程式碼錨點，供項目2/4/5 規劃使用。讀 ${GOV} 下：
web-viewer-sample/src/console/OperatorConsole.tsx
web-viewer-sample/src/console/EdgeConsole.tsx
web-viewer-sample/src/console/routing.ts
web-viewer-sample/src/console/pages.tsx
web-viewer-sample/src/console/IntakeSelectPage.tsx
web-viewer-sample/src/console/coordinatorClient.ts
apps/kit-manager-web/src/App.tsx
apps/kit-manager-web/src/components/KitManagerPage.tsx
apps/kit-manager-web/src/api/KitManagerClient.ts
apps/kit-manager-web/src/models.ts
然後用 Grep 在 bim-review-coordinator/src/app.ts 找：mountDevConsole、'/ui'、'/dev-console'、'/ui/open'、'/ui/console'、express.static、kit instance / kit-manager 相關 route、conversion/轉檔 相關 route(ifc-ready、external、conversions)。也看 bim-review-coordinator/src/public/dev-console.html 的功能區塊(不用逐行)。
重點釐清(給檔案/行號錨點)：
1) coordinator 實際服務哪些前端 route：/ui、/ui/open、/ui/console 是否存在? /ui 與 /ui/console 是否真的同頁(驗證使用者說法)? dev-console.html 提供哪些操作?
2) kit-manager-web 對 :8010 的哪些 endpoint? 轉檔(IFC→USDC)由誰觸發、走哪些 endpoint?
3) OperatorConsole 與 EdgeConsole 的關係與路由(/console vs #console)、IntakeSelectPage 現況
4) 把 kit-manager + 轉檔 + dev-console 合併成單一頁，技術上要動哪些服務邊界(:8010 vs :8004)?
只讀不改。輸出 markdown。`,
    { label: 'F4b:console-serving-anchors', phase: 'Foundations', agentType: 'Explore' }
  ),
])

const FOUND = F.map((x) => x || '(此地基 agent 無輸出)')
const [DESIGN_SKILL, KIT_MODEL, DESIGN_REF, VIEWER_ANCHORS, CONSOLE_ANCHORS] = FOUND
log('Foundations 完成：5 份地基')

const CONTEXT = `
================ 地基 A：官方前端設計技能/規範 ================
${DESIGN_SKILL}

================ 地基 B：Kit primary/spectator 權威模型 ================
${KIT_MODEL}

================ 地基 C：設計參考 repo Coordinator 控制台 ================
${DESIGN_REF}

================ 地基 D：viewer 3D 互動程式碼錨點 ================
${VIEWER_ANCHORS}

================ 地基 E：console/serving/kit-manager 程式碼錨點 ================
${CONSOLE_ANCHORS}
`

// 共同規劃指引（注入每個 planner）
const RULES = `
共同設計原則(務必貫穿)：
- 套用「地基 A 官方前端設計規範」：一致的設計 token、元件狀態鐵律、a11y、動效節制。
- primary/spectator 對齊「地基 B」官方模型：primary=會議主持可操作；spectator 唯讀只看結果，按鈕 disabled 並誠實標示(aria-disabled，非僅 pointer-events)。
- 沿用本專案「誠實鐵律」：AS-BUILT/ARTIFACT/DEMO 標示、p1/p3/p4 disabled 不做假按鈕、無遙測標「未取得」不捏造。
- 服務邊界：瀏覽器唯一可達面=coordinator :8004；不直連 :49101/:49102/:8010(kit-manager 例外但本次要合併，需經 coordinator proxy 化考量)。
- 操作連貫性、風格一致、使用者友善：相同的「操作/觀測」語彙跨 A1/A2/A3。
- 唯讀規劃：不要寫程式碼檔，只產出規劃(可含 TS/JSX 片段示意與檔案路徑、元件樹、狀態圖、API 草案、驗收條件、風險)。
輸出格式：markdown，含「目標 / 現況落差 / 設計方案(IA+元件+互動+權限) / 觸及檔案與新增檔 / 後端/API 需求 / 驗收條件 / 風險與相依」。`

// ---------- Phase 2: per-item planning ----------
phase('PlanItems')

const ITEMS = [
  {
    label: 'P1:item1-3d-viewer',
    title: '項目1 — 3D viewer 樹狀→prim 聚焦 + A1/A2/A3 操作觀測統一 + primary/spectator',
    body: `規劃項目1：
- A1：左側欄樹狀呈現 IFC/BIM 語意(USD prim path 結構)。使用者點選某個 "usd prim path" → 3D viewer 相機切換到「以該元件為中心」顯示(focus/frame)。
- A2、A3 採用相同的「邏輯/操作/觀測」三原則設計與重構(統一互動語彙、共用元件)。
- primary 當會議主持有操作權限；spectator 只觀看結果(對齊 Kit 官方)。
要點：以地基 D 的 USDStage/Window DataChannel(focusPrimRequest/selectPrimsRequest/getChildrenRequest)錨點為基礎，設計：樹元件、選取↔相機聚焦↔3D 選取的雙向同步、A1/A2/A3 共用的 viewer 互動抽象層(hook/component)、primary/spectator gating。給元件樹、狀態流、DataChannel 訊息對映、驗收條件。`,
  },
  {
    label: 'P2:item2-operator-console',
    title: '項目2 — OperatorConsole (/console, #console/...) 依項目1 調整',
    body: `規劃項目2：依項目1 的「樹狀→聚焦 + 操作/觀測 + primary/spectator」結果，調整 OperatorConsole 與 console 路由。
釐清：OperatorConsole 與 viewer 目前互斥掛載(console 無 DataChannel) → 項目1 的 3D 互動要如何在 console 場景呈現(嵌入 viewer? 仍 disabled 標 p1? 還是 console 改為能開 primary/spectator viewer)? 路由(/console vs #console)如何配合。給出 IA 調整、頁面職責重劃、與項目1 元件的共用關係。`,
  },
  {
    label: 'P3:item3-stage-binding',
    title: '項目3 — Stage/Artifact Binding overlay(主入口) + /console/intake(前置入口)',
    body: `規劃項目3，兩個入口：
3.1 Primary viewer overlay 新增「Stage / Artifact Binding」區(在現有右側治理面板)：選 1~N 個 ready USDC artifacts、指定 primary、調 load_order、套用、重載 stage。primary 可改、spectator disabled。這是 live review 中途動態綁定的主入口。
3.2 /console/intake 擴充：現為從 /api/external/ifc-ready 選可審查模型；擴充成「建立新 review session 時選多個 artifact」。定位為進件/開場入口(非 live 中途切換)。
給：overlay 元件設計、與 stage 重載(DataChannel openStageRequest / coordinator stream-config)的串接、artifact 多選/排序 UI、primary/spectator 權限、兩入口的職責分工與資料一致性、後端 binding API 需求、驗收條件。`,
  },
  {
    label: 'P4:item4-merge-page',
    title: '項目4 — 合併 kit-manager-web + /ui 轉檔 成單一前端頁，並移植設計參考的 Coordinator 控制台(真實實作)',
    body: `規劃項目4：把 apps/kit-manager-web 與 coordinator /ui(dev-console 的轉檔/IFC-ready/handoff 功能)合併成「一個」前端頁，並擴充移植地基 C 的「Coordinator 控制台」設計(全部要真實實作、非 mock)。
釐清：服務邊界整併(kit-manager :8010 的 kit open/close 與 coordinator :8004 的轉檔/session) —— 合併頁如何同時操作兩個服務(是否把 :8010 經 coordinator proxy 化以維持「瀏覽器唯一可達面」原則)? 把地基 C 的哪些卡片/區塊落地、各需要哪些真實後端 endpoint。給：合併後頁面 IA、元件清單(對映地基 C)、API 對照(現有 vs 需新增)、資料流、風險、驗收條件。`,
  },
  {
    label: 'P5:item5-remove-ui-console',
    title: '項目5 — 統一 /ui 與 /ui/console，項目4 完成後移除 /ui/console',
    body: `規劃項目5：依地基 E 先確認 /8004/ui 與 /8004/ui/console 是否真為同頁同功能(若不是，據實修正前提)。規劃在項目4 合併頁完成後，安全移除 /ui/console：路由收斂、redirect(舊 URL→新頁)以免斷連、移除順序與回歸驗證、對既有 handoff(/ui/open) 的影響。給移除清單、相容性處理(301/302 或保留 alias 一段時間)、驗收條件、風險。`,
  },
]

const PLANS = await parallel(
  ITEMS.map((it) => () =>
    agent(
      `你是資深前端架構師(熟 React/TS、3D viewer、Omniverse Kit 串流)。基於以下「地基」與「共同設計原則」，產出${it.title}的詳細設計規劃。\n${RULES}\n\n${it.body}\n\n${CONTEXT}`,
      { label: it.label, phase: 'PlanItems' }
    )
  )
)
const validPlans = PLANS.map((p, i) => ({ item: ITEMS[i].title, plan: p || '(無輸出)' }))
log(`PlanItems 完成：${validPlans.filter((p) => p.plan !== '(無輸出)').length}/${ITEMS.length}`)

// ---------- Phase 3: synthesis ----------
phase('Synthesize')

const FINAL = await agent(
  `你是首席前端設計師暨技術主管。下面是(1)研究地基(官方設計技能 + Kit primary/spectator + 設計參考 + 程式碼錨點)，(2)5 個項目的個別規劃。
請整併成**一份連貫、可執行的前端設計與重構總規劃**(繁體中文台灣用語、markdown)，要求：

1. **統一設計系統**：根據地基 A 提煉本專案要採用的設計 token(色彩/字級/間距/狀態/density)、核心可重用元件清單(樹、面板、overlay、卡片、按鈕狀態、primary/spectator 徽章與唯讀降級樣式)。這是 5 個項目共用的基礎，先定義一次。
2. **資訊架構(IA)總圖**：整併後的路由/頁面地圖(viewer / console / 合併後的 Coordinator 控制台)，標出哪些保留、調整、新增、移除(含項目5 的 /ui/console 移除)。
3. **5 個項目的整合計畫**：每項濃縮成 目標 / 設計方案 / 觸及與新增檔案 / 後端 API 需求 / 驗收條件；並標出**跨項目相依**(例如項目2 依項目1、項目5 依項目4)。
4. **primary/spectator 一致性章節**：跨 A1/A2/A3/overlay/console 的權限與唯讀降級規則(對齊 Kit 官方)，集中定義一次。
5. **分期落地路線(Phase 1..N)**：依相依關係排序，每期可獨立驗證(含 browser E2E evidence 的期望)，標示風險與 OpenSpec change 切分建議。
6. **風險與未決問題**：服務邊界(:8010 proxy 化)、console 無 DataChannel、誠實降級、效能、相容性(舊 URL handoff)等。
7. **UX 一致性檢查表**：操作連貫性與使用者友善的具體驗收點。

避免重複堆疊各 planner 原文；要消化、去衝突、給單一權威方案。若 planner 之間有矛盾，明確裁決並說明理由。輸出純 markdown。

================ 研究地基 ================
${CONTEXT}

================ 5 項個別規劃 ================
${validPlans.map((p) => `\n#### ${p.item}\n${p.plan}`).join('\n')}`,
  { label: 'synthesize:master-plan', phase: 'Synthesize' }
)

return FINAL
