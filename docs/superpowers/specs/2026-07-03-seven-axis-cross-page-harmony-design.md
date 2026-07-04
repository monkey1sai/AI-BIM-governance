# 七軸跨頁和諧整合設計（A1 / CV / SS / KG / M / IN / RT）

> 日期：2026-07-03
> 類型：cross-page integration spec — 七條正典路由「跨頁和諧整合」（非單頁合併；使用者已明確裁定，不重議）
> Scope：`web-viewer-sample/src/console/` 七頁（`#a1` / `#conv` / `#sessions` / `#instances` / `#minio` / `#intake` / `#runtime`）＋既有 Review Room（`#gpu` 正典 / `#review` 別名）交握。**frontend-only、零新後端、零新路由表**。
> 狀態：ready for spec-to-done — 使用者已於 2026-07-03 明確指示 spec 完成後立刻執行 spec-to-done
> 承接：`docs/superpowers/specs/2026-07-02-a1-3d-review-decouple-design.md`（A1 3D 已移交 Review Room，commit `a334e49` / PR #286）——本 spec **原樣承接其結論，不重新裁決 3D 架構**，只補「SS / KG / RT 的 session、GPU、health 狀態如何餵進這個既有交握」。
> 效力定位：本 spec 服從 `docs/plans/docs-plans-README.md` §1 效力序與 §3 十一條鐵律；路由正典只引用《互動實作規格》A.1.1，不自建。

---

## 1. Problem（七軸現在為什麼「感覺不像一套系統」）

七條路由各自都已是誠實、可操作（或誠實標「待建」）的頁面，但彼此像七個孤島，缺一套「和諧」層：

1. **術語與 Prov 呈現不一致**：同一顆 `review_session_id` 在 `#sessions` 叫 session、在 `#conv` 叫 `review_session_id` 欄、在 IntakePage 也只是純文字欄、在 Review Room 是 handoff `session=`；同一份 runtime 真相（`GET /api/runtime/status`）被 `#sessions`、`#runtime` 各自呼叫、各自呈現，`#instances`（KG）卻完全沒接、只擺寫死 demo 表。使用者在頁間跳動時要重新在腦中對映，體感不像一套系統。
2. **跨頁只有兩條真連結**：全庫實測只有 `#a1 → #conv`（`a1-conv-link`, `pages.tsx:604`）與 `#a1 → #review`（`buildA1ReviewRoomHandoffHash`, `pages.tsx:693-702`）兩條真 UI 跳轉。其餘關係全是「說明性文字」或「隱性資料耦合」（例：KG demo 表寫 `running · S-270` 影射 SS 的 session 命名、`#conv` 註解提到 `#minio`/`#sessions` 但不可點）。一條完整業務動線（偵測→接收→轉檔→檢核→3D→回 issue）在 UI 上是斷的。
3. **單一真相沒有被「共享」**：`docs-plans-README` v1.3 明訂「四格證據以 `#sessions`／Runtime 監控為單一來源」，但目前沒有一個共享狀態層把這份真相端到每一頁；每頁自己 fetch、自己判讀 health，容易產生「這頁說 ok、那頁說待建」的不一致觀感。
4. **A1 3D 架構剛變更、文件落後（doc-lag）**：`a334e49` 已把 A1 內嵌 3D／highlight 整段移交 Review Room，A1 只發 handoff。但《對齊矩陣》§4.4/§4.5 與《互動規格》IX-A1-06/07/08、IX-SS-05 仍描述舊的「A1 自證四格證據 rail」方向，下一位讀者會誤判現況。SS/KG/RT 這三個「供應端」到底怎麼餵進新交握，尚無 spec 把它講清楚。

**本 spec 的目標**：用**加法**把七頁黏成一套系統——一套跨頁 handoff 慣例、一條共享狀態/證據列、一致的術語與 Prov 呈現、以及把 A1↔Review Room 既有交握延伸成七軸通用交握。**不重寫任何一頁的核心、不合併路由、不新增後端。**

---

## 2. Verified Current Evidence（逐軸，來自 dossier + 本輪重讀）

> 本節同時更正前一階段 recon 的多處事實性錯誤，避免 spec 建立在錯誤前提上（詳見文末逐項訂正紀錄）。

### A1（治理檢核，`#a1`，`prov:"asbuilt"`，built）
- 五步流程 built：選檔（雙來源 `GET /api/governance/files/tree` local_fs ＋ `GET /api/minio/objects` 真 MinIO）→ rule-run（`POST /api/governance/rule-runs`，輪詢）→ 記分板＋失敗構件（`.../failures?rule=`，懶載入分頁50）→ 失敗轉 Issue（`.../issues/from-rule-run/:runId`）→ 匯出（Excel `?fmt=excel`、BCF `GET /api/governance/bcf/export`）。
- **架構已變更（`a334e49` / PR #286）**：A1 不再 mount `EmbeddedViewer`（`pages.tsx` 全檔 import 清單已無此依賴）、不再 auto-claim lease、不再 auto-select session、不再自證四格證據；`pages.tsx:695` 改為 CTA 導向 `#review?source=a1`。3D／highlight ack 全部收斂到 Review Room（`ReviewSessionViewerPane.tsx`）。
- 誠實缺口：BCF 審查面板 assignee 欄 `render dashed`（`p1`，不給假控制）。IX-A1-06/07/08、IX-SS-05 文件落後於 `a334e49`（doc-lag，已重讀原文確認：IX-A1-06 現仍寫「v2 呈現方式改為 IX-A1-08 的 A1 連動橋 rail」）。

### CV（IFC→USD 轉檔排程，`#conv`，data.ts:67 badge P1/warn）
- **更正前一階段 recon 事實錯誤**：IX-CV-03（prioritize/retry）與 IX-CV-04（watch toggle）**已 built，非待建**——互動規格文字仍寫「待建 endpoint」，但 `coordinatorClient.ts:427-432` 有 `conversionPrioritize`/`conversionRetry`/`conversionWatchToggle`，`bim-review-coordinator/src/app.ts:801`（prioritize）/`:839`（retry）/`:884`（watch）皆為真路由；`pages.tsx` `ConversionSchedulingPage`（826-1281）有完整 intent→confirm→audited 狀態機、成功後 `load()` 重抓真佇列（證據型更新，非樂觀）。
- 真缺口都在**前端呈現層**，非後端：轉檔歷史頁未渲染（後端 proxy 已存在——精確位置是 `bim-review-coordinator/src/app.ts:2330`(`GET /api/dev/conversions`)／`:2326`(`POST`)；coordinatorClient.ts 目前**沒有**對應的 client wrapper，需新增）；coverage 三項拆分未提供（`prov="p1"`）；concurrency 控制標 `NOT BUILT`；`conv-coverage=1` 自我參照已用 `data-testid="conv-coverage-selfref-note"` 誠實標注（`pages.tsx:804`）。

