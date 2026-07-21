# viewer-redesign — 設計決策

## 1. 規格來源與查證面（doc-first + 實碼證據）

本 change 的每條規格都對齊到實碼證據或既有 canon，不臆造：

| 規格塊 | 權威來源 |
|---|---|
| DataChannel OUT 建構 | `web-viewer-sample/src/clients/streamMessages.ts`（openStage/loadingStateQuery/getChildren/highlightPrims/focusPrim/clearHighlight builders） |
| DataChannel OUT mutator 集合與 authority envelope | `web-viewer-sample/src/Window.tsx:137-146`（`runtimeMutatingEvents` 9 值）、`:452-467`（`_withRuntimeAuthority` 注入 role/source_client_id/viewer_lease_token/session_id）、`:427-450`（三道前端 gate） |
| DataChannel IN 處理 | `Window.tsx:2089-2369`（openedStageResult/loadArtifactGroupResult/loadingStateResponse/updateProgress*/highlightPrimsResult/focusPrimResult/stageSelectionChanged/getChildrenResponse/bindingApplied 各欄位） |
| vg01 iframe 橋 | `web-viewer-sample/src/console/EmbeddedViewer.tsx`（URL 參數、postMessage 訊息、origin 驗證、sandbox、gated mount、key remount 契約） |
| lease / session ready | 設計文件 §04 `:244`、§06 `c6-review-session`/`c6-viewer-lease` |
| 三 ratios / 10 counts / 六態 outbox / capability | `openspec/changes/rvt-ifc-usdc-lineage/design.md` §4/§6/§10.4、`specs/lineage-governance-console/spec.md` |
| 載入逾時基準 | `Window.tsx:2183`（loadingState busy 輪詢上限 90 次 × 1s） |

`commandRejected` 為唯一「實碼不存在、由本 change 首次定義」的訊息（§04 既有待補項，CH-C 殘留）。

## 2. 內嵌持久 viewport 的結構決策

- **單一 EmbeddedViewer 實例**：Kit 每 signaling endpoint 單 viewer（primary `:49100` 一路）+ ViewerLease editor 單佔 → 整個 unified Workspace 只允許一個 primary viewport 實例，由結構保證（provider 單例），不靠執行期互斥。
- **持久層掛載點**：session/lease/viewer state 收進 `WorkspaceSessionProvider`（掛 UnifiedShell 內、children 外圍）；iframe DOM 節點跨 `#a1..#a4` 切換不 unmount（移除 `EdgeConsole.tsx:94` 的 `key={page}`，改 dock sync effect）。切至非 workspace 鍵（#home/#pipeline…）= 合法釋放時機。
- **mount 不自動 claim**：沿用既有守門（`A1ViewerEmbed.test` 鎖定）；只有手動「啟動 3D Session」才 claim。這同時是 visual gate（offline preview 無 coordinator）的零新 DOM 保證。
- **spectator 不內嵌**：console 端 EmbeddedViewer 一律 `streamRole="primary"`；spectator 以同 session_id + `&streamRole=spectator` 外開邀請（`/ui/open` 凍結面），readonly gate 在 viewer 端。

## 3. 失敗態矩陣的裁決原則

每個失敗態 = 觸發條件（可由實碼/API 判定）+ 畫面 + 文案鍵 + 可行動作。三條原則：

1. **誠實優先**：未觀測不宣稱（first-frame 未回報就不顯示「串流中」；`stage_truth=pending` 顯示 pending 而非成功）。
2. **不自動搶佔**：lease 409 只顯示佔用者資訊與「重試」；heartbeat 逾時後的接管一律回到手動 claim，不 auto-takeover。
3. **降級可辨識**：每個失敗態有穩定 `data-uc` 測試錨點與 i18n 文案鍵，Playwright 語意案例可逐態斷言。

## 4. 效能 SLO 的定位

Hi-Fi 的「60 FPS · 28 ms」維持 R3 fixture 示意。本 change 首次給出**可量測的正式門檻（提案預設值，使用者可調）**：

| 指標 | 門檻（LAN 基準環境） | 量測法 |
|---|---|---|
| first_frame_ms | p95 ≤ 10 000 ms（基準模型 ≤ 100MB IFC 轉出之 USDC） | ReviewSession.first_frame_ms（既有欄位） |
| 串流幀率 | ≥ 24 FPS 持續（1080p） | WebRTC `getStats()` inbound-rtp framesPerSecond |
| 指令往返延遲 | p95 ≤ 300 ms（highlightPrimsRequest→Result） | request_id 配對時間差（前端量測） |
| 模型載入逾時 | 90 s（busy 輪詢 90 × 1s，沿用實碼現值） | loadingStateResponse 輪詢 |

超標=品質告警（UI 顯示實測值），非硬失敗；SLO 斷言只進 E2E 報告不進 CI gate（避免環境抖動假紅）。

## 5. viewer origin 解凍的邊界

解凍**只及頁內 UI**：`/ui/open` 302 進場、參數白名單、CI guard、`:5173` 埠位、baked image 部署鏈全部不動。頁內規格化四塊：版面分區、primary/spectator 視覺差異、embedded 模式 chrome 隱藏、失敗態同矩陣。embedded 偵測不走 `/ui/open` 新參數（避免碰白名單）——EmbeddedViewer 直連 viewer origin 組 URL，由「`window.parent !== window` 且 vg01 handshake 完成」判定 embedded，握手前維持 standalone chrome（誠實：無握手=無 console 在場）。

## 6. A1 lineage 交叉比對的 IA 決策

- **雙層呈現**：A1 Dock 內放「治理摘要卡」（3 ratio KPI + coverage_status + outbox 六態 badge），完整交叉比對開新 hash 頁 `#lineage`（五 surfaces：Version Overview / Artifacts / Alignment / Attempts / Audit，逐項對齊 `lineage-governance-console` spec）。理由：Dock 316px 放不下三欄對帳表；`#lineage` 為跨 A1–A4 共用的治理檢視，不專屬 A1。
- **對帳鍵**：MinIO 唯一來源——所有軸以 MinIO object（`source_ifc`/`parsed_usdc`/planned `model.rvt`+`schedule.csv`）+ `idempotency_key（mw_<hash16>）` + `external_model_version_id` 對帳；cloud 只存 locator+summary（§01 鐵律 1）。
- **誠實 provenance 分軸**：IFC↔USDC 軸=現成可接線（ledger/quality-metrics/ElementMapping）；RVT 軸與三向 ratio=`planned/NOT_BUILT`（後端零實作），UI 顯示 NOT_BUILT 不做假資料。denominator=0 → ratio=null、status=`not_evaluable`（引用 lineage design §4，不另創語意）。
- **viewer 聯動**：Alignment 表列有 `usd_prim_path` 者可 highlight/focus（走共用 viewport），null → disabled（§06 ElementMapping 鐵律沿用）。

## 7. 契約檔落點

Schema 草案放本 change `contracts/`（同 `rvt-ifc-usdc-lineage` 慣例），**不**直接放 `tests/contracts/`——§04 明定 tests/contracts 為 CI 委任的最高 payload 權威，spec-only 階段放入會製造「有契約檔但無 CI 驗證」的假信號。實作 change 落地時遷移並接 runtime 驗證。
