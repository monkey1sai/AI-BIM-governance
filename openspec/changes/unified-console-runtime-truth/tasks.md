# Tasks：unified-console-runtime-truth

**勾選規則**：UI 相關 task（§1–§3、§5 semantic、§6）只能以 canonical-linux `:8004/ui` 截圖＋同分鐘 API JSON 對照勾選；本機通過只能註記「本機綠，待 181」，不得打勾。每個 task 附最小驗證指令；指令 cwd 為 repo root（或對應 worktree）；vitest／tsc 指令 cwd 為 `web-viewer-sample`。編輯任何 symbol 前先 `gitnexus impact <Symbol> -d upstream -r AI-BIM-governance`，HIGH／CRITICAL 先回報。§0 裁決未寫入前，對應段落 HELD（0.1／0.4 → §5；0.2 → §4.2；0.3 → §4.4；0.5 → 側欄入口；0.6 → §3.2）。

## 0. Owner 裁決 gate（2026-08-25 owner 已全數裁決；§5 解除 HELD）

- [x] 0.1 D1 裁決：owner 在本行下方寫「D1 裁決：P｜H，日期」。驗證：`rg -n "D1 裁決" openspec/changes/unified-console-runtime-truth/tasks.md`
  - D1 裁決：P（六屏改以產品面誠實 offline／empty 狀態為 golden，owner 明示後雙旗標 rebaseline），2026-08-25 owner 口令「D1–D4 的選擇建議選項」。
- [x] 0.2 D2 裁決：conversion 控制路由瀏覽器授權（T4 operator token（建議）｜T2 獨立 allowlist env｜T1 LAN 匿名（CSRF-only，速率限制唯一緩解）｜T4+T2）；速率限制 N（預設 10/分鐘）。驗證：`rg -n "D2 裁決" openspec/changes/unified-console-runtime-truth/tasks.md`
  - D2 裁決：T4（沿用既有 Kit mutation dev token 型 operator token；per-route wrapper；速率限制 N=10/分鐘），2026-08-25 owner 口令。
- [x] 0.3 D3 裁決：canonical-linux 是否設 `ENABLE_DEV_ROUTES=false`（compose 透傳＋`.env.example` parity）；若否，R5 授權主張降級並於 proposal Risks 揭露。驗證：`rg -n "D3 裁決" openspec/changes/unified-console-runtime-truth/tasks.md`
  - D3 裁決：是——canonical-linux 設 `ENABLE_DEV_ROUTES=false`（compose 透傳＋`.env.example` parity），2026-08-25 owner 口令。
- [x] 0.4 D4 裁決：`align-frontend-design-system-reference` 是否需先 thaw，或本 change 適用 `console-design-token-authority:60-64` carve-out。驗證：`rg -n "D4 裁決" openspec/changes/unified-console-runtime-truth/tasks.md`
  - D4 裁決：適用 `console-design-token-authority:60-64` carve-out，不 thaw `align-frontend-design-system-reference`，2026-08-25 owner 口令。
- [x] 0.5 canon 側欄是否新增「完整工具」入口；若是，依 R-A1 開提案 PR（不自行編輯 docs/plans）。驗證：本 change 實作 PR 內 `git diff --name-only origin/main -- docs/plans` 為空
  - 裁決：不新增側欄「完整工具」入口。owner 2026-08-25：「完整工具只是保留之前的功能，但真實操作頁面已經收斂到新需求上」——即「完整工具 ↗」僅作舊功能保留；本 change 的 unified 頁本身即真實操作面（R3 以 `api` 為首選、`nav` 為過渡）；canon 不改、無 R-A1 提案。
- [x] 0.6 R6 放置位置：確認 `workspace.a4.default` 捕捉路由是否等於 `#a4`；若等於，owner 裁決放置方式。驗證：`rg -n "workspace.a4.default" docs/plans/design-system-reference.manifest.json web-viewer-sample/e2e`
  - 裁決：同意預設方案——A4 頁首說明只在非 pinned 路由的 unified `#a4` 頁首渲染，`workspace.a4.default` pinned digest 不變，2026-08-25 owner 口令。