### SS（Session 管理，`#sessions`，plane=governance）
- `SessionManagementPage`（`pages.tsx:1282-1382`）掛載時 fetch 一次 `GET /api/runtime/status` + 手動 Refresh 按鈕（`data-testid="sessions-refresh"`）；per-row「結束 session」built（`POST /api/review-sessions/:sessionId/close`，IX-SS-04）。Reclaim stale / Force release 按鈕 `disabled`（`p1`，等 IX-SS-02 心跳遙測，誠實不給假按鈕）。
- **更正前一階段 recon 事實錯誤**：互動規格 IX-SS-01 文字寫「`GET /api/runtime/status` 5000ms」，但 repo **目前沒有任何一頁**真的做到這個節奏——逐檔核實 `SessionManagementPage`、`CoordinatorPage`（`#runtime`）、`coordinator/RuntimeGovernanceTabs.tsx` 三處全都只在掛載時 fetch 一次；`pages.tsx` 全檔僅有的兩個 `setInterval`（288 行、489 行）都位於 A1 自己對單一轉檔工單的輪詢，與 session/runtime 清單完全無關。現況精確描述是「兩頁各自掛載抓一次＋各自手動 Refresh」，**不是**「兩頁各自 5s 輪詢造成重工」；這條 5000ms 節奏規格自寫下後從未真正落地，見 §5.1。
- IX-SS-05「A1 連動橋供應端面板」寫於 07-02，隔天 `a334e49` 改走 handoff，該面板在 `SessionManagementPage` 從未落地（grep 確認無「連動橋」UI）。其架構意圖（session lifecycle 證據單一來源）**仍有效**，但落點應重新定義（見 §5、§6）。

### KG（Kit / GPU 機隊，`#instances`，group=coordinator，plane=omniverse）
- **更正前一階段 recon 事實錯誤**：`KitGpuFleetPage`（`pages.tsx:1384-1406`）**沒有任何 fetch/useEffect**，是 100% 靜態頁。IX-KG-01 的「`GET /api/runtime/status` 輪詢」**只存在於規格文字本身**（互動規格原文亦承認「未來接 kit-manager-api；現為示範資料」），KG 頁目前完全沒有接任何真資料。
- 兩 Panel：Fleet model（規則語意，`prov="asbuilt"`：1 GPU=1 stream、drain 不接新 session、move=terminate+recreate 30-40s）；Node snapshot（`prov="demo"`：edge-gpu-01/02/03 三列寫死）。IX-KG-02/03/04 三個 fleet intent 端點全庫 grep 只在 docs，原始碼無路由——全待建屬實。

### M（MinIO 資料，`#minio`）
- **更正前一階段 recon 措辭**：現況是**真 MinIO S3 delimiter 逐層瀏覽**（`GET /api/minio/objects?prefix=&delimiter=/`），非舊版三層攤平樹（`buildMinioTree` 已退役）。`MinioDataPage`（`pages.tsx:1469+`）另掛 SSE `/api/minio/events`（`new EventSource(...)`，`pages.tsx:1520`，真實接線非佔位）、每 `.ifc` 讀 `getConversionRecords()` 算 ledger chip（7 態）＋一鍵 `POST /api/conversion/trigger`。
- 「專案/種類/版本」三層只是 watcher `deriveIntakeFromKey` 解析語意，非 bucket 結構宣稱；bucket layout panel 仍 `prov="demo"`。IX-A1-01 選檔吃同一顆 `GET /api/minio/objects`（過濾 `role=source_ifc`），與 M 軸共用端點但各自獨立呼叫。live 多層 watcher 觸發 `not observed`。

### IN（建模接收與轉換，`#intake`，data.ts:75）
- **定位**：`intake` 是《對齊矩陣》§「保留別名（不列入 22 條主表，不得砍斷）」明列的**保留別名（deep-link alias）**，掛真元件 `IntakePage`（`pages.tsx:2869-2920`），非 A.1.1 22 條 canonical route（互動規格 A.1.1 表格 22 行本身確實不含 `intake`）。
- `IntakePage` 唯讀：`GET /api/external/ifc-ready?limit=` 拉 job（`prov="asbuilt"`）；下方品質/mapping Panel `prov="artifact"`（pass-through），GUID 精準對映 `demo`、秒數/GPU「未取得」、manual mapping correction UI `p15`。排程操作 UI 實際落在 `#conv`（同 `GET /api/external/ifc-ready` 資料源）。`OperatorConsole.tsx`/`IntakeSelectPage` 是同名死碼分支（repo 內僅被各自 `.test.tsx` 與 `main.tsx`/`routing.ts` 的舊入口引用，`EdgeConsole.tsx` 的 hash-route switch 不掛它們），非現行路由，勿誤動。

### RT（Runtime 觀測值班台，`#runtime`，plane=omniverse，group=system）
- **更正前一階段 recon 判斷**：`EdgeConsole.tsx:81` `case "runtime"` → `CoordinatorPage` 四分頁（Classic Dashboard / ATC Tower / Lifecycle Flow / Terminal·Debug）**是已拍板設計（D2-A′，spec `2026-06-24-co-console-runtime-merge-design.md`），非 bug**。`RuntimePage`（`pages.tsx:2925`）保留供 test＋`StreamConfigReader.tsx` 共用，EdgeConsole 不直接路由到它（刻意技術債，spec 有記錄）。`CoordinatorPage` 同樣只在掛載時 fetch 一次（理由同 SS 節），非輪詢。
- 唯一端點 `GET /api/runtime/status`（`coordinatorClient.runtimeStatus()`），與 CoordinatorPage/RuntimePage 共用；`data.ts:145` `prov="asbuilt"`（已核實逐字：`{ m: "GET", path: "/api/runtime/status", prov: "asbuilt", ... }`）。GPU/轉換秒數仍誠實標「未取得」demo-prov，非全量真遙測。

**共同事實**：七軸所有端點都在**凍結後端檔**之後（coordinator `src/app.ts`、`src/routes/governanceProxy.ts`、governance-service `app.py` 等，見 §3-N4）。因此本整合的每一步都必須是前端加法，**不得**改後端、不得新增後端路由。

---

## 3. Non-Negotiables

> 前七條為使用者/README 硬性限制，違反 = 做錯必 revert；後三條為本 spec 自訂的誠實與加法紀律。

