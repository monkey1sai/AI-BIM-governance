# CO 審查控制台 → #runtime 併入設計（移除重複 nav · #runtime 承接 CoordinatorPage · 保留元件）

> **版本**：v2（2026-06-24，吸收 conflict-compat / goal-honesty 兩份 critic：修掉 3 個守門斷言假陽性 blocker、收斂 OQ-1 接法、收緊測試手法）
> **範圍**：前端導覽 IA + 路由 key→component 對應 + FLOW 重導。`web-viewer-sample/src/console/` 內 3 個檔案 + 1 個 test 檔。**後端零變更**。
> **相依 spec**：在飛 4 條（`a1-governance-3d-minio-redesign` / `ifc-ready-api-field-redesign` / `minio-folderview-and-baseline-disclosure` / `minio-trigger-lifecycle-backend`）經逐條核對為**正交、無 git 衝突面**（見 §6）。
> **正典路由表對齊**：`docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` §A.1.1，RT=`#runtime` 既有；本 spec 把 RT 從「dashboard UI 待建」升為「承接 CO 已實作 dashboard」並移除獨立 CO 導覽項。
>
> **對象程式碼（行號取自 2026-06-24 工作樹現況，已逐行查證）**：
>
> | 檔案 | 觸碰點 |
> |---|---|
> | `web-viewer-sample/src/console/data.ts` | `NAV_GROUPS`（L41–47）**保留不動**；`PAGES` coordinator 項（L75）**刪除**；`conv`/`sessions`/`instances`/`minio`（L67–70）**保留不動**；`PAGES`（L51 `export`）/ `PAGE_TITLE`（pages.tsx:2630，衍生自 `PAGES`） |
> | `web-viewer-sample/src/console/EdgeConsole.tsx` | import（L9–31，含 `CoordinatorPage` L14、`RuntimePage` L25）；`renderBody` switch（**非 export**，`coordinator` L80、`runtime` L82）；`NAV_LABEL`（**非 export**，`coordinator` L114、`runtime` L118）；`COPILOT_PROMPTS`（L123，無 coordinator/runtime key）；`FLOW`（③ L140、⑤ L142）；nav 渲染 `PAGES.filter(...).map(...)`（L209，`<span class="ec-key">{p.no}</span>` L211） |
> | `web-viewer-sample/src/console/pages.tsx` | `CoordinatorPage`（L2379–2402，h1=`Coordinator Console · C / Hybrid Runtime Orchestrator` @2394）**保留**；`RuntimePage`（L2463–2540，h1=`Runtime Dashboard · 串流執行狀態（F）` @2488）**保留**；`PAGE_TITLE`（L2630）。二者僅作為被復用 / 被測試的元件，本 spec 不改其內容（D2-A 不動 pages.tsx；唯 D2-A′/D2-B 才動，見 §3.4） |
> | `web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx` | `CoordinatorGovernanceTabs`（四分頁 classic/atc/lifecycle/debug，L15–20）**保留**；`ActionButton`（L45–51，`disabled caption="Phase 1 read-only"`）為誠實守門基準 |
> | `web-viewer-sample/src/console/console.test.tsx` | 既有斷言（L162–195、L197–213、L320–334、L336–346 等，現 import 自 `./data` L32）；**新增** CO nav 消失 + #runtime 渲染四分頁 + 誠實守門斷言 |
>
> **不受影響但需知**：`web-viewer-sample/src/console/OperatorConsole.tsx`（獨立退役殼層，自有 `coordinator` 內部 route，與 EdgeConsole 的 `PAGES` nav 解耦）。
>
> **★ 兩個 h1 陷阱（critic 一手查證，定稿者已複驗）**：字串 `Coordinator Console` 不只在 nav，也硬寫在 `CoordinatorPage` 的 `<h1>`（pages.tsx:2394）；字串 `串流執行狀態` 不只在 nav label（L118），也在 `RuntimePage` 的 `<h1>`（pages.tsx:2488，`t(...)` 內）。**因此任何 `not.toContain("Coordinator Console")` / `not.toContain("串流執行狀態")` 的全域負向斷言都會假陽性**——本 spec 的守門斷言一律改打資料模型 / nav button，不打全域 html 字串（見 §5.1）。

---

## 1. 目標與範圍 + 不在範圍

### 1.1 目標（成功標準）

把 CO「審查控制台 / Coordinator Console」這個**與 #runtime 功能重複的獨立左側導覽項**收斂掉，讓 `#runtime`「Runtime 監控」承接 CO 已落地的 runtime 觀測 dashboard，達成：