## 1. web-viewer-sample：真值綁定（R1、R2）

- [ ] 1.1 impact 分析：`gitnexus impact UnifiedShell -d upstream -r AI-BIM-governance`；同樣對 `HomePage`、`PipelinePage`、`OpsPage`、`coordinatorClient` 執行並記錄 blast radius
  - 本機完成（slice 1）：五個 UI symbol（`UnifiedShell`／`HomePage`／`PipelinePage`／`OpsPage`／`coordinatorClient`）LOW；`jsonGet` **HIGH**（16 個同檔 caller、0 process），coordinator 2026-08-25 追認續行（spec-to-done：HIGH 非停下點），補強＝error message 逐字不變＋既有 client 測試全綠；PR body 揭露。
- [ ] 1.2 端點欄位 shape 盤點（十個端點皆已存在：`app.ts:1363,2374,2399,2462,3215,3779,3785`、`routes/governanceProxy.ts:223`）：逐一記錄欄位與型別對映；缺欄位者畫面標 `data-state="unavailable"`，不新增端點。驗證：盤點表附於 PR 描述；`rg -n "runtime/status|external/ifc-ready|conversion/records|callback-outbox/summary|governance/issues|governance/rule-runs|minio-watch/status|minio/objects|kit/health|kit/instances/current" bim-review-coordinator/src`
  - 本機完成：盤點表附於 PR body（十端點皆存在，無新增），待 181 隨 slice 1 勾選（commit `57d29d3`）
- [ ] 1.3 共用 poller store `useCoordinatorStatusStore`（單一 in-flight／指數退避 ≤60s／hidden 暫停），沿用 `coordinatorClient`，以 `ConsoleDataProvider` 介面注入。驗證：`npx vitest run src/console/unified/coordinatorStatusStore.test.ts`；`npx tsc --noEmit`
  - 本機綠，待 181（slice 1，commit `57d29d3`）
- [ ] 1.4 `#home` 四 KPI＋六 svc-dot 綁定；`data-prov="asbuilt"`＋`data-state`；offline 顯示 `—`／未連線。驗證：`npx vitest run src/console/unified/homeLiveBinding.test.tsx`
  - 本機綠，待 181（slice 1，commit `57d29d3`）
- [ ] 1.5 `#pipeline` 五段＋治理／報表列綁定；RVT 段退役標示；outbox 只用 `/api/callback-outbox/summary`。驗證：`npx vitest run src/console/unified/pipelineLiveBinding.test.tsx`
  - 本機綠，待 181（slice 1，commit `57d29d3`；has_source_ifc 逐物件觸發列表隨 D2 授權於 §4.2／§2.4 落地，本 slice 為 disabled＋原因）
- [ ] 1.6 `#runtime` 真值 OpsPage（Kit instance／GPU 未取得／服務健康／事件誠實停用）。驗證：`npx vitest run src/console/unified/opsLiveBinding.test.tsx`
  - 本機綠，待 181（slice 1，commit `57d29d3`）
- [ ] 1.7 頂列 GPU chip 綁定，移除字面 `82%`（`UnifiedShell.tsx:143`）。驗證：`npx vitest run src/console/unified/topbarGpuChip.test.tsx`；`rg -n "82%" web-viewer-sample/src/console/unified` 為空
  - 本機綠，待 181（slice 1）：production 檔（排除 `*.test.*`）`rg -n "82%" web-viewer-sample/src/console/unified` 為空；三個測試檔含該字面僅作負向 oracle（斷言渲染輸出不含 `82%`）。
