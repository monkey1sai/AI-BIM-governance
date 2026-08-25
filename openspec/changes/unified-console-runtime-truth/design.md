# Design：unified-console-runtime-truth

## 0. 前提與工作方式

- 分支 `codex/openspec/unified-console-runtime-truth`（自 `origin/main 7e94fb0`），worktree `AI-BIM-governance.worktrees/unified-console-runtime-truth`。Lane G；使用者明示走 spec-to-done 時為 Lane S。
- 每次編輯 symbol 前先 `gitnexus impact <Symbol> -d upstream -r AI-BIM-governance`，HIGH／CRITICAL 先警告；commit 前 `gitnexus detect-changes --scope compare --base-ref main`。
- 本 design 的行號與端點皆於 2026-08-25 以 `rg -n` 對 `7e94fb0` 查證；落地時以 `rg -n` 重新定位。
- 六個 owner 裁決點（D1–D4、canon 入口、A4 放置）集中於 tasks §0；未裁決者對應段落 HELD。

## 1. D1 owner 裁決點：真值面 vs pixel 設計閘（tasks 0.1；2026-08-25 owner 裁決＝P）

### 1.1 衝突本質

- design-semantic-visual gate 把 `**/api/**` stub 成 503（`web-viewer-sample/e2e/design-system-visual.spec.ts:199`），以 canon（設計原型 demo 狀態）投影為 golden；UnifiedConsole 一旦改綁真值，gate 環境下 home／pipeline／ops／workspace.a1–a3 六屏必然渲染成「未連線／空狀態」，與現有 golden 產生 pixel diff。
- gate 規定 live surface（`video`、`iframe[src*='/ui/open']`）出現即 fail（manifest `:178-179`；spec `:300-304`），故 R4 的 handoff 必須是 anchor 而非內嵌 iframe，且無 session 時不渲染。
- semantic cases（`web-viewer-sample/e2e/design-system-semantic-cases.ts`）目前斷言 fixture 值（`kpi-conv-val`、`kpi-outbox-val`、`svc-dot`…）；gate 要求 `implemented_case_ids` 與 `required_case_ids` 全等並對每個 screen 執行（`design-system-visual.spec.ts:182-184,217`），因此 semantic case 變更是全屏規模的機制變更。

### 1.2 選項 P（建議）：產品面誠實狀態成為 golden

