## ADDED Requirements

### Requirement: 預設入口 /ui 與 #home SHALL 只呈現真值或誠實未取得，fixture 假值 SHALL NOT 進入 production 顯示路徑

在 canonical-linux 部署（`scripts/deploy-target-registry.json` 中 `role: canonical_test_deploy` 的目標）上，coordinator `:8004/ui`（無 hash）與 `#home` SHALL 只呈現來自 coordinator `:8004` 的真值，或以 `data-state="unavailable"`（「未取得」）／`data-state="offline"`（「未連線」）誠實標示；SHALL NOT 渲染任何 fixture 數字，SHALL NOT 以 `0` 充當佔位。`web-viewer-sample/src/console/unified/fixtures.ts` 中下列假資料 export（含其後繼命名）SHALL NOT 成為 production 顯示值來源：`initialIntake`、`initialConv`、`initialSessions`、`initialOutbox`、`initialIssues`、`alerts`、`services`、`failDefs`、`diffDefs`、`fedMembers`、`stageTree`。同檔的 i18n 字典（`getL`）、導覽設定（`navMain`／`apps`／`dockTabs`）與 style helper（`MONO`／`BTN`／`badgeTone`／`navItem`／`memColors`／`VP_BASE`／`label9`／`chipBox` 等）MAY 留在 production（對齊 `unified-governance-console` canonical「導覽分組來源為 unified/fixtures.ts」之描述）。

#### Scenario: canonical-linux 無 hash 開啟預設入口

- **GIVEN** canonical-linux 已部署本 change merge 後的 squash SHA，且 coordinator `:8004` 存活
- **WHEN** operator 開啟 `http://<canonical-linux>:8004/ui`（無 hash）
- **THEN** 落地頁為 `#home`，每個 KPI 數值 SHALL 與同分鐘抓取的對應 API JSON 一致（例：活躍 Sessions=0、未結 Issue=0、Outbox 待送=36）
- **AND** 畫面 SHALL NOT 出現任何來自 fixture 假資料 export 的固定值（例：`990_model.ifc 62%`、`S-240601`、`rule-run #88`、`2026-07-14`）

#### Scenario: 後端不可達時誠實未連線

- **GIVEN** `/api/**` 回 502／503 或網路不可達
- **WHEN** operator 開啟 `#home`
- **THEN** 每個 KPI SHALL 顯示 `—` 並帶 `data-state="offline"` 與「未連線」文字，SHALL NOT 顯示任何數字，頁面 SHALL NOT 崩潰
- **AND** 重試 SHALL 以指數退避且上限 60 秒

#### Scenario: fixture 假值不在 production 顯示路徑（符號層驗證）

- **GIVEN** `web-viewer-sample` 的 production 元件 `HomePage`／`PipelinePage`／`OpsPage`／`UnifiedShell`／`docks`
- **WHEN** 執行符號層 import 測試與 `npm run build:ui` 後的 bundle 字面掃描
- **THEN** 上述元件 SHALL NOT import 本 requirement 列舉的假資料 export；bundle SHALL NOT 含字面 `GPU/Stream 82%`
- **AND** i18n／導覽／style helper 的 import SHALL 不受此限制

### Requirement: Home KPI、#pipeline 五段、#runtime 與頂列 GPU chip SHALL 綁定 coordinator 既有真端點並經單一共用 poller

Home KPI（轉檔中／活躍 Sessions／未結 Issue／Outbox 待送）、`#pipeline` 五段（進件／轉檔／Session／3D handoff／回拋）與治理／報表列、`#runtime`（Kit instance／GPU／服務健康／事件）與頂列 GPU chip SHALL 只綁定 coordinator `:8004` 下列**既有**端點（本 change 盤點時皆已存在於 `bim-review-coordinator/src/app.ts` 與 `src/routes/governanceProxy.ts`，SHALL NOT 為此新增聚合端點）：`GET /api/runtime/status`、`GET /api/external/ifc-ready`、`GET /api/conversion/records`、`GET /api/callback-outbox/summary`（redacted 投影：排除 `payload`／`target_url`，`limit` 上限 200；三態直查仍在 `/api/internal/callback-outbox/*` internal token 之後）、`GET /api/governance/issues`、`GET /api/governance/rule-runs`、`GET /api/external/minio-watch/status`、`GET /api/minio/objects`、`GET /api/kit/health`、`GET /api/kit/instances/current`。無遙測值（200 但欄位為 `null`／缺席）SHALL 標「未取得」（`data-state="unavailable"`）；後端不可達 SHALL 誠實呈現「未連線」（`data-state="offline"`）；其餘 4xx SHALL 誠實顯示狀態碼與訊息；頂列 GPU chip SHALL NOT 寫死。所有讀取 SHALL 經單一共用 poller（同端點同時最多一個 in-flight 請求、失敗指數退避上限 60 秒、`document.hidden` 時暫停），SHALL 沿用既有 `coordinatorClient`，SHALL NOT 新增 HTTP client 或生產依賴。事件列（`#runtime` structLog 區）在 coordinator 未提供事件端點前 SHALL 誠實停用並導向 `#instances`，SHALL NOT 捏造事件列表。