1. **左側不再出現「CO 審查控制台」**。`PAGES` 移除 `coordinator` 項後，左欄 `落地端控制台` 群組只剩 `conv` / `sessions` / `instances` / `minio` 四項。
2. **`#runtime` 點進去渲染 CoordinatorPage 的四分頁內容**（Classic Dashboard / ATC Tower / Lifecycle Flow / Terminal·Debug），把 RT 從「dashboard 待建」升為「已實作觀測值班台」。
3. **已實作功能不刪、不重寫**：`CoordinatorPage` / `CoordinatorGovernanceTabs` / `RuntimePage` 元件全部保留並 export，`#runtime` 復用既有元件。
4. **FLOW 無死連結**：FLOW ③ Meeting、⑤ Record 原 `page:"coordinator"` 改為對齊承接後入口，點 FlowBar 不跳到一個 nav 不顯示的頁。
5. **後端零變更**：CO 與 #runtime 同樣只消費 `GET /api/runtime/status`，資料源相同，無新增 / 修改任何 coordinator API。
6. **誠實鐵律維持**：所有 state-changing Controlled Actions 維持 Phase 1 read-only 的 `disabled`；併入後仍誠實標 NOT BUILT / read-only，不偽裝可操作。

### 1.2 不在範圍（明確不做）

- **不碰 A1**。A1 在飛 spec 正瘦身成「治理檢核 + 3D 高亮」，本 spec 與 A1 正交：不改 `A1GovernanceWorkbenchPage`、不改 `a1` 的 nav key / label / route。**A1 的行號刻意不引用**（A1 spec 在飛、行號會位移；連 survey 都不綁 A1 行號，與「完全不碰 A1」紀律一致）。
- **不刪任何頁面元件**。`CoordinatorPage` / `RuntimePage` / `CoordinatorGovernanceTabs` / `IntakePage` 全部保留可被直接 render（既有 unit test 依賴此前提）。
- **不刪 `coordinator` route case**（EdgeConsole.tsx:80）。deep link `#coordinator` 仍可達 `CoordinatorPage`，避免外部書籤 / 既有測試斷裂；只是左欄不再列出該入口。
- **不動 `NAV_GROUPS` 的 `coordinator` 群組**（data.ts:45）。刪的是群組內一個 page，不是群組本身。
- **不改 `conv` / `minio` 兩 nav key 的 `key` 或 `group`**（避開在飛 spec 1/3 的前端落點，見 §6）。
- **不新增 / 修改 coordinator 後端 API、不動 `/api/runtime/status` schema**。
- **不把轉檔 lifecycle 狀態搬進 #runtime dashboard**（那會建立對在飛 spec 2/4 後端欄位的新消費相依，本 spec 不做，見 §6 相依說明 1）。

---

## 2. 現況事實（為何重複）

- **CO（`coordinator` / no=`CO`）的真實實作 = 唯讀 runtime 觀測值班台**。`CoordinatorPage`（pages.tsx:2379）自帶 `useState<RuntimeStatus>` + `coordinatorClient.runtimeStatus()`（→ `GET /api/runtime/status`），無 props、零外部依賴，純包 `CoordinatorGovernanceTabs`（四分頁 Classic Dashboard / ATC Tower / Lifecycle Flow / Terminal·Debug）。所有 state-changing Controlled Actions 在 Phase 1 一律 `disabled`（`ActionButton` = `<Btn disabled caption="Phase 1 read-only">`，RuntimeGovernanceTabs.tsx:45–51）。其 h1 字面為 `Coordinator Console · C / Hybrid Runtime Orchestrator`（pages.tsx:2394）。
- **#runtime（`runtime` / no=`RT`）的真實實作 = 同一資料源的另一支觀測頁**。`RuntimePage`（pages.tsx:2463）同樣只讀 `coordinatorClient.runtimeStatus()`（→ `GET /api/runtime/status`），呈現 Kit 實例綁定 / GPU 遙測（標未取得）/ stream-config 互動讀取器 / A1 governance 綁定。NAV_LABEL 目前文案 `tech: "Runtime Dashboard" biz: "串流執行狀態"`，h1 字面為 `Runtime Dashboard · 串流執行狀態（F）`（pages.tsx:2488），且 dashboard 形態被使用者認知為「待建」。
- **二者重複的本質**：CO 與 RT **吃同一個後端端點 `GET /api/runtime/status`、同一份 `RuntimeStatus` 型別**，只是把同一批 runtime 觀測值切成兩種前端呈現，並各佔一個左側導覽項 → 操作員左欄出現兩個語意重疊的入口。
- **為何不放 A1 / SY**：A1 是「治理檢核 + 3D 高亮」產品線（與 runtime 觀測正交），SY=`admin`（系統管理，本身標『待建』、語意是 admin 而非 runtime 觀測）；runtime 觀測的正確歸屬就是 `#runtime`（`system` 群組下的 RT），故結論為「把 CO 併入既有 RT、移除 CO」。
- **關鍵差異（影響設計裁決，見 §3.4 / §7）**：`RuntimePage` 含兩塊 `CoordinatorGovernanceTabs` **沒有**的 as-built 功能 —— ① stream-config 互動讀取器（pages.tsx:2525–2533，輸入 `review_session_id` → `GET …/stream-config`）；② A1 governance rule-run 綁定面板（pages.tsx:2535–2537）。**已查證**：`grep "stream-config|streamConfig|scSession|StreamConfig"` 於 `coordinator/` 目錄 = **0 命中** → 若 `#runtime` 直接改渲染 `CoordinatorPage`，這兩塊功能會失去前端入口（元件雖保留但無路由可達）。這是本 spec 最 load-bearing 的設計約束（取代路徑見 §3.4）。