- 先例：`a4-semantic-search` canonical scenario「Canonical route 呈現 live states 而非 fixture counts」；`workspace.a4.default` 以 `baseline_provenance.authority = canonical_product_surface` pinned（manifest `:426`）。
- 做法：六屏 golden 改為「gate 環境（503 stub）下的誠實 offline／empty 狀態」；semantic cases 改斷言誠實狀態（KPI `—`＋`data-state="offline"`、`svc-dot` state=unknown、badge 非 `LIVE`、無 `82%`）；canon HTML 保留為版面參考、不編輯。
- 寫入方式：只經 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`（R-A2），且僅在 owner 於 tasks 0.1 明示核准後執行。既有腳本以 `new Set(process.argv.slice(2))` 收旗標、無逐屏過濾（`capture-design-system-reference.mjs:35-41`），並由 `design-system-rebaseline-authority.mjs` 把 `canonical_product_surface` 屏排除在重拍之外；因此承諾的粒度是「非 `canonical_product_surface` 屏重拍且 `workspace.a4.default` digest 不變」（對齊 `console-design-token-authority:55-58`），事後 `pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`。
- 確定性：offline 狀態不含時間戳與隨機值；「最後更新」在 gate 環境固定顯示 `—`。
- 優點：單一渲染路徑；假資料 export 可自 production 移除；gate 從此守護「實際出貨面」。缺點：多張 golden 一次變更（審閱負擔）；canon 與 golden 的內容（數字）分道、版面仍一致；需要 owner 明示核准 rebaseline。

### 1.3 選項 H：design-preview harness

- 做法：新增只在 design gate 環境可啟用的 preview 模式（例：build-time `VITE_DESIGN_PREVIEW=1`，或僅於 `import.meta.env.MODE === 'design-gate'` 才接受的 query 旗標），preview 下以 fixture provider 供資料，production build 以 tree-shaking 排除假資料 export。
- 需改 capture 機制（`web-viewer-sample/scripts/capture-design-system-reference.mjs` 與 gate 環境變數）→ 屬修改驗證機制本身，受 `docs/agents/self-referential-bootstrap.md` §2.1 約束（bootstrap ledger 的 `verification_mechanism_paths` ⊆ changed paths）。
- 優點：golden 不變、與 canon 維持 pixel parity。缺點：兩條渲染路徑（漂移風險）；fixture 留在程式庫；preview 若外洩到 production 即回到今日問題（需 production bundle 不可達測試）；gate 不再驗證出貨面；額外 bootstrap 欠帳。

### 1.4 裁決規則

- tasks 0.1 未寫入裁決前：§5（rebaseline／harness／semantic cases）不得動工；§1–§4 可先做，因為兩選項下真值綁定與控制項政策完全相同，差別只在假資料的去向（P：移到 test-only；H：留在 preview provider）。
- §1 以 `ConsoleDataProvider` 介面收斂資料來源：production 只注入 live store；vitest 注入 mock；H 才有 preview provider。

### 1.5 D4 owner 裁決點：`align-frontend-design-system-reference` 是否需先 thaw（tasks 0.4；2026-08-25 owner 裁決＝適用 carve-out，不 thaw）

- `openspec/changes/align-frontend-design-system-reference/proposal.md:3`：「Status: deferred 2026-07-21…動前端 visual full gate 前再 thaw」。D1 的 P 與 H 都會動 visual gate。
- 兩種處置：(a) owner 裁定本 change 適用 `openspec/specs/console-design-token-authority/spec.md:50,60-64` 的 carve-out（frozen deferred 不阻塞、其 tasks 2.4–2.8 為 non-canonical delta），不 thaw align；(b) owner 裁定先 thaw align 並由其承接 gate 面，本 change §5 依附其結果。
- 未裁定前 §5 全段 HELD；proposal Risks 已揭露 (b) 可能否決 D1=P。

## 2. D2 owner 裁決點：conversion 控制路由的瀏覽器授權（tasks 0.2；2026-08-25 owner 裁決＝T4）

### 2.1 現況與威脅模型

- `POST /api/conversion/trigger`（`app.ts:1727`）與 prioritize／retry／watch（`:1616,1642,1678`）共用 `rejectIfIpNotAllowed`（`:1601`；其註解「LAN/CORS 任意 origin 不得匿名寫入」是程式碼內既有裁決），沿用 `EXTERNAL_INTAKE_IP_ALLOWLIST`（`config.ts:467-470` 預設 loopback＋`172.16.0.0/12`）。canonical-linux 從 LAN 瀏覽器實測 403。
- 同一 helper 經 deps 注入守 lineage source-bundle 路由（`lineageSourceBundleRoutes.ts:119,521`）。
- `/ui` 今日無登入：任何能連到 `:8004` 的 LAN client 都能看主控台。觸發轉檔是寫入動作（建 job、耗 CPU／GPU）；既有冪等與 admission 佇列是主要濫用緩解，仍應加最小速率限制（每來源每分鐘 N 次，N 由 owner 定，預設 10）。

### 2.2 選項（誠實框架）

- **T4（建議）operator token**：沿用既有 Kit mutation 授權型式（`isKitMutationAuthorized`，`app.ts:4531`：header token 與設定值同型比對）為四條 conversion 控制路由提供第二條授權路徑（IP allowlist **或** 合法 operator token）。`/ui` 殼層由 operator 明示輸入 token（只存 `sessionStorage`、不落 `localStorage`、不寫進 URL），以 header 送出。這是無登入系統上唯一「知道秘密者才可寫」的授權。
- **T2 獨立 allowlist env**：新增 `CONVERSION_TRIGGER_IP_ALLOWLIST`（預設＝沿用既有行為），canonical env 明列 LAN CIDR；compose 透傳＋`.env.example` parity guard（沿用 PR #693 模式）；啟動時若 `MINIO_WATCH_ENABLED=true` 且 allowlist 缺 loopback SHALL fail-fast（對稱 `app.ts:966-978` 既有守衛，避免 owner 縮小網段時靜默切斷 watcher self-POST）。實質語意＝「該網段內匿名可寫」。
- **T1 同 origin 短效 token**：`Sec-Fetch-Site`／`Origin` 對非瀏覽器 client 可偽造，`GET /api/ui/csrf-token` 對任何 LAN client 可取；它只防 CSRF、不構成授權。誠實定義：**T1 = 允許 LAN 匿名觸發轉檔，速率限制為唯一緩解**。owner 明知此定義後才可採用。
- **T3（否決）放寬 `EXTERNAL_INTAKE_IP_ALLOWLIST`**：連帶放寬 `/api/external/*` webhook 面，違反硬約束。
- 可組合：T4＋T2（T2 作為 defense-in-depth）。

### 2.3 實作約束（不論選項）

- **per-route wrapper**：新授權判定只包在四條 conversion 控制路由的 handler 上；`rejectIfIpNotAllowed` 本體不改；`lineageSourceBundleRoutes.ts:523,573` 的授權行為以釘樁測試證明變更前後逐字相同。
- `/api/external/*` 授權路徑逐字不變；`/api/dev/*` 不作產品路徑。
- 不新增生產依賴（比對用標準庫）。
- 負向測試：無憑證且非 allowlist IP → 403；external 路徑與 lineage 路徑回應逐字相同；速率限制超額 → 429。

### 2.4 D3 owner 裁決點：canonical-linux 關閉 dev routes（tasks 0.3；2026-08-25 owner 裁決＝關閉）

- `devRoutesEnabled()`（`app.ts:4524-4526`）只有 `ENABLE_DEV_ROUTES="false"` 才關；compose 未透傳該 env，canonical-linux 容器內為未定義 → dev routes 開。`POST /api/dev/conversions` 直達 streaming server 且無 caller auth，是與 R5 等價的零授權入口；不關閉則 D2 的授權只是形式。
- 建議：canonical env 設 `ENABLE_DEV_ROUTES=false`（compose `environment:` 透傳＋`.env.example` parity guard）；受影響的 Edge Console 頁（`#demo-control` 的 `/api/dev/ifc-sources*`、A1 workbench local_fs 清單）在 404 時誠實顯示「dev routes 已關閉（canonical-linux）」，不崩潰、不假資料。
- 本機 local-windows 與隔離 branch stack 不受影響（維持 dev routes 開）。

## 3. 資料綁定架構

### 3.1 共用 poller store

- `useCoordinatorStatusStore`（單一 store）：每端點獨立節奏（預設 10 秒）、同端點同時最多一個 in-flight、失敗指數退避上限 60 秒、`document.hidden` 暫停；頁面訂閱而非各自 fetch。
- 沿用既有 `coordinatorClient`（Edge Console 已有，base 同 origin `:8004`）；不新增 HTTP client、不新增依賴。
- 這將翻轉 `EdgeConsole.sharedstatus.test.tsx:54-67` 的凍結（原「`#home` 不啟動 runtimeStatus 輪詢」），新義務為「`#home` 經共用 poller 呼叫，同端點單一 in-flight」。

### 3.2 provenance 與狀態模型（對齊 canonical Prov 七值）

- `data-prov` 值域嚴格限 `web-viewer-sample/src/console/data.ts` 的 `Prov`：`asbuilt`／`artifact`／`demo`／`p1`／`p15`／`p3`／`p4`（`unified-governance-console/spec.md:96` 釘死同一組）。本 change **不新增 prov 值**。
- 對映：真值區塊 `asbuilt`；離線視區示範圖 `demo`；A5–A10 roadmap 依 `data.ts` `p3`／`p4`；後端待建控制項 `p1`／`p15`。
- 「未取得」「未連線」不是 provenance，而是 runtime 狀態：`data-state` ∈ {`live`, `unavailable`, `offline`, `error`}。渲染規則：只有 `live` 才顯示數字；`unavailable`（200 但欄位 `null`／缺席）顯示「未取得」；`offline`（502／503／網路錯誤）顯示 `—`＋「未連線」；`error`（其他 4xx）顯示狀態碼與訊息。**永不以 0 作佔位**。

### 3.3 端點對映（十個端點皆已存在，不新增聚合端點）

| 顯示項 | 端點（來源） | 取值 | 非 live 規則 |
|---|---|---|---|
| Home 轉檔中 | `GET /api/conversion/records`（`app.ts:2374`） | `status ∈ {queued, running}` 計數 | 503→offline |
| Home 活躍 Sessions | `GET /api/runtime/status`（`app.ts:1363`） | active sessions 計數 | 同上 |
| Home 未結 Issue | `GET /api/governance/issues`（proxy） | open 計數 | 同上 |
| Home Outbox 待送 | `GET /api/callback-outbox/summary`（`app.ts:3215`；redacted 投影，排除 `payload`／`target_url`，`limit`≤200） | `pending` 計數＋attempts 摘要 | 同上；三態直查仍在 internal token 後 |
| svc-dot（六顆） | `GET /api/kit/health`（`:3779`）、`GET /api/runtime/status`、`GET /api/external/minio-watch/status`（`:2462`） | ok／degraded／unknown | 不可達→unknown |
| pipeline 進件 | `GET /api/external/ifc-ready`、`GET /api/minio/objects`（`:2399`）、minio-watch status | ifc-ready 計數；資料夾數／`has_source_ifc` 數；enabled／baseline／seen／triggered | 同上 |
| pipeline 轉檔 | `GET /api/conversion/records` | 依 status 分組（ready／running／failed） | 同上 |
| pipeline Session | `GET /api/runtime/status`、`GET /api/kit/instances/current`（`:3785`） | sessions；instance id／state | 同上 |
| pipeline 3D handoff | `GET /api/runtime/status` | review session → `/ui/open?session=<id>` anchor | 無→「無可 handoff session」 |
| pipeline 回拋 | `GET /api/callback-outbox/summary` | pending／attempts | 同上 |
| pipeline 治理／報表 | `GET /api/governance/issues`、`GET /api/governance/rule-runs`（`routes/governanceProxy.ts:223`） | 計數＋導向 `#issues`／`#reports` | 同上 |
| runtime Kit instance | `GET /api/kit/instances/current` | id／state（如 `kit_local_001` idle） | 同上 |
| runtime GPU | `GET /api/runtime/status`／`GET /api/kit/instances/current` | 使用率欄位；缺→unavailable | 「未取得」 |
| runtime 服務健康 | 同 svc-dot | 同 svc-dot | 同上 |
| runtime 事件 | 無既有事件端點 | 顯示「事件流未提供，見 `#instances`」（disabled＋原因） | 不得捏造事件列表 |
| 頂列 GPU chip | `GET /api/runtime/status` | GPU 使用率 | 「GPU 未取得」 |

- tasks 1.2 只做欄位 shape 盤點與型別對映；若某欄位不存在，畫面標 `unavailable`，**不**為此新增端點。

## 4. 各頁綁定與行為

- **#home**：四 KPI＋六 svc-dot 依 §3.3；每值附 `data-prov`／`data-state`；快捷按鈕 `data-action="nav"` 導向真頁（`#conv`、`#sessions`、`#issues`、`#minio`）。
- **#pipeline**：五段（進件／轉檔／Session／3D handoff／回拋）＋治理／報表列；轉檔段列出 `has_source_ifc` 物件與「觸發轉檔」按鈕（R5；D2 未裁決前 `disabled` 附「需 allowlist 來源」）；RVT 段固定顯示「外部產製／已退役（PR #63），不可由本站轉檔」，只呈現 `source_rvt` 是否存在，不提供按鈕。
- **#runtime**（真值 OpsPage）：Kit instance 卡、GPU 卡（未取得）、服務健康、事件（誠實停用）；按鈕導向 `#instances`／`#gpu`／`#sessions` 或 `disabled`。
- **#a1**：離線視區沿用現有示範圖，疊加「no-GPU 示意／示範圖（非即時渲染）」標籤（`data-prov="demo"`），移除捏造的串流指標；「啟動即時視圖」在無 session 時 `disabled` 附原因，有 review session 時為 anchor `target=_blank` 指向 `/ui/open?session=<id>`；不自動 claim；「開啟 A1 工作台」導向 `#a1-workbench`；不提供轉檔按鈕。
- **#a2／#a3**：移除 `docks.tsx:168,191,223,229` 的 local-state 假成功 toast；主要控制項 `data-action="nav"` 導向 `#version-diff`／`#federation`；其餘 `disabled` 附原因；badge 依 `data.ts` prov。
- **#a4**：真 dock 不動；頁首說明（用途／輸入來源／空表原因／下一步）。放置前提：`#a4` 若即為 `workspace.a4.default` 捕捉路由，任何可見變更都會改 pinned digest → tasks 0.6 owner 裁決；預設方案為只在非 pinned 路由的 unified `#a4` 頁首渲染。
- **#a5–#a10**：版面保留，控制項全數 `disabled`，原因文字含 roadmap／承接 change 名稱，`data-prov` 依 `data.ts`（A5 `p3`、A6–A10 `p4`）。
- **頂列**：GPU chip 綁 `/api/runtime/status`；「完整工具 ↗」保留於 dock（owner 2026-08-25 裁決 tasks 0.5：不升格到側欄——「完整工具」僅作舊功能保留，真實操作面收斂到本 change 的 unified 頁；R3 以 `api` 為首選、`nav` 為過渡）。
- **導向後仍受 IP 守門的動作**（`#conv` prioritize／retry、`#minio` 觸發）：D2 落地前，UnifiedConsole 側對應控制項 `disabled` 附「需 allowlist 來源」，避免把使用者導去按 403。

## 5. 控制項政策（R3）機器化

- 每顆 button／`role=button` 標 `data-action` ∈ {`api`, `nav`, `disabled`}；`disabled` 者必附合法 `data-prov` 與 `aria-describedby` 原因元素。
- 盤點測試（`buttonInventory.test.tsx`）以 offline 與 mocked-live 兩態渲染全部 unified 頁，列舉並斷言：無缺 `data-action`；任何「成功」toast 必須在 fetch mock 被呼叫後才出現；不得存在只改 local state 的成功回饋。

## 6. 測試與 gate 策略

- **單元（vitest，`web-viewer-sample`）**：更新 `src/console/EdgeConsole.sharedstatus.test.tsx`、`src/console/unified/a1DockLive.test.tsx`、`src/console/unified/unified.test.tsx`；新增 `coordinatorStatusStore.test.ts`、`homeLiveBinding.test.tsx`、`pipelineLiveBinding.test.tsx`、`opsLiveBinding.test.tsx`、`topbarGpuChip.test.tsx`、`buttonInventory.test.tsx`、`dockBadgeProv.test.tsx`、`a1OfflineViewport.test.tsx`、`a4Header.test.tsx`、`fixtureNotInProduction.test.ts`（符號層：production 元件不 import 假資料 export）。mock 一律以 `coordinatorClient` 層注入，不打真網路。
- **型別**：`npx tsc --noEmit`（vite build 不跑 tsc）。
- **design-semantic-visual**：`web-viewer-sample/e2e/design-system-semantic-cases.ts` 改斷言誠實狀態（全屏規模、`implemented_case_ids`＝`required_case_ids`）；D1=P 時非 `canonical_product_surface` 屏 rebaseline；工作樹乾淨後出證據（`design-system-visual.spec.ts:187`）；PR body `Design gate status` 逐字＝機器算出的 `mixed`。
- **functional-runtime-conv**：既有 harness 加 trigger 流程（本機 stack 走 loopback allowlist，驗證流程與 lineage 呈現；LAN 授權於 canonical-linux 驗）。
- **coordinator（pytest，`.venv`）**：`test_conversion_control_auth.py`（T4 token／T2 allowlist 通過；無憑證且非 allowlist → 403；速率限制 → 429；`/api/external/ifc-ready` 與 lineage 兩條路由回應逐字不變）；D3 時 `test_dev_routes_disabled.py`（`ENABLE_DEV_ROUTES=false` → `/api/dev/*` 404）與 env parity guard。
- **self-referential-bootstrap**：對 `web-viewer-sample/e2e/**`（semantic cases、visual spec）與 `web-viewer-sample/scripts/capture-design-system-reference.mjs`（僅 H）的修改登記 bootstrap ledger，`verification_mechanism_paths` ⊆ changed paths（`docs/agents/self-referential-bootstrap.md:84`）。

## 7. 部署與驗收（R7）

- merge 後由 owner inventory 執行 `pwsh scripts/dev/rebuild-test-deploy.ps1`（canonical-linux；既有事項：部署清 Kit build 後 Phase2 rebuild、冷 precache 勿在 SSH 下中斷）。
- 證據包：`/ui`（無 hash）、`#home`、`#pipeline`、`#runtime`、`#a1`、`#a2`、`#a3`、`#a4` 截圖＋同分鐘十端點 JSON；記錄 `deploy-*` tag 指向的 squash SHA。
- 公開 repo 隱私邊界：入檔前去識別化（遮 IP／主機名／bucket 真實 key），並通過 `scripts/verification-manifest.json:452` secret-pattern-scan；或只在 PR body 放去識別化摘要與 digest，原檔留 owner 私有根。
- 勾選規則：UI 相關 task 只憑 canonical-linux 證據勾選；本機綠只能註記「本機綠，待 181」。因部署在 merge 之後，實作 PR 必然以 §1–§3 未勾選狀態合併，archive 以驗收完成為前置。

## 8. 邊界

- 前端只經 coordinator `:8004`；不新增生產依賴；不新 3D 引擎；不改 viewer 主體；不動 lineage 後端契約；不做 A5–A10 全棧；不開放 `/api/dev/*`；不改 `rejectIfIpNotAllowed` 判定。
- 不 MODIFY active change 擁有的 capability（NoSuccessorWhilePredecessorOpen）；撞名處置見 proposal。
- R-A1：不直接編輯 `docs/plans/*.dc.html`、`docs/plans/*.md`、`docs/plans/ai-bim-governance.css`，只提案。R-A2：快照只由 capture 腳本雙旗標寫入。不覆寫 `workspace.a4.default`。

## 9. 回滾

- 單一 PR revert 即可：golden 自 git 還原；canonical 重部署自動 `build:ui`；無資料遷移；新 env（T2／D3）預設等於舊行為，未設定即不改變授權；T4 wrapper 移除不影響其他路徑。

## 10. MODIFIED delta 的 canonical 義務對照（archive 前逐條核對）

| canonical 條文 | 處置 | 說明 |
|---|---|---|
| `unified-governance-console:262` 兩組導覽、SHALL NOT 宣稱五組導覽 | 保留 | 原文逐字保留，附加 liveBackend 義務句 |
| `:267` SHALL NOT 宣稱 Chat USD 側欄 | 保留 | 原文逐字保留 |
| `:269-271` `/ui?session=` 不掛 console | 保留 | 原文逐字保留，未改 WHEN/THEN |
| `:275` a1/a2/a3 route 由 workspace 承接、fixture 語意、SHALL NOT 以 IssuesRuleCenterPage 充作 A1 | 保留＋限縮 | 「fixture 語意」附加「僅限 design-preview／離線態」限縮句 |
| `:279` mounts `WorkspacePage initialDock="a1"` … | 保留 | 原文逐字保留 |
| `:280` SHALL NOT 宣稱 upload/Excel、`A1DockLive` 僅 `/health` 成功時掛載 | 保留 | 原文逐字保留 |
| `:281` dock 互動 SHALL 誠實標示 fixture 語意（不打 /api）、SHALL NOT 呈現為 live evidence | **明示修改** | 原文保留，附加「自本 change 起限縮於 design-preview／離線態；liveBackend 時以真值與真頁導向取代」 |
| `:283-285` roadmap apps 標 roadmap／not built | 保留＋附加 | 附加控制項 `disabled`＋`p3`／`p4` |
| `edge-console-operator-frontend:217` `coordinatorClient` 封閉端點清單 | 保留＋擴充 | 原清單逐字保留，附加擴充清單（含 outbox summary redacted 投影） |
| `:217` callback outbox 三態直查需 internal token、SHALL NOT 捏造投遞數 | 保留 | 原文逐字保留並於擴充句重申 |
| `:217` 路由現況揭露（`#runtime` fixture 為 known gap、SHALL 另行修復） | 保留＋承接 | 原文保留，附加「修復承接：本 change」 |
| `:219-224` 只打 :8004、不直連、不幻覺端點 | 保留 | 原文逐字保留 |
| `:226-231` 無遙測標未取得、不捏造、離線誠實 | 保留 | 原文逐字保留 |
| `:233-238` fixture Ops 面為已知缺口、SHALL NOT 充作遙測、記為未解決缺口 | **明示修改** | 原文保留，附加「落地後 liveBackend 不掛 fixture 數值；fixture 只在 design-preview／離線態且標 demo、不顯數字」 |