#### Scenario: Home KPI 與 API 對照

- **GIVEN** 同分鐘 API 回 `/api/runtime/status` 無 active session、`/api/governance/issues` 為 `[]`、`/api/callback-outbox/summary` 之 `pending` 計數為 36、`/api/conversion/records` 無 `running`
- **WHEN** 開啟 `#home`
- **THEN** KPI SHALL 顯示 轉檔中=0、活躍 Sessions=0、未結 Issue=0、Outbox 待送=36，且每個值帶 `data-prov="asbuilt"` 與 `data-state="live"`

#### Scenario: Pipeline 五段對照

- **GIVEN** `/api/minio/objects` 回 7 個資料夾、其中 3 個 `has_source_ifc`；`/api/external/minio-watch/status` 回 enabled、baseline 12、seen 12、triggered 0；`/api/conversion/records` 12 筆 `ready`；`/api/external/ifc-ready` 0 筆；`/api/kit/instances/current` 為 `kit_local_001` idle；`/api/callback-outbox/summary` 36 筆 pending（attempts 0/5）
- **WHEN** 開啟 `#pipeline`
- **THEN** 進件段 SHALL 顯示 ifc-ready 0、bucket 摘要 7／3 與 watch 狀態；轉檔段 SHALL 顯示 ready 12、running 0；Session 段 SHALL 顯示 `kit_local_001` idle、session 0；3D handoff 段 SHALL 顯示「無可 handoff session」；回拋段 SHALL 顯示 pending 36（attempts 0/5）
- **AND** 治理／報表列 SHALL 顯示 rule-run 與 issue 計數並導向 `#issues`／`#reports`

#### Scenario: GPU 遙測未取得

- **GIVEN** `/api/runtime/status` 與 `/api/kit/instances/current` 皆無 GPU 使用率欄位
- **WHEN** 開啟 `#runtime`
- **THEN** GPU 卡 SHALL 顯示「未取得」（`data-state="unavailable"`），SHALL NOT 顯示 `82%`／`24%`／`14.6/24 GB` 等任何數值，SHALL NOT 視為錯誤

#### Scenario: 頂列 GPU chip 不寫死

- **GIVEN** 同上遙測未取得
- **WHEN** 開啟任一 UnifiedConsole 頁
- **THEN** 頂列 chip SHALL 顯示「GPU 未取得」；遙測可得時 SHALL 顯示 API 值；程式碼與 bundle SHALL NOT 存在字面常數 `82%`

#### Scenario: 共用 poller 單一 in-flight

- **GIVEN** `#home` 與 `#pipeline` 同時訂閱 `/api/runtime/status`
- **WHEN** 兩者掛載並經過一個輪詢週期
- **THEN** 同一輪 SHALL 只發出一個 `/api/runtime/status` 請求
- **AND** 後端連續失敗時間隔 SHALL 退避至上限 60 秒，且同端點 SHALL NOT 超過 1 個 in-flight

#### Scenario: outbox 摘要只用 redacted 投影

- **GIVEN** `#home`／`#pipeline` 需要 Outbox 待送計數
- **WHEN** 前端取數
- **THEN** SHALL 只呼叫 `GET /api/callback-outbox/summary`，SHALL NOT 呼叫 `/api/internal/callback-outbox/*`，畫面 SHALL NOT 顯示 `payload`／`target_url`

