# Tasks

> 本 change 以 `Status: deferred` 開立：§0 於開案規格 PR 內完成；§1–§8（S0–S5）一律於 thaw 後執行，**每片＝spec-to-done 可獨立完成的一個 PR**。thaw 前不得據本檔修改任何 runtime surface。
>
> 驗證場所沿 repo 慣例：未 merge 期間 runtime 證據一律用隔離 alt-port branch stack，不碰測試部署區 `:8004`（外部依賴與退路見 design.md §9 R-E1）。歷史測試數字（965/1099/1080）不沿用，以 S0 重取的基線為準（design.md §10）。

## 0. 開案（本規格 PR 內完成）

- [x] 0.1 四份 artifact（proposal／design／tasks／`specs/viewer-app-integration-surface/spec.md`）落 `openspec/changes/introduce-viewer-app-integration-surface/`，`npx openspec validate introduce-viewer-app-integration-surface --strict` 通過。
- [x] 0.2 開立 8 個 F* GitHub issues（label：needs-triage）並回填 design.md §8 表：F-1=#603、F-2=#604、F-3=#605、F-4=#606、F-5=#607、F-6=#608、F-7=#609、F-8=#610；另開治理帳本複核 #611（R-L1 與 converge-console 3.1 前提證偽，交 owner）。
- [x] 0.3 `openspec/lifecycle-ledger.json` 新增本 change row（schema 全欄位：`status:"deferred"`、`owner:"web-viewer-sample"`、`current_slice`＝deferred 開立說明＋thaw 條件、`blocked_by:[]`、`last_verified`＝寫入時刻 UTC、`task_ledger`＝本檔實際勾數、`evidence_refs`＝proposal/tasks 兩路徑、`subject_commit`＝開 PR 時 branch head 40-hex、`archive_debt:null`）→ `docs/plans/NOW.md` 的 `<!-- lifecycle-ledger:start -->` fenced JSON projection `changes` 陣列依 id 字母序插入 `{ "id": "introduce-viewer-app-integration-surface", "status": "deferred" }`（插於 `implement-runtime-command-authority-and-rejection` 與 `introduction-resolved-subject-binding` 之間）；`node scripts/tests/verify-openspec-repository-lifecycle.mjs` 綠（三源一致 gate）。
- [x] 0.4 PR body 依 `scripts/tests/check-pr-body-evidence.ps1` 必過表逐字填寫：**AI Coding Governance** 表 7 label（`Linked issue`＝#603–#611；`Requirement source`＝docs/plans 設計文件 §03/§04＋approved canon viewer-viewport／embedded-viewer-bridge＋issues；`CODEOWNERS / owner review`；`GitNexus evidence`＝誠實現況（spec-only PR，無 symbol 變更）；`Browser E2E evidence`＝not-applicable（spec-only）；`Agent workflow changed?`＝no；`Required checks expected`）＋**Change Classification** 表 3 label（`Change lane`＝G；`Behavior contract changed`＝no；`Requirement source` 同上）；附 validate 輸出；known risks 揭露 R-L1（揭露不代修，#611）、subject_commit post-squash rebind 尾巴、thaw 最快路徑（converge-console 3.1 重測後 archive 釋額）。
- [ ] 0.5 收尾（merge 後）：比照 `introduction-resolved-subject-binding` 先例，將 ledger row 的 `subject_commit` rebind 至本 PR 之 squash commit（獨立小 PR）。

## 1. S0 pre-flight＋golden 擷取（thaw 後第一片）