1. **N1 — 不得單頁合併**：七條路由維持七個實體頁面。`docs-plans-README` §3 鐵律#2「Route contract 唯一正典」——本 spec 不自建路由表，只引用《互動規格》A.1.1；`hash` 無斜線（`#a1` 非 `#/a1`）；`#gpu` 正典、`#review` 別名；deep-link aliases（含 `intake`/`review`）保留不砍。
2. **N2 — 不得新增 backend service / route**：一律重用 dossier 已列端點。無新 daemon、無新 proxy 路徑、無新 REST route。
3. **N3 — 不得重裁 A1 3D 架構**：原樣承接 `2026-07-02-a1-3d-review-decouple-design.md`——3D 只在 `#review`/`#gpu`，A1 只交握 `rule_run_id`/`review_session_id`/`ifc_guid`/`usd_prim_path`/`rule_code`，不 mount `EmbeddedViewer`、不在 mount 時 claim lease、不 auto-select session、lease token 不進 URL。
4. **N4 — 不得改凍結後端檔**（《前端對齊DS手冊》§1 clause 12 逐字）：governance-service `app.py`/`diff_engine/api.py`/`federation/api.py`/`issues/api.py`/`bcf/api.py`/`file_library/api.py`、coordinator `src/app.ts`/`src/routes/governanceProxy.ts`、streaming `conversion_authority.py`。**注意**：coordinator `src/app.ts` 在凍結清單內，而 SS/CV/M/IN/RT 幾乎所有端點都由它實作——故本整合絕不觸碰任何路由本體，只在 `web-viewer-sample/src/console/` 前端做加法。前端只能打 coordinator `127.0.0.1:8004`，禁新增對 `:49102`/`:49101`/`:8010` 的直連。
5. **N5 — Prov 誠實（README §3 鐵律#3）**：未做功能一律標「待建」，不給假按鈕；無遙測標「未取得」不畫 fail/綠燈。repo `Prov` 型別**僅 7 值**（已核實 `data.ts:6`：`asbuilt`/`artifact`/`demo`/`p1`/`p15`/`p3`/`p4`），**無 `todo`**（`prov="todo"` 會 TS2322）。
6. **N6 — 加法式整合**：只做跨頁 handoff 契約、共享狀態/證據列、一致術語與 Prov、A1↔Review Room 交握延伸；**不新開 7 個子系統**、不重寫任一頁核心閉環。刪碼拿到同結果視為 win（如清理死碼分支僅在確認不誤動 legacy shell 時進行）。
7. **N7 — user-facing 一律要 browser evidence**：任何可從前端操作的整合行為必須有 gstack/Playwright evidence（截圖＋trace 落 `artifacts/e2e/`），backend-only done 不接受。
8. **N8 — 官方能力邊界**：GPU 容量以官方 **1 GPU = 1 stream** 鐵律為準（N 個 GPU node = N 個並行 stream 上限；spectator 共看同一 frame 不另吃 GPU；session 換 GPU = terminate+recreate，無 live migration——此為 repo 既有 `docs-plans-README.md` §3 鐵律#4 已定案事實，本 spec 原樣沿用不重驗）。health 語意須分「容器/process 存活」與「stream 就緒」，**本輪已用 WebSearch 覆核官方文件**：`/v1/streaming/startup` 是容器 startup 檢查，設計上「無論串流服務是否就緒都應成功」（即恆 200、只驗容器活）；`/v1/streaming/ready` 才檢查 application/RTX 是否真正就緒（官方出處：`docs.omniverse.nvidia.com/ovas/latest/configuration/streaming-probes.html`）——但**前端不直打 Kit**，此語意由 `GET /api/runtime/status` 經 coordinator 呈現，缺欄位標「未取得」。
9. **N9 — 不依賴未成熟外部能力**：官方 IfcOpenShell USD serializer 仍屬 early-stage（0.8.5 無 GlobalId→prim 規範），故自製 coverage/self-ref 機制不退場；MinIO 官方建議 watch 走 Bucket Notifications 而非輪詢，但那是**新增基礎設施面**，本 spec 不強制導入，維持既有 watcher（`not observed` 誠實標記不變）。
10. **N10 — 跨頁狀態不引入新 production dependency**：共享狀態層用 React 內建 Context（同一 SPA 內），**禁用** BroadcastChannel/localStorage/Zustand/Redux（見 §5 論證）。

---

## 4. Cross-Page Handoff Contract（把 A1→Review Room 既有 pattern 推廣成七軸通用慣例）

`a334e49` 已在 A1→Review Room 落地一套可複用慣例：**URL hash query 帶非機密 ID、不帶 lease token、接收端用 ID 向權威端點重驗**。**更正**：實際函式名稱與草稿初版原引用的不同——建構端是 `buildA1ReviewRoomHandoffHash`（`pages.tsx:232`，A1 專用、硬編 `source:"a1"`），解析端是 `parseReviewRoomHandoff` + `ReviewRoomHandoff` 型別（`ReviewSessionViewerPane.tsx:31`，camelCase 欄位：`sessionId`/`ruleRunId`/`ifcGuid`/`usdPrimPath`/`ruleCode`/`severity`/`label`/`expectedStageUrl`）——兩者分屬不同檔案，並非同名共用 pair（原始計畫 `docs/superpowers/plans/2026-07-02-a1-3d-review-decouple.md` Task 2/3 草稿曾提議命名為 `buildReviewRoomHandoff`，實作時改名為 `buildA1ReviewRoomHandoffHash`，型別欄位也比草稿更豐富）。

本 spec 把這套 pattern 抽成七軸通用契約，落在一支共用 util（`web-viewer-sample/src/console/handoff.ts`，新檔，純前端）。新型別 `CrossAxisHandoff`（見下）刻意採 **snake_case** 貼齊 URL 參數名，與既有 `ReviewRoomHandoff` 的 **camelCase** 命名風格不同；收斂時 Review Room 呼叫端需要一層轉接（或直接把 `ReviewSessionViewerPane` 的 handoff prop 型別換成 `CrossAxisHandoff`）——這是 §11 要落實的具體整合點，不能假設兩型別互通。

### 4.1 通用 payload（非機密關聯 ID）

```ts
type AxisKey = "a1" | "conv" | "sessions" | "instances" | "minio" | "intake" | "runtime";

interface CrossAxisHandoff {
  source: AxisKey;            // 必填：發起軸，接收端據此決定 UI 脈絡（如 Review Room 的 hasA1Handoff）
  // 以下皆為非機密關聯 ID，選填，接收端逐一向權威端點重驗後才使用：
  session?: string;          // review_session_id，格式 ^(lwv_|review_session_)[A-Za-z0-9_]+$
  rule_run_id?: string;      // governance rule-run
  ifc_guid?: string;         // 構件 GlobalId（BCF/governance 永存主鍵）
  usd_prim_path?: string;    // 已映射 prim；缺時接收端須誠實 disabled，禁假 highlight
  rule_code?: string;        // 失敗規則碼
  job_id?: string;           // ifc-ready / conversion job id
  conversion_id?: string;    // ConversionLedger 紀錄 id
  minio_key?: string;        // MinIO 物件 key（含中文須 encodeURIComponent）
  prefix?: string;           // MinIO 資料夾 prefix
}
```

### 4.2 傳輸與威脅模型（對齊 OWASP + 既有 spectator 模式）