### Requirement: UnifiedConsole 控制項 SHALL NOT 是假按鈕，badge SHALL 反映 canonical Prov 詞彙

UnifiedConsole（home／pipeline／runtime／A1–A10 dock／頂列）每顆 button 或 `role=button` 控制項 SHALL 屬於下列三者之一：(1) `data-action="api"`——呼叫 coordinator 真端點並以真回應更新畫面；(2) `data-action="nav"`——導向既有真頁（`#a1-workbench`、`#version-diff`、`#federation`、`#conv`、`#minio`、`#sessions`、`#instances`、`#issues`、`#gpu`、`#reports`）；(3) `data-action="disabled"`——`disabled` 並附 `data-prov`（值域限 `edge-console-operator-frontend` 與 `unified-governance-console` 既有七值：`asbuilt`／`artifact`／`demo`／`p1`／`p15`／`p3`／`p4`）與 `aria-describedby` 原因文字。SHALL NOT 存在只改 local state 就顯示「成功」toast 的控制項（現況 `unified/docks.tsx` 的 A2「計算差異」與 A3「Build Federated USD」即為此類假成功回饋，SHALL 移除）。導向 `#conv`／`#minio` 等真頁的控制項，若其後端動作仍受 IP allowlist 守門且未納入本 change D2 授權範圍，SHALL 於 UnifiedConsole 側 `disabled` 並以原因說明「需 allowlist 來源」。A1–A4 側欄 badge SHALL 反映 `web-viewer-sample/src/console/data.ts` `A1A10` 的 `prov`（A1–A3 `asbuilt`、A4 `asbuilt` PARTIAL），SHALL NOT 寫死 `LIVE`；A5–A10 SHALL 依 `data.ts` 標 `p3`／`p4`。

#### Scenario: 按鈕盤點

- **GIVEN** 以 offline 與 mocked-live 兩種狀態渲染全部 UnifiedConsole 頁
- **WHEN** 盤點測試列舉所有 button／`role=button`
- **THEN** 每顆 SHALL 有 `data-action` ∈ {`api`, `nav`, `disabled`}；`disabled` 者 SHALL 有合法 `data-prov` 與 `aria-describedby` 原因
- **AND** SHALL NOT 存在未呼叫 fetch 即觸發成功 toast 的 onClick

#### Scenario: A2／A3 dock 不再假成功

- **GIVEN** operator 在 `#a2` dock 點「計算差異」或在 `#a3` dock 點「Build Federated USD」
- **WHEN** 點擊
- **THEN** SHALL 導向 `#version-diff`／`#federation`（`data-action="nav"`）或呼叫真端點（`data-action="api"`），SHALL NOT 顯示「POST … → 202」之類未經真請求的成功 toast

#### Scenario: 待建功能誠實停用

- **GIVEN** 某控制項對應功能尚未實作（A5–A10 roadmap，或後端待建能力）
- **WHEN** 渲染
- **THEN** 該控制項 SHALL `disabled`，`data-prov` 為 `p3`／`p4`（roadmap）或 `p1`／`p15`（後端待建），原因文字 SHALL 含承接 change 名稱或待建原因，SHALL NOT 有假成功回饋

#### Scenario: badge 依 canonical Prov

- **GIVEN** `data.ts` `A1A10` 的 `prov` 值
- **WHEN** 渲染側欄與應用啟動器
- **THEN** badge 文字 SHALL 對映該 `prov`（例：`asbuilt`、`asbuilt · PARTIAL`、`p3`、`p4`），SHALL NOT 出現寫死的 `LIVE`

### Requirement: A1 3D 工作區 SHALL 誠實呈現離線視區與手動 handoff，SHALL NOT 自動 claim

無 review session 時，`#a1` 視區 SHALL 顯示明標「no-GPU 示意／示範圖（非即時渲染）」的離線視區（`data-prov="demo"`），SHALL NOT 假裝為即時串流（SHALL NOT 顯示 `Streaming · 28 ms`／`60 FPS` 等捏造串流指標）；有 review session 時 SHALL 提供 `/ui/open?session=<id>` 的手動 handoff 連結（新分頁 anchor，非 iframe），SHALL NOT 自動 claim session（對齊 `viewer-viewport` canonical「viewport SHALL mount 不自動 claim、啟動一律手動」）；持久內嵌 primary viewport 由 `introduce-viewer-app-integration-surface` 承接，本 capability SHALL NOT 重複宣告。`#a1` SHALL NOT 提供轉檔按鈕（對齊 A1 workbench「A1 不排入轉檔」），SHALL 以連結導向 `#pipeline`／`#minio`。