- [ ] 1.1 實跑重取測試基線：`web-viewer-sample` `npm run verify`（build＋test＋struct-log）；數字寫入本檔證據段與 design.md §10。
- [ ] 1.2 對帳 predecessor（implement-runtime-command-authority-and-rejection）subject／task 現況；凍結其 5.6 的 12 態 testid／data-uc／i18n key 清單寫入 design.md §10；重確認 active change 與被佔 capability 清單（proposal 快照若有變，同 PR 更新）。
- [ ] 1.3 逐消費端（a1-inline／ReviewRoom／a2-overlay）擷取 `highlight`（逐筆、每 item 一 ack）與 `highlight_batch`（單次＋計數 ack）的訊息＋ack transcript 為 vitest snapshot golden 檔入 repo；定義「transcript 等值」＝事件順序、event_type 與 payload 欄位值逐項相等（snapshot 等值），golden 檔路徑記入 design.md §10。
- [ ] 1.4 對 `ReviewSessionViewerPane`、`EmbeddedViewer`、`Window` 主要符號跑 `gitnexus impact -d upstream -r AI-BIM-governance`；HIGH／CRITICAL 依 repo 規範揭露後才動工。

## 2. S1 protocol＋transport 純抽取

- [ ] 2.1 建立 `web-viewer-sample/src/viewer/protocol/`：`kitDataChannel.ts`（26 events，對齊 `tests/contracts/kit-datachannel-v1.schema.json`；註記 production mutator 8／envelope 9）、`vg01.ts`（11 分支，對齊 `tests/contracts/vg01-postmessage-v1.schema.json`，含 stream_state）。
- [ ] 2.2 建立 `transport/`：DataChannelClient（request_id correlation、trace 注入、單一 terminal、目錄防呆、`_sendStreamMessage` 三道 UX gate＋6 值 reason 具名承接）、Vg01Port（role 參數化單 class，console／viewer 兩側 origin+source 驗證）、LeaseChannel（claim/heartbeat/release；heartbeat 讀 stream/stage 軸快照）。
- [ ] 2.3 原檔原位 re-export、公開介面凍結；零 render／testid／data-uc／i18n key 變更（5 檔不變式，見 proposal Predecessor-owned surface）。
- [ ] 2.4 建立 app 層 import 邊界靜態測試（vitest，隨 `npm test` 執行；掃描 `src/viewer/profiles/**` 與 profile 消費頁對 `src/viewer/transport/**` 之 direct import，違規 fail closed 並列出違規 import；不動任何 CI workflow 檔）。
- [ ] 2.5 DoD：`npm run verify` 綠且不低於 S0 基線；雙語意 ack transcript 與 1.3 golden 等值；`_sendStreamMessage` gate 具名承接測試；guid→prim_path 翻譯自 `App._mappingCache` 遷入 HighlightModel 且 transcript 等值。

## 3. S2 state 層（12 態多軸模型，純函式）

- [ ] 3.1 建立 `state/`：ViewerModel＝{六軸 snapshot＋latches}；`visibleStates()` 12 謂詞 1:1 對映既有 data-uc／testid／i18n（以 predecessor delta 為準；lease-occupied＝holder-privacy）；`primaryBlocker()/batchBlocker()`。
- [ ] 3.2 硬約束：不搬 predecessor 5.6 矩陣本體；**不新造任何失敗態渲染**（12 態可觀察面由既有 pane／EmbeddedViewer 持續持有）；現有 DOM tests 為 golden；零 render 變更。
- [ ] 3.3 DoD：12 謂詞單測；blocker 鏈與 `ReviewSessionViewerPane` 現行 9 段／7 段 gate 行為等價測試（三消費端行為與 ack transcript 與 golden 等值）。

## 4. S3a ViewportHost（V-A′）落地

- [ ] 4.1 UnifiedShell children 外 `position:relative` 包裹層＋`ViewportHost` absolute 兄弟層；live-only（離線／未啟動 `return null`＝零新 DOM）；內容物＝重用 `ReviewSessionViewerPane`（additive 消費；如需外框約束僅以 wrapper 容器，不改 pane 內部）；`useViewportSlot().registerSlot(el)`＋ResizeObserver 同步；A4 分頁 host 保持掛載、未註冊 slot 時 `visibility:hidden`。
- [ ] 4.2 離開 workspace 由 `page` prop 顯式驅動 unmount → cleanup release lease（不得依賴 reconciliation）。
- [ ] 4.3 DoD：iframe 持久性 e2e——**單次 goto 進站（hash-only、無 search），其後導覽一律頁內 client-side 點擊**；`data-mount-token` 同一節點跨 `#a1↔#a2↔#a3` 與頁內導向 `#workspace?dock=a4`；離線像素零變化 e2e；console top document 無 `<video>` 斷言（R-D1 驗證項）。（側欄 A4 路徑之 canonical 化屬 `a4-console-convergence` tasks 3.3，不在本片。）