---

## 3. 變更設計

四個動作。前提：`CoordinatorPage` / `CoordinatorGovernanceTabs` / `RuntimePage` 全部**保留為元件**，只動「導覽資料 + route key→component 對應 + FLOW page 指向 + nav 文案」；唯 §3.4 的取代路徑（D2-A′）會在 `coordinator/` 內動到一處元件邊界（見該節）。

### 3.1 動作一：移除 CO 獨立導覽項（data.ts）

從 `PAGES` 陣列刪除 coordinator nav 項（data.ts:75）。route case 仍由 EdgeConsole switch 保留（見 3.2），故 deep link `#coordinator` 不死，只是左欄不再列出。

**只刪 page，不刪 group**：`NAV_GROUPS` 的 `coordinator` 群組（data.ts:45）與 `conv`/`sessions`/`instances`/`minio` 四項（data.ts:67–70）**保持原樣**。刪 CO 後群組仍有四項，群組標題「落地端控制台」必須存活（console.test.tsx:341 斷言它存在）。

**`PAGE_TITLE` 衍生影響（已查證，非推測）**：`PAGE_TITLE`（pages.tsx:2630）= `Object.fromEntries(PAGES.map((p) => [p.key, p.label]))`，刪 L75 後 `PAGE_TITLE.coordinator` 變 `undefined`。**已對 `console/` 全目錄 grep `PAGE_TITLE` → 唯一命中為其定義行（pages.tsx:2630），0 個 reader 讀 `PAGE_TITLE["coordinator"]`**，故 undefined 無下游消費者。實作期請以同一條 grep 複驗「無 reader」後再刪。

### 3.2 動作二：#runtime 承接 CoordinatorPage（EdgeConsole.tsx switch）

把 `renderBody` switch 的 `runtime` case（L82）從 `RuntimePage` 改向 `CoordinatorPage`。`CoordinatorPage` 無 props、自取資料，直接掛上即可運作，零包裝、零新元件。

`coordinator` case（L80）**保留**，使 `#coordinator` 與 `#runtime` 都渲染 `CoordinatorPage`（雙入口同頁），符合「承接」語意且不破壞舊 deep link。

**NAV_LABEL 文案同步（誠實鐵律，文案定稿）**：`runtime` 的 NAV_LABEL（L118）文案 `tech: "Runtime Dashboard" biz: "串流執行狀態"` 與承接後實際渲染的 Coordinator 四視角不一致 = 誠實違規（nav 寫「串流執行狀態」但點進去是 Coordinator 觀測台）。**定稿改為** `tech: "Runtime Console" biz: "Runtime 觀測值班台"`（不再留為 OQ，避免 spec-to-done 在文案上停滯或自裁）。`coordinator` 的 NAV_LABEL（L114）保留（route 仍在，未列出的 key 對渲染無害，刪除無收益）。

**import 收尾（取決於 §3.4 接法，已收斂）**：本 spec 預設 **D2-A′（見 §3.4）**——`RuntimePage` 在 `pages.tsx` 內仍 render `StreamConfigReader`，且 `EdgeConsole` 仍至少有一處 render `<RuntimePage />`（其專屬 deep-link case，見 §3.4），故 `RuntimePage` import（EdgeConsole.tsx:25）**保留、不移除**。`npx tsc --noEmit` 不應報 TS6133。**注意：web-viewer `npm run build` = vite 不跑 tsc，import unused 的 TS6133 只有 `npx tsc --noEmit` 抓得到**——若實作期最終讓 `RuntimePage` 在 EdgeConsole 0 引用，必須同步移除該 import。

### 3.3 動作三：FLOW 重導（EdgeConsole.tsx）

`FLOW` ③ Meeting（L140）與 ⑤ Record（L142）目前 `page:"coordinator"`。FlowBar `onClick={() => go(f.page)}`（L152）+ `active === f.page` 高亮判定（L151）。把 ③⑤ 的 `page` 改為 `"runtime"`，使點擊落到左欄真實顯示的 `#runtime` 入口（承接後 = CoordinatorPage），FlowBar active bar 與左欄入口對齊。③⑤ 必須**同步**改，否則兩步指向不同入口。`flowActive`（L180，`page.startsWith("app/") ? "apps" : page`，純衍生）不需改。

**衍生面已封（critic nit-4）**：`COPILOT_PROMPTS`（L123）**無** `coordinator` 也**無** `runtime` key，`prompts = COPILOT_PROMPTS[flowActive] ?? COPILOT_PROMPTS.home`（L181）對二者**本來就 fallback `home`**。把 ③⑤ 的 `page` 從 `coordinator` 改 `runtime` 不改變此既有 fallback 行為（兩者都本來 fallback home），prompt rail 無新破綻。

