> **Status: active**
>
> **Priority: P0（產品可信度）** — 使用者於 2026-08-25 明確口令開立；依 `docs/plans/NOW.md` 優先序「使用者最新口令 > 本檔」覆寫「本週不做：新 OpenSpec」，例外已於 NOW.md 揭露。
>
> **Owner 裁決前置**：tasks §0 六個裁決點（D1 設計閘、D2 授權、D3 dev routes、D4 align thaw 判定、canon 入口、A4 放置）未裁決前，對應段落一律 HELD；本 change 允許在 §1–§4 先行實作，§5 之後不得動工。

## Why

### 症狀（2026-08-25，canonical-linux 部署區 `:8004/ui`，使用者回饋）

operator 打開預設入口看到的是設計原型的 fixture，不是系統真況：

- `#home` 總覽 KPI 為假數字（轉檔中 1／活躍 Sessions 1／未結 Issue 12／Outbox 待送 2，日期 `2026-07-14`）。
- `#a1` 3D 工作區是靜態 JPEG 加上捏造的 `Streaming · 28 ms · 60 FPS`，按鈕點了沒有後端效果。
- `#a2`／`#a3` dock 的「計算差異」「Build Federated USD」只改 local state 並跳出假成功 toast（`POST /api/diffs → 202`），側欄卻標 `LIVE`。
- `#pipeline` 看不到 rvt↔ifc↔usdc 轉檔／治理／報表真況：資料是 fixture、按鈕是 fixture、無法觸發轉檔。
- `#runtime` 的 `GPU 0 82%`／`GPU 1 24%`／`VRAM 14.6/24 GB`／structLog 全為固定值，按鈕沒反應。
- `#a4` 看不懂用途（頁面自標 `asbuilt · PARTIAL`，但沒有說明為何空表）。

同分鐘 API 真值：`ifc-ready` 0、review session 0、`issues []`、`rule-runs` 0、callback outbox 36 筆全 `pending`（attempts 0/5）、`kit_local_001` idle、GPU 遙測未取得、`files/tree projects []`、MinIO bucket `bim-control` 7 個資料夾（3 個含 source IFC）、minio-watch enabled（baseline 12／seen 12／triggered 0）、conversion ledger 12 筆 `ready`（2026-08-12）。

### 已查證程式事實

1. 預設殼層 UnifiedConsole 是 1:1 移植設計原型的 fixture：`web-viewer-sample/src/console/unified/fixtures.ts:2-5` 自述「不打任何 /api」；`HomePage.tsx:48-52`、`PipelinePage.tsx`、`OpsPage.tsx`（檔頭自承「GPU/Kit 固定值照原型抄寫」）；`fixtures.ts:156-165` 把 A1–A4 badge 寫死 `LIVE`；`UnifiedShell.tsx:143` 頂列 `GPU/Stream 82%` 寫死；`unified/docks.tsx:168,191,223,229` 的 A2/A3 CTA 以 local state 模擬成功 toast。
2. 真頁（Edge Console，標 `asbuilt MVP · 無假數字`）只藏在 dock 右上「完整工具 ↗」（`unified/docks.tsx:63-66`，僅 `/health` 探活成功才顯示）：`#a1-workbench`、`#version-diff`、`#federation`、`#conv`、`#issues`、`#minio`、`#sessions`、`#gpu`、`#instances`、`#viewer`、`#reports`、`#instruction`。唯一真 dock 是 `#workspace?dock=a4`（`EdgeConsole.tsx:172`）。
3. 轉檔觸發：`#minio` 頁已有「觸發轉檔」鈕（`modelData/GlobalConversionPane.tsx:326-338` → `POST /api/conversion/trigger`），但 canonical-linux 從 LAN 瀏覽器實測回 403 `caller ip not in allowlist`（`bim-review-coordinator/src/config.ts:467-470` 預設 `127.0.0.1`／`::1`／`172.16.0.0/12`；compose 未透傳該 env）。同一 IP 守門 `rejectIfIpNotAllowed`（`app.ts:1601`）也守 prioritize／retry／watch（`app.ts:1616,1642,1678,1728`）並經 deps 注入守 lineage source-bundle 路由（`routes/lineageSourceBundleRoutes.ts:521`）。`#conv` 只 prioritize／retry；A1 workbench 明標「A1 不排入轉檔」；MinIO watcher 只對 ledger 無紀錄的物件觸發（既有 12 筆已有紀錄）。`POST /api/dev/conversions` 在 canonical-linux 零防線（`ENABLE_DEV_ROUTES` 未透傳，`app.ts:4524-4526` 預設開啟）——屬安全發現，本 change 以 D3 納入前置條件而非開放它。RVT→IFC 已於 PR #63 退役（`worker-rvt-ifc-bridge` canonical 標 removed）；lineage governed bundle 只驗證 `source_rvt`＋`source_ifc`、不轉 RVT。
4. 部署真相：canonical-linux 部署 tag `deploy-20260825-…-001` 指向 `233bb3d`（PR #691）；`/ui` 每次 canonical 部署都在 Docker build 內重跑 `build:ui`；HEAD `7e94fb0` 只多一個不影響 UI 的 commit。落差不是部署過期，是程式本身如此。