- [ ] 1.8 假資料 export 退出 production 顯示路徑（`initialIntake`／`initialConv`／`initialSessions`／`initialOutbox`／`initialIssues`／`alerts`／`services`／`failDefs`／`diffDefs`／`fedMembers`／`stageTree`；D1=P 移到 test-only、D1=H 只由 preview provider 載入）；i18n／導覽／style helper 保留。驗證：`npx vitest run src/console/unified/fixtureNotInProduction.test.ts`；`npm run build:ui` 後 `rg -c "GPU/Stream 82%" dist-ui` 為 0
  - 本機綠，待 181（slice 1，commit `57d29d3`；7 個 export 已移 test-only，`failDefs`／`diffDefs`／`fedMembers`／`stageTree` 由 docks／WorkspacePage 續用，以 fixtureNotInProduction.test.ts ratchet 釘住，§2／§3 切片承接）

## 2. web-viewer-sample：控制項與 badge（R3）

- [ ] 2.1 全部控制項標 `data-action` ∈ {api, nav, disabled}；`disabled` 附合法 `data-prov`（七值）＋`aria-describedby` 原因。驗證：`npx vitest run src/console/unified/buttonInventory.test.tsx`
- [ ] 2.2 A1–A3 dock 導向真頁（`#a1-workbench`／`#version-diff`／`#federation`）；移除 `docks.tsx:168,191,223,229` 的 local-state 假成功 toast。驗證：`rg -n "u.toast" web-viewer-sample/src/console/unified/docks.tsx` 逐項對應到 fetch 呼叫或已刪除；`npx vitest run src/console/unified/buttonInventory.test.tsx`
- [ ] 2.3 側欄與啟動器 badge 依 `data.ts` `A1A10.prov`，移除寫死 `LIVE`（`fixtures.ts:156-165`）；A5–A10 控制項 `disabled` 附承接 change 名稱與 `p3`／`p4`。驗證：`npx vitest run src/console/unified/dockBadgeProv.test.tsx`；`rg -n '"LIVE"' web-viewer-sample/src/console/unified` 為空
- [ ] 2.4 導向後仍受 IP 守門的動作（`#conv` prioritize／retry、`#minio` 觸發）在 D2 落地前於 UnifiedConsole 側 `disabled` 附「需 allowlist 來源」。驗證：`npx vitest run src/console/unified/buttonInventory.test.tsx`

## 3. 3D 工作區與 A4（R4、R6）

- [ ] 3.1 A1 離線視區標籤「no-GPU 示意／示範圖」（`data-prov="demo"`），移除捏造串流指標；有 session 時 anchor `target=_blank` 指向 `/ui/open?session=<id>`；不自動 claim；無轉檔按鈕。驗證：`npx vitest run src/console/unified/a1OfflineViewport.test.tsx`
- [ ] 3.2 A4 頁首說明（依 0.6 裁決位置）：用途／輸入來源／空表原因（取自 `/api/external/ifc-ready` 與 `/api/governance/search/llm-status`）／下一步。驗證：`npx vitest run src/console/unified/a4Header.test.tsx`；`pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`（a4 pinned digest 不變）

## 4. bim-review-coordinator（R5、D3）

- [ ] 4.1 impact：`gitnexus impact rejectIfIpNotAllowed -d upstream -r AI-BIM-governance`；列出全部呼叫點（`app.ts:1616,1642,1678,1728`、`lineageSourceBundleRoutes.ts:523,573`）並確認本 change 不改 helper 本體
- [ ] 4.2 依 D2 以 per-route wrapper 為四條 conversion 控制路由實作授權（T4：header token 同型比對 `isKitMutationAuthorized`；T2：`CONVERSION_TRIGGER_IP_ALLOWLIST`＋fail-fast 守衛＋compose 透傳＋parity；T1：同 origin＋短效 token＋速率限制）；`/api/external/*` 不變。驗證：`.venv/Scripts/python -m pytest bim-review-coordinator/tests/test_conversion_control_auth.py -q`（含：無憑證且非 allowlist → 403；速率限制 → 429；`/api/external/ifc-ready` 回應逐字不變）
- [ ] 4.3 lineage 釘樁：`lineageSourceBundleRoutes.ts` 兩條路由（`legacy-unmanaged/preview`／`confirm`）授權行為變更前後逐字相同；prioritize／retry／watch 三條路由的既有 allowlist 行為釘樁。驗證：`.venv/Scripts/python -m pytest bim-review-coordinator/tests/lineage -q`；`bim-review-coordinator` 對應 vitest：`npx vitest run tests/lineage`
- [ ] 4.4 D3：canonical env `ENABLE_DEV_ROUTES=false`（compose `environment:` 透傳＋`.env.example` parity guard，沿用 PR #693 模式）；受影響 Edge Console 頁在 404 時誠實顯示「dev routes 已關閉」。驗證：`npx vitest run tests/env-example-parity`（或既有 parity 測試名）；`.venv/Scripts/python -m pytest bim-review-coordinator/tests/test_dev_routes_disabled.py -q`
- [ ] 4.5 coordinator 全量：`.venv/Scripts/python -m pytest bim-review-coordinator/tests -q` 與 `npx vitest run`（cwd `bim-review-coordinator`）