## 5. S3b 手動啟動＋lease UI＋spectator 邀請

- [ ] 5.1 pre-live 控制項（「啟動 3D Session」按鈕、session 選擇器）一律 live-gated 加性 DOM（health probe 成功才渲染；離線零新 DOM；DockLiveLink／A1DockLive 先例）；claim 綁按鈕 onClick（canon 唯讀掛載 Scenario 相容）；MUST NOT 自動搶佔。
- [ ] 5.2 lease UI：lease-occupied 呈現沿用既有 holder-privacy 呈現（只顯「editor lease 已被占用」）；spectator＝`/ui/open?session=…&streamRole=spectator` 外開連結真複製（取代 fixture 假 toast，live-gated）。
- [ ] 5.3 DoD：啟動流 e2e（probe→啟動→claim→gated-mount→first_frame 證據）；離開 workspace 釋放 lease e2e；失敗態呈現沿用 pane 既有錨點（不新造第二套）。

## 6. S4 a1Profile 接 A1 dock live

- [ ] 6.1 建立 `profiles/`＋a1Profile（severity 軸；rule-run failures；`fromViewerSelection` 反查＝selection_sync capability）；沿用 A1DockLive live-gate；`gate(item, model)` 雙軸。
- [ ] 6.2 mappingCache 收斂決策落地（`governance/mappingCache.ts` class 為正本；A1 頁 inline enrich 併入與否於本片內決策並記錄理由——兩種結果皆合規，界線見 design.md §1）。
- [ ] 6.3 DoD：A1 選列→highlight ack→3D 反查全鏈；unmapped 列 disabled＋誠實計數；import 邊界測試綠。

## 7. S5 a2Profile＋a3Profile＋fixture profile（依賴 S3a，可與 S3b 平行）

- [ ] 7.1 a2Profile：diff 3 值語意（added/removed/modified）；把 legacy `#version-diff`（VersionDiffPage＋pane mode="a2-overlay"＋批次 ack）既有能力收斂至 unified dock（表面收斂非新建）；legacy 頁不刪（R-S1，保留至 CH-G）。
- [ ] 7.2 a3Profile：discipline 軸；stage_composition 呈現。
- [ ] 7.3 test-only fixture profile：驗證「新增 profile 零 core 修改」（spec Requirement 5 執行者）——changed paths 僅 profiles 層＋註冊點，協定／傳輸／狀態／intent 層零 diff，既有 profile 測試全綠。
- [ ] 7.4 DoD：FakeAppStreamer `?harness=1` 回放；批次 unmapped 誠實計數；A3 組合呈現；7.3 之 changed-paths 證據入 PR。

## 8. 收尾與 archive 條件

- [ ] 8.1 每片 PR 依 repo 慣例跑 `gitnexus detect-changes --scope compare --base-ref main`，誠實處理 HIGH／CRITICAL 與 UNKNOWN／stale 輸出。
- [ ] 8.2 全部切片 merge 後：delta 同步 canonical、`npx openspec archive introduce-viewer-app-integration-surface`；archive 前確認 F-1～F-8 issues（#603–#610）仍開啟或已有 successor、known gaps（R-C1／R-V2／R-S1／R-E1）未被誤宣稱完成。
- [ ] 8.3 predecessor 關係收尾：若其間 predecessor 已 archive，canonical 12 態承接與工具列 bridge delta 一律另開 change（F-3＝#605），不併入本 change。