### 根因（三層，缺一不可）

**主因＝OpenSpec 有開，但 agent 的執行與使用者期望有巨大落差。**

- `migrate-console-to-hifi-design`（archived 2026-08-20，40/40）以 pixel parity 為 done；`proposal.md:31`、`design.md:28-29` 明文不碰資料真實性——交付的是「像設計圖」，不是「顯示真況」。其 task 7.4 以 `deferred-this-change` 把「8 條 STALE 措辭 → spec-alignment successor」留給未來。
- `converge-console-specs-to-shipped-behavior`（archived 2026-08-19，12/12）把 canonical spec 措辭「收斂」成承認現況是 fixture：`openspec/specs/unified-governance-console/spec.md:275,281`「dock 互動為 fixture 語意…SHALL 誠實標示為 fixture 語意」；`openspec/specs/edge-console-operator-frontend/spec.md:217,233-238`「`#runtime` 現由 fixture OpsPage 承接…與誠實義務牴觸，SHALL 以 known gap 記錄並另行修復」。「另行修復」從未開 change——spec 被改成替現況背書。

**次因＝有開但未執行。** 真資料接線／真 session／UI 觸發轉檔散在 deferred 或低進度 change：`align-frontend-design-system-reference` 0/23（frozen-historical）；`introduce-viewer-app-integration-surface` 4/33（deferred；唯一寫到「取代 fixture 假 toast」的是其 5.2）；`add-single-gpu-session-ai-review-mvp` 1/49（deferred）；`gpu-session-baseline-and-idle-reclaim` 1/6（active）；`rvt-ifc-usdc-lineage` 8.2–8.5、9.x 未勾（lineage 五個 UI surface 依其 8.3 維持 `reference_missing`）。

**補因＝沒開。** 沒有任何 change 要求 `/ui` 預設入口在 canonical-linux 上必須是真值面；沒有 change 定義 canonical-linux 上由 UI 觸發「既有 MinIO 物件」轉檔的授權；沒有 change 把 canonical-linux 的 dev routes 關閉納入部署前置。

**canonical 誠實條款早已存在且正被違反：** `unified-governance-console/spec.md:94-114`（SHALL NOT 顯示捏造數值；待建能力 SHALL 標 `p1`／`p15` 並 `disabled`；SHALL NOT 呈現「點了沒反應」的可點假按鈕）、`:313-318`（Honest Evidence and Provenance）、`console-design-token-authority/spec.md:38-46`（視覺遷移 SHALL NOT 變更 provenance 誠實性）。本 change 不是新增誠實原則，而是把既有原則落到預設入口，並把被「收斂」掉的三條 canonical 措辭改回可執行的義務。

## What Changes