## 5. design gate／rebaseline／semantic cases／既有測試（R8；HELD 直到 0.1 與 0.4）

- [ ] 5.1 更新 `src/console/EdgeConsole.sharedstatus.test.tsx:54-67`：改為「`#home` 經共用 poller 呼叫 runtimeStatus，同端點單一 in-flight」。驗證：`npx vitest run src/console/EdgeConsole.sharedstatus.test.tsx`
  - 本機綠，待 181（slice 1，commit `57d29d3`）
- [ ] 5.2 更新 `src/console/unified/a1DockLive.test.tsx:100-104`：liveBackend 時 fixture 區塊由真值取代（不再斷言 `A1_Tower_v12.ifc` 與 `data-prov="fixture"` 根）。驗證：`npx vitest run src/console/unified/a1DockLive.test.tsx`
  - 本機綠（解凍 fixture 斷言），待 181；「真值取代」正向斷言隨 §2.2／§3.1 落地（slice 1，commit `57d29d3`）
- [ ] 5.3 更新 `src/console/unified/unified.test.tsx`（KPI 標籤斷言改為 mock API 值與 offline 狀態）。驗證：`npx vitest run src/console/unified/unified.test.tsx`
  - 本機綠，待 181（slice 1，commit `57d29d3`）
- [ ] 5.4 更新 `web-viewer-sample/e2e/design-system-semantic-cases.ts`：`kpi-conv-val`／`kpi-outbox-val`／`svc-dot` 等 fixture 值斷言改為誠實狀態斷言；因 `implemented_case_ids`＝`required_case_ids` 且每屏執行（`design-system-visual.spec.ts:182-184,217`），以全屏規模評估；登記 bootstrap ledger（`verification_mechanism_paths` ⊆ changed paths）。驗證：依 `scripts/verification-manifest.json:423-436` 的 `design-semantic-visual` 項目執行
  - 本機：12/13 屏 semantic_parity=1（home／pipeline／ops／workspace.a1／a2／a4／concept.a5–a10 全綠；`workspace.a3.default:failure` 未過，經三重隔離驗證＝pre-existing、與本 slice 無關，見 artifacts/slice1-gates.txt 與 PR body concerns）；pixel 三屏（home／pipeline／ops）預期紅（待 5.5 owner rebaseline）；`web-viewer-sample/e2e/**` 非 `Get-SelfReferentialMechanismPaths` 機制面，bootstrap ledger 未登記（PR body `Self-referential bootstrap: no`），待 181（slice 1，commit `57d29d3`）