- **傳輸**：僅 URL hash query，寫在目標路由後（例：`#review?source=a1&rule_run_id=rr_x&session=review_session_y&ifc_guid=g_z`）。沿用 repo 既有 `kitInstanceId`/`streamRole` 心智模型（memory `webrtc-multi-viewer-spectator-verify`）。
- **禁止入 URL**：viewer lease token、`x-dev-token`、任何 auth header、任何機密。lease 一律由接收端在**使用者明確 intent 後**經 coordinator claim/refresh（承接 N3）。
- **接收端重驗鐵律（OWASP Session Management）**：「持有 ID ≠ 已授權」。接收頁必須用 ID 向權威端點查（如 `session` → `GET /api/runtime/status` 或 `GET /api/review-sessions/:sessionId/viewer-leases/status`（`bim-review-coordinator/src/app.ts:1265`，已核實真實存在）；`rule_run_id` → `GET /api/governance/rule-runs/:id`（`governanceProxy.ts:198`，已核實）；`job_id` → `GET /api/external/ifc-ready/:jobId`（`app.ts:1725`，已核實）），查不到就顯示誠實 `not found` + 手動重選，**禁止**靜默 fallback 到 `act[0]`（承接 decouple spec Adversarial Check）。
- **中文 key**：`minio_key`/`prefix` 產生時 `encodeURIComponent`，接收端 decode；須以既有真中文 key 做一次 round-trip 驗證（見 §14 OQ4、§11 建議的 Task 0 spike）。

### 4.3 七軸 handoff 矩陣（發起→接收，全部新增為加法 chip，除標「既有」）

| From → To | 目標 hash（帶 source） | 帶的 ID | 現況 |
|---|---|---|---|
| A1 → Review Room | `#review?source=a1` | rule_run_id, session?, ifc_guid?, usd_prim_path?, rule_code? | **既有**（`a334e49`） |
| A1 → CV | `#conv?source=a1` | job_id?/conversion_id? | **既有連結**（`a1-conv-link`），補帶 source/id |
| A1 → M | `#minio?source=a1&minio_key=`（as-built） | minio_key（實際發送）／prefix（保留欄位） | 新增 chip（回看選檔來源）；見表下註 A1→M |
| M → CV | `#conv?source=minio&minio_key=` | minio_key, conversion_id? | 新增 chip（該物件的轉檔） |
| M → A1 | `#a1?source=minio&minio_key=` | minio_key | 新增 chip（拿此檔去檢核） |
| IN → CV | `#conv?source=intake&job_id=` | job_id | 新增 chip（排該 job） |
| IN → Review Room | `#review?source=intake&session=` | session | 新增 chip（該 job 的 session） |
| CV → M | `#minio?source=conv&minio_key=` | minio_key | 新增 chip（來源物件） |
| CV → SS / Review Room | `#sessions?source=conv&session=` / `#review?source=conv&session=` | session | 新增 chip |
| SS → Review Room | `#review?source=sessions&session=` | session | 新增 chip（在 Review Room 開此 session） |
| SS → KG | `#instances?source=sessions&session=` | session | 新增 chip（該 session 落在哪個 GPU node；KG 側標「未取得」直到遙測落地） |
| RT → SS / Review Room / KG | `#sessions` / `#review` / `#instances`（帶 session） | session | 新增 chip |

> 所有 chip 一律**證據型**：目標 ID 存在才 enabled，否則 disabled ＋ 誠實原因（承接 §4.2）。不製造無效跳轉。

> **既知差異（A1→M，as-built）**：本表原範例 hash 寫 `#minio?source=a1&prefix=`，但出貨的「MinIO 來源 →」chip（`pages.tsx` `a1-link-minio`）實際發送 **`minio_key`**，非 `prefix`。理由：`minio_key` 指向**確切檔案**，M 端可對該檔做 key-level 重驗（`folder.objects.some(o.key===minio_key)`），比 `prefix` 的 folder-level 重驗（僅驗資料夾非空）**更精確**，且更貼合 chip 文案「回看 MinIO 來源**物件**」。`minio_key` 本就列於 §4.1 型別與本表「帶的 ID」欄，故為合規選擇；漂移僅在範例 hash 字面。`prefix` 為**保留欄位**：M 端 `MinioDataPage` 仍保留 `prefix` 收件／導覽分支與其單元測試（`incomingHandoff.test.tsx`「navigates to an incoming prefix」），供未來「純資料夾回看」按鈕使用，目前無真實按鈕發送。此為文件化的既知差異，非功能性 bug（`minio_key` 一樣正確導覽到對的資料夾）。

---

## 5. Shared Status / Evidence Rail（跨頁共用狀態列）

回應 `docs-plans-README` v1.3「四格證據以 `#sessions`／Runtime 監控為單一來源」：本 spec 把這句話落成一條**掛在 EdgeConsole 頂層、每頁都看得到的共享狀態列**，其單一資料源就是 `GET /api/runtime/status`。

### 5.1 關鍵架構決策：同一 SPA，用 Context，不用跨分頁機制

七條路由都是 **EdgeConsole 內的 hash route，活在同一個 JS context**（`EdgeConsole.tsx` 用 `usePageHash()` 純 hash 切換，無 iframe、無獨立 bundle reload），此時「跨頁同步」問題不成立——用 React Context/Provider 即可，**不需要** BroadcastChannel/localStorage/Zustand（那是「整頁刷新的多獨立 bundle」才需要的，本 repo 不是）。強行引入 = 過度設計 + 違反「不新增 production dependency」。故：

- EdgeConsole 頂層 mount 一個 `<SharedStatusProvider>`，**只輪詢一次** `GET /api/runtime/status`（採 IX-SS-01/IX-KG-01 規格寫定的 5000ms 節奏），把快照經 Context 分給每頁與狀態列。
- **重要更正**：目前 repo **沒有**「`#sessions`、`#runtime` 各自輪詢同一端點」的重工可消除——實測 `SessionManagementPage`／`CoordinatorPage`／`RuntimeGovernanceTabs.tsx` 三處都只在掛載時 fetch 一次，全靠使用者按 Refresh 才更新（見 §2 SS/RT 節）。`SharedStatusProvider` 是 repo 第一個真正落地 5000ms 自動輪詢的地方，一次到位同時補上 IX-SS-01 與 IX-KG-01 兩張互動卡片一直沒兌現的節奏承諾，而不是「把兩份輪詢合併成一份」。
- `#instances`(KG) 從「完全沒接」升級為「讀同一 Context 的真 session 聚合」（但 GPU per-node 遙測仍標「未取得」，見 5.4）。
- 跨 document 的 viewer（coordinator `/ui/open?session=` → :5173）不在本列範圍，維持既有凍結 handoff path。

### 5.2 資料契約（Provider snapshot）