### 3.4 動作四：RuntimePage 的 stream-config / A1 綁定去向（設計裁決，本 spec 拍板為單一預設）

`CoordinatorGovernanceTabs` 經查證**不含** stream-config 讀取器（grep `stream-config|streamConfig|scSession|StreamConfig` 於 `coordinator/` 目錄 = 0 命中），故承接後 `RuntimePage` 的 stream-config 互動讀取器（pages.tsx:2525–2533）+ A1 governance 綁定面板（pages.tsx:2535–2537）**不在** Coordinator 四分頁中有等價呈現。直接讓 `#runtime` 只渲染 `CoordinatorPage` = 靜默砍掉 stream-config 這個 as-built 功能入口（違反 CLAUDE.md：移除 user-facing 入口須有取代路徑）。

> **★ 收斂理由（吸收 conflict-compat B3 + goal-honesty nit-3）**：v1 草稿的 D2-A「新增 `case "runtime-legacy"` alias route」是憑空新增一條操作員看不懂的隱藏路由，與「最小且不砍功能」自我矛盾，且容易長成新的「重複入口」債。**本 spec 改採 D2-A′ 為唯一預設**，不把三選一丟給實作。

本 spec 採 **決策 D2-A′（抽元件共用，預設且唯一）**：

- `#runtime` route（L82）→ 渲染 `CoordinatorPage`（承接四分頁）。
- 把 `RuntimePage` 內 stream-config 讀取器這段 JSX（pages.tsx:2525–2533）抽成獨立元件 `StreamConfigReader`（同檔 `pages.tsx` 內，不新增檔案），由 **(a)** `RuntimePage` 復用同一元件、**(b)** `CoordinatorGovernanceTabs` 的 `debug`（Terminal / Debug）分頁直接 render。如此 stream-config 與 A1 綁定面板**有真實可達入口**（在 `#runtime` 的 debug 分頁內），零孤兒、零新增 route key、零隱藏 legacy 入口。
- `RuntimePage` 本體**保留**（仍 render `StreamConfigReader`），並保留其原 deep-link 可達性（沿用既有 `coordinator`/或不另列 nav 的既有路由語義即可，**不新增 `#runtime-legacy`**）；因此 `RuntimePage` import 不變 unused。
- 此法動到 `pages.tsx`（抽 `StreamConfigReader`）與 `coordinator/RuntimeGovernanceTabs.tsx`（debug 分頁多 render 一個元件）的元件邊界——這是「移除入口須有取代路徑」必然的最小代價，**比 v1 的 alias route 更乾淨**（零孤兒、零讓操作員困惑的 legacy 入口）。

**被否決的替代（記錄但不採）**：
- **D2-A（v1 預設，否決）**：保留 `RuntimePage` 一條 `#runtime-legacy` alias route + debug 分頁連過去。否決理由：alias route 是隱藏入口、語意不明、易成新重複債，且新增 switch case 與「最小面」相矛盾。
- **D2-B（不採）**：`RuntimePage` 整支退役、stream-config 併入 debug 分頁、移除 `RuntimePage` import。否決理由：改動面最大、且使既有 `renderToString(<RuntimePage />)` 直測（console.test.tsx:162–195）需改寫，得不償失；僅在未來 reviewer 明確要求徹底退役時才升級採用。

### 3.5 改動點表（檔案 / 行 / 改法）