1. **預設入口真值化（R1、R2）**：`/ui`（無 hash）、`#home`、`#pipeline`、`#runtime` 與頂列 GPU chip 改綁 coordinator `:8004` 十個**既有**端點（盤點已確認皆存在，不新增聚合端點）；無遙測標「未取得」、後端不可達標「未連線」；`fixtures.ts` 的假資料 export 退出 production 顯示路徑（i18n／導覽／style helper 保留）；讀取經單一共用 poller。
2. **無假按鈕（R3）**：UnifiedConsole 每顆控制項三選一（`api`／`nav`／`disabled`＋prov＋原因）；移除 A2/A3 dock 的假成功 toast；badge 依 `data.ts` `A1A10.prov`（canonical 七值 `asbuilt`／`artifact`／`demo`／`p1`／`p15`／`p3`／`p4`）而非寫死 `LIVE`；導向後仍受 IP 守門的動作在 D2 未涵蓋時 `disabled` 附「需 allowlist 來源」。
3. **3D 工作區誠實（R4）**：無 session 顯示明標「no-GPU 示意／示範圖」的離線視區（`data-prov="demo"`）；有 review session 提供 `/ui/open?session=` 手動 handoff（anchor 新分頁，非 iframe）；不自動 claim；持久內嵌 viewport 留給 `introduce-viewer-app-integration-surface`。
4. **UI 觸發轉檔（R5）**：`#pipeline`／`#minio` 可對 `has_source_ifc` 物件觸發既有 intake 鏈並看到 job lineage；coordinator 以 **per-route wrapper** 為四條 conversion 控制路由提供 owner 於 D2 裁決的瀏覽器授權（建議 T4：沿用既有 Kit mutation dev token 機制作 operator token）；`rejectIfIpNotAllowed` 判定與 lineage 路由授權逐字不變；不擴大 `/api/external/*`、不走 `/api/dev/*`；RVT 段明標「外部產製／已退役」。
5. **canonical-linux 關閉 dev routes（D3，R5 前置）**：`ENABLE_DEV_ROUTES=false` 透傳到 canonical env（compose＋`.env.example` parity），否則 `POST /api/dev/conversions` 零防線會讓 R5 的授權形同虛設；受影響的 Edge Console 頁誠實顯示「dev routes 已關閉」。
6. **A4 可理解（R6）**：頁首說明用途／輸入來源／空表原因／下一步；不覆寫 `workspace.a4.default` pinned digest。
7. **設計閘相容（R8）**：依 D1 owner 裁決走 rebaseline（選項 P，建議）或 design-preview harness（選項 H）；semantic cases（`web-viewer-sample/e2e/design-system-semantic-cases.ts`）改斷言誠實狀態並以全屏規模評估；機制路徑（`web-viewer-sample/e2e/**`、`web-viewer-sample/scripts/capture-design-system-reference.mjs`）依 self-referential-bootstrap §2.1 登記；需改 canon 者依 R-A1 以提案 PR 送核。
8. **驗收＝canonical-linux（R7）**：UI task 勾選證據一律來自部署後 `:8004/ui` 截圖＋同分鐘 API JSON 對照，本機通過不得勾選；證據通過 secret-pattern-scan 並去識別化。

## Capabilities

- **ADDED**：`unified-console-runtime-truth`（R1–R8）
- **MODIFIED**：`unified-governance-console`
  - `### Requirement: Product Governance Console Shell`（canonical `:260`）：以 canonical 原文為底，附加 liveBackend 真值義務與新 scenario；既有義務（兩組導覽、SHALL NOT 宣稱五組導覽、SHALL NOT 宣稱 Chat USD 側欄、`/ui?session=` 不掛 console）逐字保留。
  - `### Requirement: A1-A10 Pages Preserve Prototype Intent`（canonical `:273`，ASCII hyphen）：以 canonical 原文為底，把「fixture 語意」限縮於 design-preview／離線態並附加 liveBackend 真值義務；既有義務（`WorkspacePage initialDock="a1"`、SHALL NOT 宣稱 upload/Excel、`A1DockLive` 僅 `/health` 成功時掛載）逐字保留。