```ts
// 命名警告：coordinatorClient.ts 已 export 一個同名但欄位不同的 RuntimeSessionSummary
// （session_id/status/project_id/model_version_id/participant_count/expected_stage_url/
// expected_mapping_url?/conversion_status/kit_instance_ids/created_at，見 coordinatorClient.ts:109）。
// 本層是給 UI 用的精簡摘要視圖，刻意另外命名為 SharedSessionEntry，避免跟後端原始型別撞名、
// 避免實作時把 participant_count 誤讀/誤寫成 participants。
interface SharedSessionEntry {
  session_id: string;
  status: string;                 // 逐字 echo RuntimeSessionSummary.status，禁自創
  participants?: number;          // 映射自 RuntimeSessionSummary.participant_count
  conversion?: string | null;     // 映射自 RuntimeSessionSummary.conversion_status
  // null → 「未取得」。GET /api/runtime/status 的 RuntimeSessionSummary 本身不含 stage 比對欄位；
  // 真正算好的 stage_match 其實在 GET /api/review-sessions/:id/viewer-leases/status 回應的
  // ViewerLeaseSummary.stage_match（coordinatorClient.ts:154，後端已算好）。Provider 為了維持
  // 「一次 poll、不對每個 session 多發請求」的簡單設計，刻意不追這支 per-session 端點，故此欄位
  // 在共享狀態列**設計上恆為 null**——這是刻意的簡化取捨，不是資料缺口；使用者實際進入 Review
  // Room attach 該 session 時，會看到 ReviewSessionViewerPane 自己算出的真 stage 證據（不受此限）。
  stage_matched?: boolean | null;
}

interface SharedStatusSnapshot {
  activeSessions: number;                        // asbuilt（來自 runtime status）
  sessionsById: Record<string, SharedSessionEntry>; // asbuilt，由 RuntimeStatus.sessions.items 映射而來
  gpuNodesTotal: number | null;                  // null → 「未取得」；GET /api/runtime/status 目前無此欄位（見 §14 OQ3），KG 遙測待建前恆 null
  gpuNodesBusy: number | null;                   // null → 「未取得」（同上）
  health: "ok" | "degraded" | "unknown";         // unknown 時顯示灰、非假綠（N5）
  conversionQueue: number | null;                // 選填：來自 GET /api/conversion/records，取 items 中 status ∈ {detected,queued,converting} 的篩選筆數——**不是** records 的總 count（避免把『歷史轉檔總數』誤標成『目前佇列深度』，見訂正紀錄）
  updatedAt: string;
  stale: boolean;                                // 上次輪詢失敗 / 超過 2× 間隔 → true
}
```

### 5.3 元件契約（狀態列 props）

```ts
interface SharedStatusRailProps {
  snapshot: SharedStatusSnapshot;  // 來自 useSharedStatus()（Context）
  activeAxis: AxisKey;             // 高亮當前頁脈絡
}
// 消費側：const snapshot = useSharedStatus();  // EdgeConsole 任一頁可呼叫
```

狀態列固定顯示：Active sessions（真值）｜GPU 使用（`busy/total` 或「未取得」）｜Health（ok/degraded/灰-unknown）｜轉檔佇列（真值或「未取得」）｜資料時間（`updatedAt`；`stale` 時整列變暗＋標「資料過期」，禁把舊值當即時）。點任一指標 → 用 §4 handoff 跳到權威頁（sessions→`#sessions`、GPU→`#instances`、health→`#runtime`）。

### 5.4 誠實規則（硬性）

- `null` 欄位一律渲染「未取得」，**不畫綠燈、不畫 fail**（N5/N8）。
- GPU 欄在 kit-manager-api 遙測接上前恆「未取得」（KG Node snapshot 仍 `prov="demo"`，不因狀態列而假裝變真）。
- `health` 只有在後端明確回報就緒才 `ok`；來源沉默 = `unknown`（灰），不臆測。對映官方 ready-vs-startup 語意（N8）。
- `stale=true` 時不得呈現 last-known-good 為 fresh。
- `stage_matched` 在共享狀態列**設計上恆為 null**（見 §5.2 說明）；不得為了「讓狀態列看起來更完整」而發額外的 per-session 請求去湊這個值——如果之後要改，必須先評估 N+1 請求成本，屬於獨立決策，不在本 spec 範圍內預先做掉。

### 5.5 SS / #runtime 的角色重定義（回應 IX-SS-05 doc-lag）

- `#sessions`＝session lifecycle 的**治理視圖**單一來源（清單、結束、未來的強制釋放），也是狀態列 `sessionsById` 的權威。
- `#runtime`＝runtime 聚合的**值班視圖**（四分頁），與狀態列共用同一 snapshot。
- IX-SS-05 原本要 A1「鏡射」的四格證據（first_frame/heartbeat/stage matched/DataChannel），在 `a334e49` 後**改由 Review Room 就地顯示（live）＋ `#sessions` 顯示（lifecycle）**，A1 只交握。狀態列是把這份單一真相端到每頁的載具。IX-SS-05 應據此改寫/關閉（見 §14 open questions；本 spec 不擅自改互動規格檔）。

---

## 6. A1 Dedicated 3D Display（重申既有結論＋SS/KG/RT 怎麼餵入）

**重申（N3，不重裁）**：3D highlight 只在 Review Room（`#review`/`#gpu`，`ReviewSessionViewerPane.tsx`）。**repo 現況精確版**（CLAUDE.md／對齊矩陣都明確提醒過 `#gpu`/`#review` 語意不同、勿混淆為同一頁）：`#gpu` route 掛 `GpuReviewRoomPage`（＝`<ReviewRoomPage/>` + 一塊 GPU 補充 Panel，`pages.tsx:1803-1813`），`#review` route 直接掛 `ReviewRoomPage`（`pages.tsx:2989`）——兩者是不同的 React 元件，但都會 render 同一個 `<ReviewSessionViewerPane/>`（`pages.tsx:2997`），所以本 spec 的 handoff／狀態列改動對兩條路由自動一致生效，不需要分別實作兩份。A1 是治理優先頁、無 inline viewer；Kit session 由使用者明確 attach/start；lease 由 Review Room 在 intent 後經 coordinator claim；lease token 不進 URL；`usd_prim_path` 缺失 → 誠實 disabled。生命週期狀態機沿用 decouple spec §6（`no_rule_run → … → highlight_ack | highlight_failed`），四個「不等於」（governance ready≠Kit ready、session 存在≠first frame、first frame≠stage match、stage match≠highlight ack）原樣保留。

**本 spec 新增的只是「供應端如何餵入這個既有交握」**——SS/KG/RT 不新增任何 3D 渲染，只當誠實資料源：

- **SS 餵「有哪些 session 可 attach」**：Review Room 的手動 attach 輸入框（`data-testid="review-room-session-input"`，`ReviewSessionViewerPane.tsx:255`）可由狀態列 `sessionsById`（＝`GET /api/runtime/status`）seed 候選，取代使用者手打 session id（仍保留手動輸入，不強制單選、不自動 attach）。A1 handoff 帶的 `session=` 也在此對照重驗（§4.2）。`#sessions` 與 Review Room 是同一份 runtime 真相的兩個誠實消費者，非兩份各自寫死。
- **KG 餵「GPU 容量允不允許 attach」**：官方 1:1（N8）意味 attach 可能因無空閒 GPU 失敗。KG（`#instances`）呈現 fleet 容量；Review Room 在 lease 衝突/無 GPU 時顯示**誠實 blocked（spectator/blocked）狀態，非 governance failure**（承接 decouple Adversarial Check）。**現況**：KG 遙測是 demo/待建，故此「容量閘」目前是**待建連結＋「未取得」標記**，不是 live gate（不畫假閘）。
- **RT 餵「runtime/stream 就緒與否」**：Review Room 的 first-frame/stage/DataChannel 是**每 session 的 live 證據**；`#runtime` 是**聚合值班視圖**。兩者讀同一 `GET /api/runtime/status`，健康語意分層（N8）。GPU/秒數在 RT 仍「未取得」，不因整合而變真。