| # | 檔案 | 行/區塊 | 現況 | 改法 | 風險 |
|---|---|---|---|---|---|
| 1 | `data.ts` | **L75** | `{ key: "coordinator", no: "CO", label: "Coordinator Console", plane: "governance", group: "coordinator" },` | **刪除整行**（從 `PAGES` 移除 coordinator nav 項） | 低。`PAGE_TITLE["coordinator"]` 變 undefined；**已 grep `PAGE_TITLE` = 0 reader**（pages.tsx:2630 僅定義行），無下游消費者 |
| 2 | `data.ts` | **L45 + L67–70** | `coordinator` 群組 + conv/sessions/instances/minio 屬此群組 | **不動**（只刪 page 不刪 group；`conv`/`minio` 的 `key`/`group` 保持原樣，避開在飛 spec 1/3） | 中。若誤刪群組 → console.test.tsx:341「落地端控制台」斷言炸 |
| 3 | `EdgeConsole.tsx` | **L82** | `case "runtime": return <RuntimePage />;` | 改 `case "runtime": return <CoordinatorPage />;` | 高（語意）。RuntimePage 獨有 stream-config / A1 綁定失去 `#runtime` 入口 → 由 §3.4 D2-A′ 取代路徑（debug 分頁 render `StreamConfigReader`）承接 |
| 4 | `EdgeConsole.tsx` | **L80** | `case "coordinator": return <CoordinatorPage />;` | **保留**（`#coordinator` deep link 仍可達） | 低。雙入口同頁，符合承接語意 |
| 5 | `EdgeConsole.tsx` | **L25** | `RuntimePage,`（import） | **保留**（D2-A′ 下 `RuntimePage` 仍被 render）；唯若實作期使其 0 引用才移除 | 中。若改向後無任何用處 → TS6133（須 `npx tsc --noEmit` 才抓到，vite build 不跑 tsc） |
| 6 | `EdgeConsole.tsx` | **L118** | `runtime: { tech: "Runtime Dashboard", biz: "串流執行狀態" },` | 改 `runtime: { tech: "Runtime Console", biz: "Runtime 觀測值班台" }`（定稿，反映 Coordinator 內容） | 中。文案與渲染內容不一致 = 誠實違規 |
| 7 | `EdgeConsole.tsx` | **L114** | `coordinator: { tech: "Coordinator Console", biz: "審查控制台" },` | **保留**（route 仍在，未列出對渲染無害） | 極低 |
| 8 | `EdgeConsole.tsx` | **L140** | `{ n: "③", …, page: "coordinator" },` | `page: "coordinator"` → `page: "runtime"`（與左欄真實入口對齊） | 中。需與 ⑤ 同步；prompt rail fallback home 不變（§3.3） |
| 9 | `EdgeConsole.tsx` | **L142** | `{ n: "⑤", …, page: "coordinator" },` | 同 #8 改 `page: "runtime"` | 中。③⑤ 必須一致 |
| 10 | `pages.tsx` + `coordinator/RuntimeGovernanceTabs.tsx` | **§3.4 D2-A′** | stream-config reader 為 `RuntimePage` 內 inline JSX（pages.tsx:2525–2533）；`debug` 分頁無 stream-config | 抽 `StreamConfigReader` 元件（pages.tsx 內，不新增檔）；`RuntimePage` 與 `debug` 分頁共用；**不新增 route key** | 中。確保 stream-config 不孤兒；動元件邊界但零孤兒零新路由 |
| 11 | `console.test.tsx` | 見 §5 | — | **新增**斷言（CO nav 消失 / #runtime 渲染四分頁 / 誠實守門），現有 `import … from "./data"`（L32）加上 `PAGES` | 低。新增非改既有 |

> **元件層保留範圍**：`pages.tsx` 的 `CoordinatorPage`(2379) / `IntakePage`(2407) / `RuntimePage`(2463) / `PAGE_TITLE`(2630) 與 `RuntimeGovernanceTabs.tsx` 四分頁定義（15–20）**不刪**。D2-A′ 僅「抽出 `StreamConfigReader` 並由 debug 分頁共用」這一處動 pages.tsx / RuntimeGovernanceTabs.tsx 元件邊界，不重寫上述元件。

---

## 4. 誠實 / 安全紀律

- **Controlled Actions 維持 Phase 1 read-only `disabled`**：`CoordinatorGovernanceTabs` 內所有 state-changing 動作走 `ActionButton`（RuntimeGovernanceTabs.tsx:45–51）= `<Btn disabled caption="Phase 1 read-only">`。併入 #runtime 後**不得**因「換了入口」而把任何按鈕改成 enabled；本 spec 不解鎖任何 Controlled Action。
- **NOT BUILT / read-only 標註不得移除**：CoordinatorPage 既有的誠實字串（`port listening ≠ has frame`、`Open primary URL 不等於 occupied`、`occupied 必須等 browser first-frame evidence`、GPU/秒數「未取得」標 `demo` prov）原樣保留；RuntimePage 的「GPU / 轉換秒數無統一遙測 → 標未取得（idle，非 fail）」原樣保留。
- **不偽裝可操作**：併入後 nav 文案（L118）必須誠實反映「Runtime 觀測值班台 · read-only」，不得用「串流執行狀態」這種暗示可操作 / 可控的舊文案誤導。**注意：`串流執行狀態` 同字串仍存在於 `RuntimePage` h1（pages.tsx:2488）**——本 spec 只把它從 **nav label** 移除（讓 nav 不再宣稱「串流執行狀態」），不主張從整個 codebase 抹除；守門斷言因此打 nav label，不打全域 html（見 §5.1）。
- **資料源誠實**：CO 與 #runtime 同樣只消費 `GET /api/runtime/status`；不得在前端虛構欄位或把無遙測值畫成數字。後端零變更，無新增資料宣稱面。
- **不偽 stage matched**：承接後若顯示 stage / occupied 狀態，沿用 CoordinatorPage 既有「需 browser first-frame evidence 才算 occupied」的誠實判定，不得以 port listening 充當 first frame。

---

## 5. 測試

### 5.1 vitest（元件層，`web-viewer-sample/src/console/console.test.tsx`）

**既有不可壞（前提：只刪 PAGES L75、保留所有元件、保留 group）——這些是「保留元件」要保的測試**：