- **MODIFIED**：`edge-console-operator-frontend`
  - `### Requirement: Coordinator/Intake/Runtime 頁 SHALL 只打 coordinator :8004 的真實端點，無遙測值 SHALL 標未取得`（canonical `:215`）：保留封閉端點清單與 outbox internal-token 條文，**附加**擴充後的允許端點清單（含 `/api/callback-outbox/summary` redacted 投影）與 `#runtime` 修復承接；三個 canonical scenario 名稱逐字保留並各自附加 AND 條文，新增一個 scenario。

**NoSuccessorWhilePredecessorOpen 自查（已修正）**：`scripts/tests/verify-openspec-lifecycle.ps1` 的 gate 只計 **non-deferred** owner。`unified-governance-console` 另有 `align-frontend-design-system-reference`（deferred，frozen-historical）的 delta，其 `## RENAMED Requirements` 把 `A1-A10 Pages Preserve Prototype Intent` 改名為 `A1–A10 頁面 SHALL 保留原型意圖` 並 MODIFY 同一條；`edge-console-operator-frontend` 另有 `a4-semantic-search-model-qa`（deferred）的 REMOVED＋ADDED delta，但其對象是 `:240` 的 A4–A10 vision requirement，與本 change 修改的 `:215` 不同條。依 `openspec/specs/console-design-token-authority/spec.md:50,60-64`「frozen deferred 不阻塞…其未完成 tasks 2.4–2.8 是 non-canonical delta，並非平行中的 gate owner」，本 change 以 canonical 現行標題（ASCII hyphen）MODIFY；**撞名處置**：本 change 先 archive；`align-frontend-design-system-reference` 若日後 thaw，其 RENAMED `FROM` 目標須改指本 change 落地後的 canonical 文字（其 delta 屬 non-canonical，不構成本 change 的 archive 阻礙）。本 change 不 MODIFY 任何 active change 擁有的 capability：不動 `rvt-ifc-usdc-lineage` 的 delta capabilities（`cloud-lineage-publication`、`conversion-attempt-publication`、`conversion-kit-lifecycle-recovery`、`conversion-runtime-admission`、`lineage-governance-console`、`local-artifact-shadow-metadata`、`local-coordinator-ifc-ready-intake-boundary`、`minio-model-version-bundle`、`minio-watch-auto-intake`、`rvt-ifc-usdc-lineage`、`streaming-ifc-usdc-conversion-authority`），不動 `gpu-session-baseline-and-idle-reclaim` 的（`gpu-session-baseline`、`session-lifecycle`），不動 `autonomous-linux-delivery` 的四個。

## Non-goals

- 不新增生產依賴；不引入新 3D 引擎；不改 viewer 主體（`/ui/open` 與 viewer app 內部不動）。
- 不動 lineage 後端契約（`/api/external/source-bundles/ready`、admission、publication 與 `lineageSourceBundleRoutes.ts` 授權皆不改）。
- 不做 A5–A10 全棧；A5–A10 維持 roadmap 占位但不得有假按鈕。
- 不開放 `/api/dev/*` 作為產品路徑；不新增「同 origin 即授權」的匿名寫入面（T1 只在 owner 明知其為 LAN 匿名觸發時才可採用）。
- 不承接持久內嵌 viewport（`introduce-viewer-app-integration-surface` 所有）；不承接 lineage 五個 UI surface（`rvt-ifc-usdc-lineage` 8.3–8.5 所有）。
- 不直接編輯 `docs/plans/*.dc.html`、`docs/plans/*.md`、`docs/plans/ai-bim-governance.css`（R-A1）；需改 canon 只提案。
- 不覆寫 `workspace.a4.default` pinned digest（`console-design-token-authority:48-58`）。
- 不修改共用 helper `rejectIfIpNotAllowed` 的判定。

## Impact