一句話：**A1 交握不變；SS 給「哪個 session」、KG 給「有沒有 GPU」（待建）、RT 給「就緒沒」——三者透過 §5 狀態列端進 Review Room，Review Room 仍是唯一擁有 WebRTC/lease/highlight 的地方。**

---

## 7. Per-Axis UI Changes（逐軸，小而加法）

> 每軸只做三類加法：cross-link chip（§4）、一致 Prov 呈現（§5.4）、共用術語。核心閉環一律不動。

- **A1（`#a1`）**：維持既有 `#review`/`#conv` 交握；補 chip → `#minio`（回看選檔來源物件）、→ `#sessions`（rule-run 綁定的 session）。BCF assignee 維持 `p1` dashed。頁內術語與狀態列統一（session 一律稱 session、帶同一 id 顯示）。doc-lag：實作同時附註 IX-A1-06/07/08 已 handoff（改文件不在本 spec 程式碼範圍，列入 §14）。
- **CV（`#conv`）**：**新增轉檔歷史頁呈現**（純前端補洞，後端 `GET /api/dev/conversions` 已存在）——以 panel/子分頁呈現 `{items,count}`（route 落點見 §14 open question，禁自建路由表）。補 chip：轉檔列 → `#minio`（來源物件）、→ `#sessions`/`#review`（`review_session_id`）。維持 IX-CV-03/04 built 呈現、coverage 三項 `p1`、concurrency `NOT BUILT`、self-ref note。**更正文件措辭**（IX-CV-03 仍寫「待建」）列入 §14。
- **SS（`#sessions`）**：per-row 補 chip → `#instances`（session 落哪個 GPU node，KG 側「未取得」）、→ `#review?source=sessions&session=`（就地開此 session）、→ `#a1`（綁定 rule-run）。維持 Reclaim/Force-release `disabled`（`p1`）。角色重定義為狀態列治理側單一來源（§5.5）。**不新增** IX-SS-05 描述的「A1 連動橋供應端面板」（該面板意圖已由狀態列＋Review Room 承接）。
- **KG（`#instances`）**：Node snapshot 表**維持 `prov="demo"` 不動**（不假裝接真）；頂部**新增一列真 session 聚合**（讀狀態列 `activeSessions`，`asbuilt`），與 demo 表清楚分隔、標籤分明（真聚合 vs demo per-node）。demo 列 → `#sessions`（S-270/S-899 對應 session）chip。Fleet model 語意 `asbuilt` 不動；IX-KG-02/03/04 維持待建（不加假拖放/假按鈕）。
- **M（`#minio`）**：維持真 raw-folder 導覽＋SSE＋ledger chip＋既有觸發鈕；`.ifc` 物件補 chip → `#conv`（該物件轉檔）、→ `#a1`（拿此檔去檢核，帶 `minio_key`）。bucket layout panel 維持 `prov="demo"`、self-ref/測試資料標記不動。中文 key 走 §4.3 encode 規則。
- **IN（`#intake`）**：維持唯讀佇列（`asbuilt`）＋品質 Panel（`artifact`）＋manual mapping `p15`＋秒數/GPU「未取得」；job 列補 chip → `#conv`（排此 job）、→ `#sessions`/`#review`（`review_session_id`，目前只是文字欄，改為證據型 chip）。維持「保留別名」定位（cross-link 進入 OK，非主導覽目的地）。**確認不誤動** `OperatorConsole.tsx`/`IntakeSelectPage` 死碼分支。
- **RT（`#runtime`）**：維持 `CoordinatorPage` 四分頁（D2-A′，不動路由）；四分頁內 session 列補 chip → `#sessions`/`#review`/`#instances`。作為狀態列值班側消費者（§5.5）。GPU/秒數維持「未取得」demo-prov。

---

## 8. Representative Cross-Axis Lifecycle（跨軸動線狀態機）

一條完整業務動線，用 §4 handoff＋§5 狀態列把七軸串起來（狀態列在每一步都在頁頂顯示同一份 runtime 真相）：

```txt
[M] minio_object_detected            # #minio 逐層瀏覽看到新 .ifc（或 watcher opt-in 偵測，not observed）
  -> [IN] ifc_ready_job_listed       # #intake 唯讀佇列出現 job（GET /api/external/ifc-ready）
  -> [CV] conversion_triggered       # #conv 或 #minio 一鍵 POST /api/conversion/trigger（intent→confirm）
  -> [CV] conversion_ready           # ledger status=ready（asbuilt）；失敗=p1，可 prioritize/retry（built）
  -> [A1] source_selected            # #a1 選檔雙來源（含剛轉好的來源），鎖定 rule-run 標的
  -> [A1] rule_run_ready             # POST /api/governance/rule-runs → 輪詢
  -> [A1] failures_ready             # 記分板 + 失敗構件（.../failures）
  -> [A1] review_requested           # 點失敗構件「開啟 Review Room」→ #review?source=a1&rule_run_id&session?&ifc_guid?&usd_prim_path?
  -> [RR] kit_not_started            # Review Room 顯示「Kit session not started」（不自動啟）
  -> [RR] kit_starting               # 使用者明確 attach/start（唯一啟動點）
  -> [RR] first_frame_seen -> stage_matched -> datachannel_ready
  -> [RR] highlight_sent -> highlight_ack | highlight_failed   # usd_prim_path 缺 → 誠實 disabled，不假成功
  -> [A1] issue_created              # 回 A1：失敗轉 Issue（from-rule-run）→ BCF 匯出（兩步 gating）
```

環境供應端（全程在狀態列，不改動線）：**SS** 提供 `session` 候選與重驗；**KG** 提供 GPU 容量（1:1；現為「未取得」，故容量閘待建）；**RT** 提供 runtime/health 聚合（ready≠startup）。四個「不等於」在 Review Room 端保持可區分（承接 §6）。任何一步 ID 查無 → 誠實 `not found` + 手動重選，不靜默續跑（§4.2）。

---

## 9. Tournament（稽核軌跡：為什麼「單頁合併」被否決）

> 使用者已明確裁定「跨頁和諧整合」，本節僅留稽核軌跡，非重新開放選項（N1）。