- L162–195：`renderToString(<CoordinatorPage />)` / `renderToString(<RuntimePage />)` 直接 render 元件做斷言（含 RuntimePage 的 `stream-config` + `未取得`）。元件保留 → 不經 nav → **仍綠**。（D2-A′ 抽 `StreamConfigReader` 後 `RuntimePage` 仍 render 它，`stream-config` 字串仍出現 → 此測仍綠；若實作改動使字串移位，須同步調整此測。）
- L197–213：CoordinatorPage 四視角 contract（`A Classic Dashboard` … `D Terminal / Debug`、`Recent Risk`、`not.toContain('"session_id"')`）→ 元件不動 → **仍綠**。> 註：此 describe 名為「C/Hybrid Coordinator Console Phase 1 顯示四視角」直測 `CoordinatorPage`；併入後 `#runtime` 亦渲染同元件，與此既有測試**同源**（新增 `#runtime` 正向斷言時於註解點明，避免後人困惑「為何 runtime 測試與 Coordinator 有關」）。
- L320–334：EdgeConsole shell FlowBar 文案（`①` / `接收建模來源` / `紀錄回寫雲端`）。斷言的是 FlowBar 文案（n/biz），不碰 `page` 欄 → 改 ③⑤ 的 `page` 指向不影響 → **仍綠**。
- L336–346：`renderToString(<EdgeConsole />)` 斷言四組 IA（含 **L341 `落地端控制台`**、L342 `IFC→USD 轉檔排程`、L344 `MinIO 資料`）→ 只刪 page 不刪 group → **仍綠**。

**新增斷言（★ 守門一律打資料模型 / nav，不打全域 html 字串——避開 §0 兩個 h1 陷阱）**：

1. **CO nav 不再存在（負向守門，打資料模型）**：
   `import { PAGES } from "./data";`（併入既有 L32 `import … from "./data"`）
   `expect(PAGES.some((p) => p.key === "coordinator")).toBe(false);`
   理由：`PAGES` 是左欄渲染的唯一資料源（EdgeConsole.tsx:209 `PAGES.filter(...).map(...)`），直接斷言資料模型零渲染歧義、零字串撞 h1。
   （**禁用** `expect(html).not.toContain("Coordinator Console")`——該字串同時在 `CoordinatorPage` h1@2394，承接後 `#runtime` 渲染它會假陽性。）
   *可選補強*：再渲染 EdgeConsole 預設 `#home`（只出 nav）斷言左欄按鈕的 `ec-key` 不含 CO 編號，例如 `expect(navHtml).not.toContain('class="ec-key">CO<')`（針對 `<span class="ec-key">{p.no}</span>` L211）。
2. **#runtime 渲染 CoordinatorPage 四分頁（正向）**：
   設 `window.location.hash = "#runtime"` 後 `const body = renderToString(<EdgeConsole />);`（**不**用 `renderBody("runtime", …)`——`renderBody`（EdgeConsole.tsx:51）非 export，呼叫它會逼實作者擴大公開面、違反最小面）。斷言：
   `expect(body).toContain("A Classic Dashboard");`
   `expect(body).toContain("D Terminal / Debug");`
   `expect(body).toContain("/api/runtime/status");`
   （註解標明：#runtime 現承接 CoordinatorPage，與 L197 既有 CoordinatorPage 元件測試同源。）
3. **誠實守門（read-only 不被偽裝）**：
   `expect(body).toContain("Phase 1 read-only");` // Controlled Actions 仍 disabled caption（正向，安全）
   **nav label 誠實（負向，打 nav 非打 html）**：對 `#runtime` 的 nav button 文字斷言其 biz 已非「串流執行狀態」。由於 `NAV_LABEL`（EdgeConsole.tsx:92）非 export，採二擇一：
   (i) 順手 `export const NAV_LABEL`，測 `expect(NAV_LABEL.runtime.biz).toBe("Runtime 觀測值班台")` 且 `expect(NAV_LABEL.runtime.biz).not.toContain("串流執行狀態")`；或
   (ii) 不改 export，渲染 nav 後抓 `runtime` 那顆 button 的文字斷言含「觀測值班台」、不含「串流執行狀態」。
   （**禁用** `expect(body).not.toContain("串流執行狀態")` 全域版——該字串同時在 `RuntimePage` h1@2488，D2-A′ 下 RuntimePage 仍可被 render，會假陽性。守門目標是「nav 不再宣稱串流執行狀態」，非「字串從 codebase 消失」。）
   並沿用既有 `not.toContain("99.1%")` / `not.toContain("92.4%")` 類假精準守門。
4. **stream-config 不孤兒（D2-A′）**：斷言抽出的 `StreamConfigReader` 被 `CoordinatorGovernanceTabs` 的 `debug` 分頁 render——以 `#runtime`（CoordinatorPage）渲染結果含 `stream-config` 入口字串，或直測 `renderToString(<CoordinatorGovernanceTabs ... />)` 的 debug 分頁含該入口。同時保住既有 `RuntimePage` 直測仍含 `stream-config`（L192）。

**OperatorConsole.test.tsx 不受影響**：OperatorConsole 是獨立退役殼層，其 `coordinator` 是內部 OperatorPage union（不 import `PAGES` from data.ts），與本變更解耦 → **仍綠**，不需改。