#### Scenario: 無 session 離線視區

- **GIVEN** `/api/runtime/status` 無 review session
- **WHEN** 開啟 `#a1`
- **THEN** 視區 SHALL 顯示示範圖與「no-GPU 示意／示範圖」標籤（`data-prov="demo"`），SHALL NOT 顯示串流指標數值
- **AND** 「啟動即時視圖」控制項 SHALL `disabled` 並以 `aria-describedby` 說明「無 review session」

#### Scenario: 有 session 手動 handoff

- **GIVEN** `/api/runtime/status` 有一個 review session id=S
- **WHEN** 開啟 `#a1`
- **THEN** SHALL 顯示「開啟即時視圖（新分頁）」anchor 指向 `/ui/open?session=S`
- **AND** 頁面載入 SHALL NOT 呼叫任何 claim／attach／heartbeat 端點；`#a1` SHALL NOT 內嵌 `iframe[src*='/ui/open']`

#### Scenario: A1 不排入轉檔

- **GIVEN** operator 在 `#a1`
- **WHEN** 尋找轉檔控制項
- **THEN** SHALL NOT 存在轉檔按鈕；SHALL 以 `data-action="nav"` 連結導向 `#pipeline`／`#minio`

### Requirement: canonical-linux 上 operator SHALL 能由 UI 觸發既有 MinIO 物件轉檔，授權 SHALL 以 per-route 方式落地且 SHALL NOT 放寬 lineage 與 webhook 面

`#pipeline` 與 `#minio` SHALL 讓 operator 對 bucket `bim-control` 內 `has_source_ifc` 物件觸發既有 intake 鏈（`POST /api/conversion/trigger`，沿用既有冪等語意），並在觸發後看到 job lineage（record id／狀態／來源 key）。coordinator SHALL 為四條 conversion 控制路由（`POST /api/conversion/jobs/:id/prioritize`、`POST /api/conversion/jobs/:id/retry`、`PUT /api/conversion/watch`、`POST /api/conversion/trigger`）提供 owner 於 D2 裁決的瀏覽器可用授權路徑，且 SHALL 以 per-route wrapper 實作：共用 helper `rejectIfIpNotAllowed` 的判定 SHALL NOT 改變，經 deps 注入使用同一 helper 的 lineage source-bundle 路由（`lineageSourceBundleRoutes.ts` 的 `legacy-unmanaged/preview`／`confirm`）授權行為 SHALL 逐字不變。SHALL NOT 放寬 `EXTERNAL_INTAKE_IP_ALLOWLIST` 或任何 `/api/external/*` webhook 授權面；SHALL NOT 以 `/api/dev/*` 作為產品路徑。D2 選項：T4（建議）沿用既有 Kit mutation dev token 機制（`isKitMutationAuthorized` 同型比對）作為 operator token，由 `/ui` 殼層以 operator 明示輸入、只存 sessionStorage、以 header 送出；T2 新增獨立 `CONVERSION_TRIGGER_IP_ALLOWLIST`（預設等於既有行為；compose 透傳＋`.env.example` parity guard；啟動時若 `MINIO_WATCH_ENABLED=true` 且缺 loopback SHALL fail-fast，對稱既有守衛）；T1 同 origin 短效 token 只防 CSRF、不構成授權，SHALL 明列為「允許 LAN 匿名觸發，速率限制為唯一緩解」並由 owner 明知後才得採用。RVT 段 SHALL 誠實標示「外部產製／已退役（PR #63），不可由本站轉檔」，SHALL NOT 提供 RVT 轉檔按鈕。

#### Scenario: LAN 瀏覽器依 D2 授權觸發成功

- **GIVEN** canonical-linux 從 LAN 瀏覽器開啟 `/ui`，物件 K 為 `has_source_ifc`，且 operator 已依 D2 方案完成授權（T4：輸入 operator token）
- **WHEN** operator 在 `#pipeline` 對 K 點「觸發轉檔」
- **THEN** 回應 SHALL 非 403；畫面 SHALL 顯示新 job 的 record id 與狀態；`/api/conversion/records` 經 poller 更新後 SHALL 可見該 job

