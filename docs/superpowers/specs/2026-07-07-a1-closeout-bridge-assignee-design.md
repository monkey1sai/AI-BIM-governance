# Spec-1：A1 治理檢核閉環收尾（連動橋＋assignee）

> 日期：2026-07-07 · 狀態：使用者已核可設計
> 前置依賴：**Spec-0 S1/S2**（SS-02 證據鏈、SS-05 供應端）先落地，本 spec 的連動橋消費端才可驗收。
> 行為合約來源：互動規格 IX-A1-06/07/08、審批報告 A1v2（D10）；本檔為實作層 spec，衝突時以 `docs/plans/` 效力順序為準。

## §0 背景與現況（2026-07-07 盤點）

A1 v2 主流程已建成（選檔雙來源→檢核→結果→審查→交付、開啟 Review Room handoff）。剩兩個缺口：

1. **3D 高亮連動橋**（IX-A1-06/08，P1.5）：`a1-bridge-highlight` 目前 disabled，缺 `#sessions` 證據鏈供應。
2. **BCF 審查面板指派欄**（IX-A1-07，P1）：issues schema 無 assignee 欄，UI 為 dashed 待建標。

**O7 已拍板（2026-07-07 使用者指令）**：issues schema 加自由文字 assignee 欄（additive），對齊 BCF 2.1 `assigned_to`。此拍板即為凍結檔解凍簽核（範圍見 §2.4）。

## §1 連動橋消費端（IX-A1-08 → IX-A1-06）

### 1.1 A1BridgeRail 行為合約

- 四格證據：**session 派發／WebRTC 首幀／DataChannel／stage matched**。單一來源=`/api/runtime/status`（與 `#sessions` 同輪詢週期，A1 只讀鏡射、**禁自行推定**，D-33）。
- GUID chips 佇列：rule-run 失敗構件的 `usd_prim_path` 佇列；無 `usd_prim_path` 的構件標 `⚠ name_fallback` 且不可加入高亮佇列（`usd_prim_path=null` 為誠實契約，禁捏造）。
- 高亮鍵啟用四條件**缺一不可**：DataChannel ready ∧ first_frame_at ∧ stage matched ∧ 選中 chips 皆有 usd_prim_path。
- 任一格未綠 → 高亮鍵 disabled ＋ title 寫明原因 ＋「開 Session 管理 →」連結。
- 不內嵌 3D 視窗、不畫斜線佔位（rail 呈現）。

### 1.2 高亮執行（IX-A1-06）

- 指令：`highlightPrimsRequest { prim_paths[], color }`，payload 帶 `source:"a1"`（IX-3D-05 指令族，A2/A4 未來共用）。
- 走 Review Room 既有 DataChannel 通道（`AppStreamer.sendMessage`＋`omni.kit.livestream.messaging`），`*Request`/`*Result` ack 慣例對齊 web-viewer-sample 現行。
- **收到 viewer ack 才標成功**；ack 前不標成功、不畫假綠燈；逾時顯示可讀錯誤並允許重試。
- 每指令留 trace（現行 IX-3D-02 慣例）。
- 關閉 session → 連動橋回 idle（與 SS-05 對稱驗收）。

## §2 assignee 後端（O7 落地）

### 2.1 schema（additive）

- Issue 模型加 optional `assignee: string | null`（自由文字；空/null=未指派）。舊資料無此欄一律視為 null，**不做資料遷移**。
- 既有 `status` enum（`open/assigned/in_progress/resolved/rejected/reopened`）**逐字不動**；指派**不**自動改 status（UI 可另行走既有 transition 把 open→assigned）。

### 2.2 API（additive，不改任何既有路徑字串）

- 新端點：`POST /api/governance/issues/:issueId/assign { assignee: string | null }` → 更新欄位＋寫 audit（誰、何時、從何值到何值；actor 沿用現行 audit 慣例）。
- `GET /api/governance/issues*` 回應物件加 `assignee` 欄（additive，envelope 不變）。
- `POST .../issues/from-rule-run/:runId`、`from-diff/:diffId` 接受 optional `assignee`（建立即指派）。

### 2.3 BCF 匯出

- `bcf_writer` 在 topic markup 寫入 BCF 2.1 `AssignedTo`（僅當 assignee 非空）；維持「執行期只用 stdlib」既有約束。
- 驗收：.bcfzip 用第三方 BCF 檢視器開啟可見 AssignedTo。

### 2.4 解凍簽核範圍（使用者 2026-07-07 核可本 spec 即簽核）

| 檔案 | 允許改動 |
|---|---|
| `governance-service/issues/api.py` | additive：新 assign 端點、回應加欄、from-* 收 optional assignee |
| `governance-service/issues/store.py` | additive：assignee 欄位持久化＋audit |
| `governance-service/bcf/bcf_writer.py` | additive：AssignedTo 寫入 |
| `bim-review-coordinator/src/routes/governanceProxy.ts` | **條件式**：僅當現行 proxy 非前綴透傳、需逐路由註冊時，additive 加 assign 路由；byte-identical 原則下不得動任何既有路徑字串 |

上表以外的凍結檔（`app.py`、`conversion_authority.py` 等）**維持禁改**。

## §3 指派 UI（IX-A1-07 補完）

- BCF 審查面板 topic 列的 dashed 待建標翻真控制：assignee 顯示＋編輯（自由文字輸入、可清除）。
- 證據型更新（模式 3）：POST 成功→重抓 issues→才更新畫面；重整不回退。
- topic 數=失敗規則數、空 topic 模式 6 空狀態、無 viewpoint 誠實缺省——既有行為不動。
- Prov：指派控制從 `p1` 翻 `asbuilt`。

## §4 驗證任務（verify-first，不重做）

- **IX-A1-03「點規則展開命中構件」**：互動規格 A.2 標未做，但 repo 已有 failures 懶載入（`GET .../failures?rule=`，分頁 50）。Codex Task 0 先驗：若已建成，只補 E2E 證據並回報文件失真；未建才實作（展開 71 筆不卡、空失敗顯「全過」不可展開）。

## §5 明確不做

- 不做 assignee 下拉名冊／帳號系統（單站點無 auth；自由文字即 O7 拍板範圍）。
- 不動選檔雙來源、rule-run、匯出既有行為（IX-A1-01/02/04/05 已建）。
- `#a1` 不內嵌 viewer（2026-07-02 A1 3D 解耦架構不回退）。
- 選檔仍不觸發轉檔（鐵律 #7 釘子 #4）。

## §6 驗收（DoD）

1. pytest（`.venv\Scripts\python.exe`）：assign 端點單測（設值/清除/audit/舊資料相容）、BCF AssignedTo 單測。
2. 全鏈 E2E（Playwright/gstack，真 Kit 環境）：選檔→檢核→審查（指派一筆）→匯出 .bcfzip（驗 AssignedTo）→開 Review Room→證據四格轉綠→高亮→**viewer ack**→截圖。證據落 `artifacts/e2e/`（PNG `git add -f`）。
3. 對稱驗收：關 session 後 `#a1` 連動橋與 `#sessions` 供應端同步回 idle。
4. 無 GPU／無 session 時：四格顯「未取得」、高亮鍵 disabled 附原因——此態也要截圖（誠實標記驗收）。
5. GitNexus：改 symbol 前 `impact`、commit 前 `detect_changes`；HIGH/CRITICAL 先回報。