### 5.2 browser E2E（user-facing 變更 → AGENTS.md 要求證據）

本變更改了左側導覽與 `#runtime` 渲染內容，屬 user-facing，**必須有 browser E2E evidence（backend-only done 不接受）**。最小證據集：

- **E2E-1 左欄不再有 CO**：在 `:8004/ui`（或 branch 隔離 stack）展開左欄，截圖證明「落地端控制台」群組下只有 `conv`/`sessions`/`instances`/`minio`，**無 `CO 審查控制台`**。同時證明群組標題「落地端控制台」仍在。
- **E2E-2 #runtime 看到四分頁**：導到 `#runtime`，截圖證明渲染 Classic Dashboard / ATC Tower / Lifecycle Flow / Terminal·Debug 四個分頁標籤，且 `/api/runtime/status` 有真實回應（非 mock）。
- **E2E-3 誠實守門**：截圖證明 #runtime 內 Controlled Actions 維持 `disabled`（hover 顯示 `Phase 1 read-only`），未偽裝可操作；且左欄 `#runtime` 入口 biz 文案為「Runtime 觀測值班台」（非「串流執行狀態」）。
- **E2E-4 FLOW 無死連結**：點 FlowBar ③ Meeting / ⑤ Record，證明落到 `#runtime`（CoordinatorPage 內容），active bar 與左欄入口對齊，無跳到空白 / nav 不顯示頁。
- **E2E-5 stream-config 仍可達（D2-A′）**：證明 stream-config 讀取器仍有前端入口（在 #runtime 的 Terminal/Debug 分頁，由 `StreamConfigReader` 提供），輸入 `review_session_id` 可觸發 `GET …/stream-config`。

證據存放沿用 repo 慣例（`artifacts/e2e/<trace>/`），只存抽樣截圖，不 commit 大檔。

### 5.3 type check（必跑，D2-A′ 下 import 留）

`cd web-viewer-sample && npx tsc --noEmit`（記憶：vite build 不跑 tsc，import 收尾的 TS6133 只有這條抓得到）。D2-A′ 下 `RuntimePage` 仍被 render，import **保留**，不應有 TS6133；若實作期最終讓 `RuntimePage` 在 EdgeConsole 0 引用，須同步移除 import 再跑此檢查。再 `npm run verify`（= build）。

---

## 6. 與在飛 spec 的衝突核對表

逐條核對：本變更只動 `data.ts` 的 `PAGES`、`EdgeConsole.tsx` 的 switch/NAV_LABEL/FLOW、`console.test.tsx`、以及 D2-A′ 在 `pages.tsx`/`RuntimeGovernanceTabs.tsx` 抽 `StreamConfigReader` 一處。

| 在飛 spec | 觸碰面 | 與本變更關係 | 結論 |
|---|---|---|---|
| **1. a1-governance-3d-minio-redesign** | `pages.tsx` 的 `A1GovernanceWorkbenchPage` / `RealIfcConsolePage` + `app.ts`/`governanceProxy.ts`（**A1 spec 在飛、行號會位移，本表刻意不引用 A1 具體行號**）；明文「不刪 `#/demo-control` 路由」「A1 只連結過去 `#conv`」；0 處改 `PAGES`/`NAV_GROUPS`/`NAV_LABEL`/`FLOW`/`runtime`/`CoordinatorPage`/`RuntimePage` 的 stream-config 段 | 不碰 nav 結構、不碰 CO/RT、不碰 RuntimePage/CoordinatorPage、不碰 `StreamConfigReader` 抽出段 | **正交** |
| **2. ifc-ready-api-field-redesign** | 純後端：`bim-review-coordinator/src/`（app.ts schema/summarize、externalIfcReadyStore、minioWatcher、conversionLedger）；前端 consumer 僅 `#conv`/`#minio`/`A1`，**從未列 `#runtime` 為 consumer** | 與 nav/PAGES/NAV_LABEL/FLOW/CO/RT 零重疊 | **正交（純後端欄位）** |
| **3. minio-folderview-and-baseline-disclosure** | 前端只動 `MinioDataPage`(`#minio`) / `ConversionSchedulingPage`(`#conv`) page **內部**；後端動 `/api/minio/objects`、`POST /api/conversion/trigger`、watcher dedup。`buildMinioTree`(pages.tsx 內部函式) 退役屬 `#minio` page 內部，**非** nav/PAGES 條目，不影響 `minio` key | 本變更明文**不改** `minio`/`conv` 的 `key`/`group`（§1.2、改動點表 #2），二 spec 依賴此二 key 持續存在 → 本變更保證之；二者皆動 `pages.tsx` 但落在不同 page 函式（`MinioDataPage`/`ConversionSchedulingPage` vs `RuntimePage` 的 stream-config 段），無行級重疊 | **正交（最接近邊界，已點名保留 `minio`/`conv` key + pages.tsx 不同函式段）** |
| **4. minio-trigger-lifecycle-backend** | 純後端 `userFacing:false`：`bim-review-coordinator/src/`（maskPresignedRef、deriveLifecycleStatus、store 落欄、`POST /api/conversion/trigger`）；AC7 明文「watcher 自動偵測語意零變更」；0 處碰前端 nav/PAGES/RuntimePage/CoordinatorPage | 無前端落點 | **正交（純後端）** |