#### Scenario: 冪等重觸發

- **GIVEN** K 已有 `ready` record
- **WHEN** 再次觸發
- **THEN** 畫面 SHALL 顯示 coordinator 的冪等回應（既有 record id／狀態），SHALL NOT 出現假的「成功建立」

#### Scenario: 未授權來源仍受限且 webhook／lineage 面不變

- **GIVEN** 不帶 D2 授權憑證、來源 IP 亦不在 allowlist 的 `POST /api/conversion/trigger`
- **WHEN** 發出請求
- **THEN** SHALL 回 403
- **AND** `/api/external/ifc-ready` 的授權回應、`lineageSourceBundleRoutes.ts` 兩條路由的授權回應 SHALL 與變更前逐字相同（釘樁測試）

#### Scenario: dev 路徑不是產品路徑且 canonical-linux 關閉 dev routes

- **GIVEN** UnifiedConsole 任一頁，且 owner 於 D3 裁決 canonical-linux 設 `ENABLE_DEV_ROUTES=false`
- **WHEN** 掃描前端程式碼與網路請求，並於 canonical-linux 對 `POST /api/dev/conversions` 發出請求
- **THEN** 前端 SHALL NOT 存在對 `/api/dev/*` 的呼叫；canonical-linux SHALL 回 404
- **AND** 依賴 `/api/dev/*` 的 Edge Console 頁（`#demo-control`、A1 workbench local_fs 清單）SHALL 誠實顯示「dev routes 已關閉」而非崩潰或假資料

#### Scenario: RVT 段標示退役

- **GIVEN** 物件含 `source_rvt`
- **WHEN** 顯示 `#pipeline` 轉檔段
- **THEN** RVT SHALL 顯示「外部產製／已退役，不可由本站轉檔」，SHALL NOT 有 RVT 轉檔按鈕

### Requirement: #a4 頁首 SHALL 以 operator 語言說明用途與空表原因，且 SHALL NOT 改變 pinned 快照

`#a4` SHALL 在頁首說明：用途（語意查詢與證據）、輸入來源（review session 或 ifc_ready job）、目前為何空表（無 ifc-ready job／LLM 未設定，取自 `/api/external/ifc-ready` 與 `/api/governance/search/llm-status` 真狀態）與下一步（導向 `#minio` 觸發轉檔或 `#sessions`）。說明位置 SHALL NOT 改變 `workspace.a4.default` pinned digest；若 `#a4` 即為 pinned 捕捉路由，放置方式 SHALL 由 owner 裁決後始得實作。

#### Scenario: 空表原因

- **GIVEN** `/api/external/ifc-ready` 為 0 筆且 `/api/governance/search/llm-status` 回 `state: disabled`
- **WHEN** 開啟 `#a4`
- **THEN** 頁首 SHALL 顯示用途、輸入來源、「目前無 ifc-ready job」「LLM 未設定」與下一步連結

#### Scenario: 有可用輸入

- **GIVEN** 存在 ifc-ready job
- **WHEN** 開啟 `#a4`
- **THEN** 頁首 SHALL 顯示可用輸入數與來源；空表原因段落 SHALL NOT 出現

#### Scenario: pinned digest 不變

- **GIVEN** 實作 A4 頁首說明後
- **WHEN** 執行 `pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`
- **THEN** `workspace.a4.default` digest SHALL 與 main 相同

### Requirement: UI task 勾選證據 SHALL 來自 canonical-linux 部署，且 SHALL 通過公開 repo 隱私邊界

本 change 所有 UI 相關 task 的勾選證據 SHALL 來自 canonical-linux 部署後經 `:8004/ui` 的截圖，並附同分鐘抓取的對應 API JSON 對照；本機通過 SHALL NOT 作為勾選依據（對齊 `rvt-ifc-usdc-lineage` tasks 9.1 之 2026-08-25 owner 裁決）。證據入 public repo 前 SHALL 去識別化：檔名與內容 SHALL NOT 含 LAN IP、主機名或 bucket 真實 key，且 SHALL 通過 `scripts/verification-manifest.json` 的 secret-pattern-scan gate。因 canonical-linux 部署發生於 merge 之後，本 PR SHALL 在 §1–§3 未勾選狀態下合併，archive SHALL 以 181 驗收完成為前置條件。