| Option | Shape | UX fit | Spec fit | Runtime safety | Testability | Migration cost | Score | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|
| A | **跨頁和諧整合**：handoff 契約 + 共享狀態列 + cross-link chip，七頁不動核心 | 5 | 5 | 5 | 5 | 5 | 25 | **Winner（使用者裁定）** |
| B | **單頁合併**：把 7 route 併成一個 mega-page | 2 | 1 | 2 | 2 | 1 | 8 | **Rejected** |
| C | **新增 backend 聚合服務**跨軸推狀態 | 3 | 1 | 2 | 3 | 2 | 11 | Rejected |

- **B 被否決**：直接違反 README §3 鐵律#2「Route contract 唯一正典」與 A.1.1 22 條路由；會砍掉 canonical IA、破壞 deep-link aliases、破壞凍結 `/ui/open?session=` handoff；巨大 migration；且把七個各自誠實的頁面攪成一個難測的巨頁，Prov 分層更難維持。
- **C 被否決**：違反 N2（不新增 backend service）與 §1 拓樸凍結（前端只打 coordinator :8004）；同一 SPA 內用 Context 即可，新服務是無依據的過度設計。
- **A 勝出**：純加法、零新後端、零新路由、零新 production dependency；每一步都可獨立測試與 gstack 取證；完全落在前端 `web-viewer-sample/src/console/`。

---

## 10. Model Routing（四層，比照本 repo spec-to-done 慣例）

| Work type | Difficulty | Suggested model / effort | Reason |
|---|---:|---|---|
| Recon / 事實抽取（端點、file:line、Prov 現況） | Low-Med | **Haiku 4.5**, standard | 有界的讀取與事實比對，量大重複。 |
| Standard implementer（逐軸 chip、handoff util、狀態列元件、test） | Med-High | **Sonnet 5**, high | 多檔前端加法＋TDD，首發實作全類 implementer。 |
| Judge / final review（跨軸一致性、Prov 誠實、凍結面守恆） | High | **Opus 4.8**, max | 需獨立挑戰誠實標記與 N1–N10 是否被繞過。 |
| Arbiter（plan 作者 + final integration + evidence 裁決） | High | **Fable 5**, max | 跨切 UX/runtime/security/test，plan 與 final-review immutable 由此把關。 |

P5/P6（holistic critic / PR closeout）走 session（Fable 5 max）。routing 僅在 host 暴露 model override 時生效。

---

## 11. Implementation Scope（逐軸預期改動檔案，優先前端；零後端）

> 全部落在 `web-viewer-sample/src/console/`。**明列 DO-NOT-TOUCH（N4）**：governance-service `app.py`/`diff_engine`/`federation`/`issues`/`bcf`/`file_library` api.py、coordinator `src/app.ts`/`src/routes/governanceProxy.ts`、streaming `conversion_authority.py`。若某整合看似需要動後端 → 停手回報，預設是設計沒對準加法原則，不是後端缺功能。

**Task 0（建議先做的小 spike，不是正式任務，見 §14 OQ4）**
- 用一支既有真中文命名 fixture key，手動跑一次「`encodeURIComponent` → 塞進 `#minio?...` hash → 頁面 decode → 呼叫 `getMinioObjects(prefix)`」的最小 round-trip，確認不會被任何中介層（SPA fallback、`isSafeSessionId`-類 regex、proxy）攔下或 500。此 spike 通過後才動工 M 軸相關 chip；不通過則回報並重新設計該 chip 的傳輸方式。

**共用層（新增）**
- `handoff.ts`（新）：`CrossAxisHandoff` 型別 + `buildHandoff(target, payload)` + `parseHandoff(hash)`；吸收既有 `buildA1ReviewRoomHandoffHash`（`pages.tsx:232`）與 `parseReviewRoomHandoff`/`ReviewRoomHandoff`（`ReviewSessionViewerPane.tsx:31`）的邏輯——兩者目前命名、欄位風格（snake_case URL 參數 vs camelCase 型別欄位）都不同，收斂時需明確定案轉接層，不是簡單 re-export（見 §4）。
- `SharedStatusProvider.tsx` + `useSharedStatus.ts`（新）：頂層單一輪詢 `GET /api/runtime/status`（＋選配 `GET /api/conversion/records`），Context 分發；型別見 §5.2 的 `SharedSessionEntry`/`SharedStatusSnapshot`。
- `SharedStatusRail.tsx`（新）+ `.test.tsx`：§5.3 元件契約。
- `EdgeConsole.tsx`（改）：頂層 mount Provider + Rail；不動 route dispatch。
- `coordinatorClient.ts`（改，僅前端 client wrapper）：**確認目前完全沒有**任何 `/api/dev/conversions` 的 client wrapper（grep 全檔 0 命中），需新增 `getConversionsHistory()` thin wrapper 打**既有** `GET /api/dev/conversions`（`bim-review-coordinator/src/app.ts:2330`，不改後端）；其餘全複用既有方法。
- `data.ts`（改）：如需 cross-link metadata（chip 目標）補資料，不新增路由表列（引用 A.1.1）。

**逐軸（改 `pages.tsx` 對應段 + 對應 `.test.tsx`）**
- A1：`A1GovernanceWorkbenchPage`（+275/604/695）補 `#minio`/`#sessions` chip。
- CV：`ConversionSchedulingPage`（826+）補轉檔歷史 panel（打 `/api/dev/conversions`）+ chip。
- SS：`SessionManagementPage`（1282-1382）補 per-row chip；接 `useSharedStatus`。
- KG：`KitGpuFleetPage`（1384-1406）頂部補真 session 聚合列（`useSharedStatus`）+ demo 列 chip；demo 表不動。
- M：`MinioDataPage`（1469+）補 `.ifc` chip（`minio_key` encode）。
- IN：`IntakePage`（2869-2920）job 列補 chip；死碼分支不動。
- RT：`CoordinatorPage`（2841）四分頁 session 列補 chip；接 `useSharedStatus`；路由不動。
- Review Room：`ReviewSessionViewerPane.tsx` + `pages.tsx` Review Room 段：session 輸入框由 `useSharedStatus` seed 候選；其餘 3D/lease/highlight 邏輯不動（N3）。

**測試/E2E（新增或擴充）**
- 逐軸 `*.test.tsx`（chip enabled/disabled 條件、handoff 產生/解析、狀態列 null→「未取得」渲染）。
- `web-viewer-sample/tests/cross-axis-handoff.spec.ts`（新 Playwright）：走 §8 動線關鍵跳轉。

---

## 12. Verification Gates