- 服務：`web-viewer-sample`（console unified／EdgeConsole／e2e semantic cases）、`bim-review-coordinator`（四條 conversion 控制路由的 per-route 授權 wrapper；D3 dev routes env）、`compose.runtime-manager.yml`／`.env.example`（D2=T2 或 D3 時 env 透傳與 parity）。
- 兩道 required evidence gate 必觸發：`design-semantic-visual`（`scripts/verification-manifest.json:423-436`）與 `functional-runtime-conv`（`:437-450`）。design gate 環境把 `**/api/**` stub 成 503（`web-viewer-sample/e2e/design-system-visual.spec.ts:199`），live surface（`video`、`iframe[src*='/ui/open']`）出現即 fail（`:300-304`；manifest `:178-179`），出證據前工作樹必須乾淨（`:187`）；`also_affects_reference_missing_routes: true`（manifest `:223`）使 PR body `Design gate status` 機器值為 `mixed`。
- 會斷的既有測試（tasks §5 逐一更新）：`web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx:54-67`（凍結「`#home` 不啟動 runtimeStatus 輪詢」）、`web-viewer-sample/src/console/unified/a1DockLive.test.tsx:100-104`（凍結「live 疊加時 fixture 區塊維持原樣」）、`web-viewer-sample/e2e/design-system-semantic-cases.ts`（`kpi-conv-val`／`kpi-outbox-val`／`svc-dot` 等 fixture 值斷言；gate 要求 `implemented_case_ids` 與 `required_case_ids` 全等且每屏執行，`design-system-visual.spec.ts:182-184,217`）、`web-viewer-sample/src/console/unified/unified.test.tsx`（KPI 標籤斷言）。
- golden 快照：home／pipeline／ops／workspace.a1–a3（D1=P 時由 owner 雙旗標 rebaseline；既有腳本無逐屏過濾，重拍範圍為非 `canonical_product_surface` 屏）；`workspace.a4.default` 不動。
- 驗證機制路徑（`web-viewer-sample/e2e/**`、`web-viewer-sample/scripts/capture-design-system-reference.mjs`）受 `docs/agents/self-referential-bootstrap.md` §2.1 約束：bootstrap ledger 的 `verification_mechanism_paths` 必須是本 PR changed paths 的子集。

## Risks

- **D1 未裁決即 HELD**：真值面與 pixel 設計閘的結構性衝突需 owner 裁決；這是刻意停點。
- **D4 可能否決 D1=P**：`align-frontend-design-system-reference/proposal.md:3` 寫「動前端 visual full gate 前再 thaw」；本 change 的 D1 兩選項都動 visual gate，owner 須裁定「先 thaw align」或「適用 `console-design-token-authority:60-64` carve-out」，未裁定前 §5 全段 HELD。
- **D2 安全框架**：同 origin token（T1）不是授權（`/ui` 無登入、token 對 LAN 任何 client 可取）；若採 T1 等同允許 LAN 匿名觸發，速率限制是唯一緩解。建議 T4（沿用既有 dev token）。
- **D3 副作用**：關閉 dev routes 後 `#demo-control` 與 A1 workbench 的 local_fs 清單在 canonical-linux 失效，需誠實顯示而非崩潰。
- **隱私邊界**：canonical-linux 證據入 public repo 前去識別化並通過 secret-pattern-scan。
- **MODIFIED 對照**：archive 前以「逐條義務 diff」（非只比標題與 scenario 名）對照 canonical，見 design §10。

## Acceptance 與流程順序

- 本 PR（spec-only）：`npx openspec validate unified-console-runtime-truth --strict` 通過；`node scripts/tests/verify-openspec-repository-lifecycle.mjs` 三源一致；WIP non-deferred active 由 3 增為 4（≤6）。
- 實作 PR：兩道 gate 通過；PR body `Design gate status` 逐字等於機器算出的 `mixed`；`pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin` 通過；§1–§3 的 UI task 在 merge 時**維持未勾**（因 canonical-linux 部署在 merge 之後）。
- 部署驗收：owner inventory 執行 `pwsh scripts/dev/rebuild-test-deploy.ps1` 後，`:8004/ui` 無 hash 即為真值 `#home`；症狀六頁逐一對照同分鐘 API JSON；LAN 瀏覽器依 D2 授權可觸發轉檔且看到 lineage；`POST /api/dev/conversions` 回 404（D3）。
- archive 前置：181 驗收完成、所有 task 勾選、design §10 義務對照完成。