#### Scenario: 勾選附 canonical-linux 證據

- **GIVEN** 某 UI task 本機測試綠
- **WHEN** 準備勾選
- **THEN** SHALL 附 canonical-linux 截圖與 API JSON（去識別化）之 digest 或路徑；否則 SHALL 維持未勾並註記「本機綠，待 181」

#### Scenario: 部署 HEAD 對應

- **GIVEN** canonical-linux 已部署
- **WHEN** 抓證據
- **THEN** SHALL 記錄部署 tag（`deploy-*`）指向的 squash SHA 為本 change merge 後的 SHA；其他 commit 的證據 SHALL NOT 接受

#### Scenario: 證據通過隱私掃描

- **GIVEN** 證據檔準備入檔
- **WHEN** 執行 secret-pattern-scan gate
- **THEN** SHALL 通過，且檔名／JSON 內 SHALL NOT 含 LAN IP、主機名、bucket 真實 key

### Requirement: 真值面 SHALL 與設計閘相容，SHALL NOT 覆寫 pinned 快照，機制變更 SHALL 登記 bootstrap

本 change SHALL 依 D1 owner 裁決擇一：(P) 以產品面在 design gate 環境（`/api/**` 503 stub）下的誠實 offline／empty 狀態作為 golden，僅經 owner 明示後以 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline` 寫入；依既有腳本粒度，SHALL 只重拍非 `canonical_product_surface` 屏且 `workspace.a4.default` digest 不變（對齊 `console-design-token-authority` canonical 措辭）；或 (H) 加入僅 design gate 可啟用、production 不可達的 design-preview harness。兩者皆 SHALL NOT 覆寫 `workspace.a4.default` pinned digest；semantic cases（`web-viewer-sample/e2e/design-system-semantic-cases.ts`）SHALL 改斷言誠實狀態，且因 gate 要求 `implemented_case_ids` 與 `required_case_ids` 全等並對每屏執行，變更範圍 SHALL 以全屏規模評估；對 `web-viewer-sample/e2e/**` 或 `web-viewer-sample/scripts/capture-design-system-reference.mjs` 的修改屬驗證機制本身，SHALL 依 `docs/agents/self-referential-bootstrap.md` §2.1 登記且 `verification_mechanism_paths` ⊆ 本 PR changed paths；需改 canon（`docs/plans/*.dc.html`、`docs/plans/*.md`、`docs/plans/ai-bim-governance.css`）者 SHALL 依 `design-canon-change-control` R-A1 以提案 PR 送 owner 核准，spec-to-done 於該點 HELD；出證據前工作樹 SHALL 乾淨；PR body `Design gate status` SHALL 逐字等於機器算出值。

#### Scenario: D1=P rebaseline

- **GIVEN** owner 裁決 P 並明示核准
- **WHEN** 執行 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`
- **THEN** 非 `canonical_product_surface` 屏 SHALL 重拍；`workspace.a4.default` digest SHALL 不變；`pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin` SHALL 通過

#### Scenario: D1=H preview harness

- **GIVEN** owner 裁決 H
- **WHEN** 以 design gate 環境（`/api/**` 503 stub）執行 capture
- **THEN** gate SHALL 捕捉 preview 態且 pixel parity 維持；production bundle 測試 SHALL 證明 preview 不可達；capture 機制變更 SHALL 登記於 bootstrap ledger

#### Scenario: canon 需改時 HELD

- **GIVEN** 任一 task 需改 `docs/plans/*.dc.html`、`docs/plans/*.md` 或 `docs/plans/ai-bim-governance.css`
- **WHEN** 進入該 task
- **THEN** SHALL 只建立提案 PR，SHALL NOT 直接編輯；state SHALL 記為 HELD 直到 owner 核准

#### Scenario: 設計閘不誤判 live surface

- **GIVEN** design gate 環境 `/api/**` 為 503
- **WHEN** 渲染 home／pipeline／ops／workspace.a1–a3
- **THEN** SHALL NOT 出現 `video`／`iframe[src*='/ui/open']`（handoff 為 anchor 且無 session 時不渲染）