**無檔案級衝突、無行級重疊。** 沒有任何一條 spec 觸碰 `data.ts` 的 `PAGES`/`NAV_GROUPS`、`EdgeConsole.tsx` 的 `NAV_LABEL`/`FLOW`/switch、或 `RuntimePage`(2463) 的 stream-config 段 / `CoordinatorPage`(2379)。spec 3 與本 spec 雖同動 `pages.tsx`，但落在不同 page 函式段，無行級重疊。本變更與 4 條可完全並行、無 git 衝突面。

**唯二需注意的相依（非衝突，是語意風險）**：

1. **`conversion_lifecycle_status` 不被 #runtime 顯示（已查證）**。RuntimePage / CoordinatorPage 只讀 `/api/runtime/status`，**不讀** ifc-ready/ledger/lifecycle 欄位 → spec 2/4 新增的 `conversion_lifecycle_status` **不會自動出現在 #runtime**。本 spec **明確不把 lifecycle chip 搬進 #runtime**（§1.2）。若未來要搬，必須綁 spec 4 的 `deriveLifecycleStatus()` helper 輸出（spec 2 §8.1 must_fix #2：前後端共用單一 helper，禁各自映射），不得自切——否則重演「三視圖不一致」。**本 spec 不建立此相依。**
2. **nav key 競用（低）**。spec 3 升級 `#minio`、spec 1 在 A1 連 `#conv`，都依賴 `minio`/`conv` 兩 key 持續存在（data.ts:67,70）。本變更**只改 `coordinator`/`runtime` 兩 key**（刪 CO page + 改 RT 渲染/文案），`conv`/`minio` 的 `key`/`group` 保持不動 → 安全。

---

## 7. 決策記錄 + 待答問題（OQ）

### 7.1 已拍板決策（送 spec-to-done 前已全部收斂，無執行前硬 gate）

- **D1：移除 CO 採「刪 page 不刪 group、保留 route case」。** 刪 `PAGES` L75；保留 `coordinator` switch case（L80）與 NAV_LABEL（L114）→ deep link `#coordinator` 不死、`NAV_GROUPS` 群組與既有測試不破。`PAGE_TITLE["coordinator"]` 變 undefined 但已查證 0 reader。
- **D2-A′（預設且唯一接法）：#runtime → CoordinatorPage；抽 `StreamConfigReader` 由 RuntimePage 與 CoordinatorGovernanceTabs `debug` 分頁共用。** 不砍 stream-config 功能、零孤兒、零新 route、`RuntimePage` import 不變 unused。理由：比 v1 的 `#runtime-legacy` alias 更乾淨（無隱藏入口、無重複債），是「移除入口須有取代路徑」的最小忠實實作。**v1 的 D2-A（alias route）與 D2-B（退役）已否決，記錄於 §3.4。**
- **D3：FLOW ③⑤ 改 `page:"runtime"`。** 與左欄真實顯示入口對齊，避免 active bar 對不上；prompt rail fallback home 不變。
- **D4：NAV_LABEL `runtime` 文案定稿 `tech: "Runtime Console" / biz: "Runtime 觀測值班台"`。** 不留「串流執行狀態」誤導文案；文案已寫死，不再為 OQ。
- **D5：後端零變更、不搬 lifecycle chip 進 #runtime。** 避免建立對在飛 spec 2/4 的新消費相依。
- **D6：守門斷言一律打資料模型 / nav，不打全域 html 字串。** 因 `Coordinator Console`（h1@2394）與 `串流執行狀態`（h1@2488）皆同時存在於 page h1，全域負向斷言必假陽性（§5.1）。

### 7.2 待答問題（OQ，可被推翻的 reversible 註記，非執行前硬 gate）

- **OQ-1（`#coordinator` deep link 長期去留）**：本 spec 先保留 `#coordinator` 為 `CoordinatorPage` 的 alias（reversible），是否由下一個 spec 收斂為單一 `#runtime`？**本次不砍**，留待後續決定，不阻擋本 spec 執行。
- **OQ-2（E2E stack 選擇）**：branch 未 merge 時 E2E 走 branch 隔離 stack（build:ui + branch coordinator :8005 / governance GOV_PORT=49103）或部署區 `:8004/ui`？依 reviewer 對「是否需隔離」判斷，證據要求同 §5.2。屬執行細節，不阻擋設計拍板。

> **可執行性聲明**：§7.1 已把 v1 的 OQ-1（接法粒度）收斂為 D2-A′、OQ-2（nav 文案）定稿為 D4，故本 spec **無執行前硬 gate**，可直接餵 spec-to-done 自動驅動；§7.2 兩條 OQ 皆為「可後續推翻」的 reversible 註記，不需先答即可開工。