### Unit / Component
- `buildHandoff`/`parseHandoff` round-trip 正確；`minio_key` 中文 `encodeURIComponent`↔decode round-trip 通過（見 Task 0 spike）。
- 每個 cross-link chip：目標 ID 缺 → `disabled` + 誠實原因；ID 在 → enabled 且 hash 正確帶 `source`。
- `SharedStatusRail`：`null` 欄位渲染「未取得」（非綠燈）；`stale=true` 整列變暗＋「資料過期」；`health="unknown"` 顯灰不顯 ok/fail；`stage_matched` 恆 null 時不得被誤渲染成任何真假判定。
- `SharedStatusProvider` 只建立**一條**輪詢（不因多頁掛載而多打 `/api/runtime/status`）。
- KG demo 表仍 `prov="demo"`；頂部聚合列讀真值且與 demo 表分隔。
- `conversionQueue` 計算邏輯：只計 `status ∈ {detected,queued,converting}` 的 records，非總 count。
- 承接 decouple gates：A1 不 mount `EmbeddedViewer`、mount 不 claim lease、不 auto-select `act[0]`；`usd_prim_path` 缺 → highlight disabled。

### Route / Handoff
- §4.3 每條跳轉：`#target?source=<axis>&...` 開啟後接收端**重驗 ID**；查無 → `not found` + 手動重選，不靜默 fallback。
- Review Room：`#review?source=a1` 在手動 attach 前顯示 `Kit not started`、不 claim lease；lease token 從不出現在 URL。
- 凍結 `/ui/open?session=` 不被任何新連結/redirect 吃掉。

### Browser E2E（user-facing 一律 gstack/Playwright evidence，N7）
- 走 §8 動線：M 選物件 → chip 到 `#conv` → 觸發轉檔 → `#a1` 選檔 rule-run → 失敗構件「開啟 Review Room」→ 手動 attach → first-frame/stage/DataChannel/highlight ack 為**各自獨立**證據 → 回 A1 轉 Issue。截圖＋trace 落 `artifacts/e2e/`。
- 確認 A1 無 inline WebRTC viewport；狀態列在每頁頂顯示同一份 runtime 真相；GPU 欄顯示「未取得」（非假綠）。

### Adversarial
- Stale tab 帶舊 `session` → `session not found` + 手動重選，不靜默選別的 active session。
- 多 active session → A1/Review Room 不自動選 `act[0]`。
- `/api/runtime/status` 輪詢失敗 → 狀態列 `stale`，不呈現舊值為即時。
- 無 GPU / lease 衝突 → Review Room 誠實 blocked，不誤報成 governance failure。
- 中文 `minio_key` 跳轉 → 不因 encode/decode 或 proxy 而 500/穿越（deriveIntakeFromKey 擋穿越既有行為不變）。
- grep 守恆檢查：diff 未觸碰任何 §11 DO-NOT-TOUCH 凍結後端檔。

---

## 13. Acceptance Criteria

- 七條路由維持七個實體頁面，A.1.1 路由表未被自建/覆寫（N1）。
- 存在一支共用 `handoff.ts`：URL 帶非機密 ID、不帶 lease token/auth，接收端一律以 ID 重驗（§4）。
- 存在一條掛在 EdgeConsole 頂層、單一輪詢 `GET /api/runtime/status` 的共享狀態列，落實 v1.3「`#sessions`／Runtime 監控為單一來源」，且 `null`/`stale` 誠實呈現「未取得」/「資料過期」（§5、N5）。
- 每軸至少一條可操作的證據型 cross-link chip，覆蓋 §4.3 矩陣（缺 ID 即誠實 disabled）。
- A1 仍治理優先、無 inline viewer；3D/lease/highlight 只在 Review Room；Kit 啟動明確；SS/KG/RT 僅作為餵入既有交握的誠實資料源，未新增任何 3D 渲染（N3、§6）。
- KG Node snapshot 維持 `prov="demo"`；GPU 遙測欄維持「未取得」；未出現任何假按鈕/假綠燈（N5）。
- 零新後端 service/route，零凍結檔改動，零新 production dependency（N2、N4、N10）；diff 全落在 `web-viewer-sample/src/console/`。
- §8 動線有通過的 Playwright evidence（截圖＋trace），四格證據可區分（N7）。
- 若 A1 重新引入 `EmbeddedViewer` 或 mount 時 claim lease，測試必須失敗（承接 decouple spec）。

---

## 14. Open Questions（不阻塞落地；各附預設值供 spec-to-done 逕行推進）

> 以下五題需要人類（docs owner / 產品owner）後續拍板，但每題都已內建一個可直接執行的預設，spec-to-done 不必為此停下來問人。

**OQ1 — 文件同步（doc-lag）歸屬**：《對齊矩陣》§4.4/§4.5 與《互動規格》IX-A1-06/07/08、IX-SS-05 仍描述 `a334e49` 之前的「A1 自證四格證據 rail / A1 連動橋供應端面板」方向。本 spec 已在架構上以「Review Room 就地顯示 + `#sessions` 治理側 + 共享狀態列」承接，但這幾份是最高效力的需求文件。
**預設**：本 spec **不**修改《互動實作規格與標準對齊.md》或《對齊矩陣》——維持「非使用者指令不得重建/覆寫」的既有限制（README §2）。實作 PR 的描述必須明確列出這個 doc-lag，讓使用者事後決定是否另開一個 docs-only PR 去改 IX-SS-05/IX-CV-03 的措辭。

**OQ2 — CV 轉檔歷史頁的 route 落點**：後端 `GET /api/dev/conversions` 已存在、純缺 UI，但它目前沒有 canonical hash。鐵律#2 禁自建路由表。
**預設**：實作為 `#conv` 頁面內的一個 Panel／子分頁（不新增 hash route、不動 A.1.1），這是唯一不需要路由表擁有者核准就能做的選項；只有在使用者明確想要一個獨立可分享的 hash（例如 `#conv/history`）時，才需要另外走 A.1.1 升格流程。

**OQ3 — 共享狀態列 GPU 欄的資料來源**：`GET /api/runtime/status` 目前不含 GPU per-node 或 busy/total 欄位（已核實 `RuntimeSessionSummary`/`RuntimeStatus` 型別無此欄位）。
**預設**：`gpuNodesTotal`/`gpuNodesBusy` 維持 `null`（「未取得」），直到後端明確新增對應欄位或提供其他經 coordinator proxy 的來源；前端**不得**為了填這個欄位而直連 kit-manager-api `:8010`（違反拓樸凍結）。

**OQ4 — 中文 `minio_key` 經 URL hash 往返的實測**：`encodeURIComponent` 後經 coordinator 各 proxy（尤其含 session-id regex 與 SPA fallback 的路由）是否會被攔下或 500，尚未實測。
**預設**：列為 §11 的 Task 0 spike，實作前先用一支既有真中文命名 fixture 跑一次最小 round-trip；若 spike 失敗，暫緩 M 軸相關 chip 並回報，不強行以「理論上應該可以」上路。

**OQ5 — KG 容量閘的最終形態**：官方 1:1 意味 Review Room attach 可能因無空閒 GPU 失敗。
**預設**：維持 §6 已定案的「Review Room 事後誠實 blocked」，不在本 spec 範圍內建置 attach 前的硬閘；只有在 kit-manager-api 遙測真正落地、且有產品決策要求「attach 前先擋」時，才升級為 pre-attach hard gate（屆時仍不得前端直連 `:8010`）。