- [ ] 5.5 D1=P：owner 明示後執行 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`（非 `canonical_product_surface` 屏重拍；`workspace.a4.default` digest 不變）。D1=H：實作 design-preview harness＋capture 機制變更＋production bundle 不可達測試＋bootstrap ledger。驗證：`pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`
- [ ] 5.6 乾淨工作樹跑兩道 required gate（`design-semantic-visual`、`functional-runtime-conv`）；PR body `Design gate status` 逐字＝機器算出的 `mixed`。驗證：`git status --porcelain=v1 --untracked-files=all` 為空；gate 命令依 `scripts/verification-manifest.json:423-450`
  - 本機：design-semantic-visual 12/13 屏 semantic_parity=1（workspace.a3 pre-existing 未過，見 5.4 子彈）、pixel 三屏預期紅；functional-runtime-conv passed（FUNCTIONAL_COORDINATOR_PORT=18005 避開被占用之預設 8005，未動該既有程序）；結果見 PR body（slice 1，commit `57d29d3`）
- [ ] 5.7 前端全量：`npx tsc --noEmit && npx vitest run`（cwd `web-viewer-sample`）
  - 本機綠，待 181（slice 1，commit `57d29d3`；tsc exit 0、vitest 89 files/1175 tests passed、lint:baseline 0 regressions）

## 6. canonical-linux 部署驗收（R7）

- [ ] 6.1 merge 後 owner inventory 執行 `pwsh scripts/dev/rebuild-test-deploy.ps1`；確認 `deploy-*` tag 指向本 change squash SHA。驗證：`git tag -l 'deploy-*' --sort=-creatordate | head -1` 的 tag 訊息 `deployed=` 與 squash SHA 一致
- [ ] 6.2 canonical-linux 證據包：`/ui`（無 hash）、`#home`、`#pipeline`、`#runtime`、`#a1`、`#a2`、`#a3`、`#a4` 截圖＋同分鐘十端點 JSON；去識別化後入檔（png 需 `git add -f`）或於 PR body 放摘要＋digest。驗證：每張截圖數值 vs JSON 逐項對照表
- [ ] 6.3 LAN 瀏覽器依 D2 授權觸發轉檔實測：對 `has_source_ifc` 物件觸發 → 非 403 → job lineage 可見；再次觸發顯示冪等回應。驗證：截圖＋`/api/conversion/records` JSON
- [ ] 6.4 負向：無憑證且非 allowlist IP 的 `POST /api/conversion/trigger` 回 403；`/api/external/ifc-ready` 授權未變；D3 落地時 `POST /api/dev/conversions` 回 404。驗證：`curl -i` 三組請求輸出（去識別化）
- [ ] 6.5 證據隱私：檔名／JSON 不含 LAN IP、主機名、bucket 真實 key，並通過 secret-pattern-scan。驗證：依 `scripts/verification-manifest.json:452` 執行

## 7. 文件與 closeout

- [ ] 7.1 更新 `docs/agents/repo-data-flow-and-ownership.md`（UI→coordinator 共用 poller、conversion 控制路由授權路徑、D3 dev routes）；`AGENTS.md` frontend Known gaps 表同步。驗證：`rg -n "useCoordinatorStatusStore|conversion/trigger|ENABLE_DEV_ROUTES" docs/agents AGENTS.md`
- [ ] 7.2 `docs/plans/NOW.md` 看板與 `openspec/lifecycle-ledger.json` 對帳（`task_ledger`、`current_slice`）；D1=H 或 semantic cases 變更時 bootstrap ledger 登記。驗證：`node scripts/tests/verify-openspec-repository-lifecycle.mjs`
- [ ] 7.3 `npx openspec validate unified-console-runtime-truth --strict` 與 `npx openspec validate --all --strict`
- [ ] 7.4 archive 前 MODIFIED delta 與 canonical 逐條義務對照（design §10 表逐列核對，非只比標題與 scenario 名）；標題 byte-exact。驗證：`rg -n "### Requirement: Product Governance Console Shell|### Requirement: A1-A10 Pages Preserve Prototype Intent" openspec/specs/unified-governance-console/spec.md`；`rg -n "Coordinator/Intake/Runtime 頁 SHALL 只打" openspec/specs/edge-console-operator-frontend/spec.md`
- [ ] 7.5 PR body 機器規則：`Design gate status: mixed`、bootstrap claim ⊆ changed paths、frontend Known gaps 列全 routes、`kit_gpu` 表＋Actions URL、裸 yes/no 欄位。驗證：pr-review-agent required check 綠
- [ ] 7.6 gitnexus：`gitnexus detect-changes --scope compare --base-ref main` 無非預期 symbol；merge 後 `git fetch --prune`
