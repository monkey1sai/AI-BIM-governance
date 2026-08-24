# introduce-viewer-app-integration-surface

> **Status: deferred 2026-08-18**（active WIP 6/6 滿額——owner 2026-07-24 檔位；六筆＝a4-console-convergence、converge-console-specs-to-shipped-behavior、gpu-session-baseline-and-idle-reclaim、implement-runtime-command-authority-and-rejection、isolated-branch-stack-browser-e2e、migrate-console-to-hifi-design，ledger＋NOW 一致實測）。本 change 以 deferred 開立、不計入 active WIP；artifacts 寫全，thaw 後即可由 spec-to-done 逐片執行。
>
> **重啟條件（thaw）**：僅使用者明確口令升 active。deferred/frozen 不因額度增加或任一 change archive 而自動 thaw（`docs/plans/NOW.md` 2026-07-24 owner 裁決）。thaw 前本 change 只是規格正本，不得據以修改任何 runtime surface。

## Why

viewer 能力目前分裂在互不共享的實作面：viewer origin `App`／`Window.tsx` class（5,851 行）、console 內嵌 `EmbeddedViewer`／`ReviewSessionViewerPane`（783 行、3 消費端 a1-inline／ReviewRoom／a2-overlay、9 段 item gate＋7 段 batch gate 兩條近重複鏈）、與各 App 頁面各自 ad-hoc 接線。後果：(1) 同一 viewer 語意（highlight／ack／gate／guid 翻譯）存在近重複實作，行為漂移只能靠人工比對；(2) A1/A2/A3 的 3D 整合各走各的，A5–A10 每加一個 app 都要重新發明 gate、翻譯與 ack 承接；(3) unified Workspace `#a1..#a4` 的 persistent primary viewport（`viewer-viewport`／`embedded-viewer-bridge` 兩份 approved canon 的內嵌半邊）沒有可承接的掛載結構。

目標：把 viewer 能力重構為「一套 core、兩宿主、宣告式 app 整合面」。設計過程＝Fable apex draft → L1 sonnet×3（契約/code model/遷移）→ L2 opus×2 refute-by-default → L3 終審 → openspec-forge 二階（apex plan → Opus/xhigh 獨立 challenge，9 條 blocking 全數由 coordinator 裁決吸收）。過程草稿（`artifacts/tmp/viewer-redesign/`）為已被吸收之暫存稿、不入庫；本 change 四份 artifact 自足承載全部裁決。

## What Changes

七個切片，每片＝spec-to-done 可獨立完成的一個 PR（細節見 design.md §6、tasks.md）：

- **S0 pre-flight**：實跑重取測試基線（歷史數字 965/1099/1080 一律不沿用）；對帳 predecessor 現況；凍結 predecessor 5.6 的 12 態 testid／data-uc／i18n key 清單；**逐消費端（a1-inline／ReviewRoom／a2-overlay）擷取 highlight 與 highlight_batch 的訊息＋ack transcript 為 vitest snapshot golden 入 repo**（後續「transcript 等值」DoD 的比較對象）。
- **S1 protocol＋transport 純抽取**：新層 `web-viewer-sample/src/viewer/`（protocol／transport），原檔原位 re-export、公開介面凍結。硬 DoD：逐筆 highlight（每 item 一 ack）與 highlight_batch（單次＋計數 ack）雙語意 **ack transcript 與 S0 golden 等值**；`_sendStreamMessage` 三道 UX gate＋6 值 reason 具名承接；guid→prim_path 翻譯自 `App._mappingCache` 遷入 HighlightModel 且 transcript 等值。**同片建立 app 層 import 邊界靜態測試**（隨 `npm test` 執行之 vitest 測試，掃描 profiles 與消費頁對 transport 模組之 direct import，違規 fail——不動 CI workflow 檔，避開 self-referential bootstrap）。
- **S2 state 層**：六軸 ViewerSnapshot（session/host/lease/stream/stage/artifact，軸內互斥軸間並存）＋告警閂鎖＋`visibleStates()`（12 態謂詞，holder-privacy 版 lease-occupied）＋`primaryBlocker()/batchBlocker()`（＝實碼 9 段/7 段 gate 鏈）；**純函式層，不新造任何失敗態渲染**（12 態的可觀察面由既有 `ReviewSessionViewerPane`／`EmbeddedViewer` 持續持有）；零 render 變更，現有 DOM tests 為 golden。
- **S3a ViewportHost（V-A′）**：UnifiedShell 內 children 外 `position:relative` 包裹層＋absolute 兄弟層 `ViewportHost`，live-only 渲染（離線/未啟動 `return null`＝零新 DOM），內容物＝**重用 `ReviewSessionViewerPane` 既有失敗態／lease／gate 呈現（additive 消費，不改 pane 內部）**；頁面經 `useViewportSlot().registerSlot(el)` 註冊中欄 rect；離開 workspace 由 `page` prop 顯式驅動 unmount → release lease。
- **S3b 手動啟動＋lease UI＋spectator 邀請**：「啟動 3D Session」等 pre-live 控制項一律 **live-gated 加性 DOM**（health probe 成功才渲染，DockLiveLink／A1DockLive 既有先例；design gate harness 將 `/api/**` 打 503→probe 恆敗→離線 baseline 構造性不變，無需 rebaseline）；claim 綁按鈕 onClick（canon 唯讀掛載 Scenario 相容）；lease-occupied 不顯 holder；spectator＝外開連結真複製。
- **S4 a1Profile 接 A1 dock live**：沿用 A1DockLive live-gate；`gate(item, model)` 雙軸；mappingCache 收斂決策落地。
- **S5 a2Profile＋a3Profile＋fixture profile**：A2＝把 legacy `#version-diff`（`VersionDiffPage`＋`ReviewSessionViewerPane mode="a2-overlay"`＋批次 ack）既有能力收斂至 unified dock 的**表面收斂**（3 值語意 added/removed/modified），非新建；legacy 頁不刪。A3＝discipline 軸＋stage_composition 呈現。**另加一個 test-only fixture profile 驗證「新增 profile 零 core 修改」擴充邊界**。

**本 change 不含側欄 A4 導覽修正（讓渡聲明）**：側欄 A4 項目 `hash:"#a4"` 造成 LegacyEdgeConsole→AliasRedirect type-swap remount 的收斂，屬 active change `a4-console-convergence` tasks 3.3 明文持有範圍（「#a4／#/a4／separate semantic-search entry 收斂為相容轉址，#/workspace?dock=a4 成為唯一 canonical 操作面」）。本 change 不做、不重複宣告；S3a 的持久性驗證改以 hash-only 直達導覽驗證（見 design §4 已知限制）。

### 命名 delta（canon §03 對應）

Layer 3 hooks 只承諾 console 宿主：`useViewerSession`（組合 ViewerModel＋LeaseChannel＋附掛）、`useViewerCommands`（注入 ViewerIntentPort；rejected → 可見事件列）。與 canon §03 理想命名（`useViewerInteraction`／`viewerCommandClient`）的對應差異屬 canon 自帶「理想化命名、遷移屬實作 PR」但書之範圍，於此明列不迴避。`useViewerRoleState` 不建（console 恆 primary、spectator 不內嵌；`resolveGovPanelState` 維持 viewer origin 現況）；`useUsdStageTree` 移出本 change（vg01 無 tree 訊息，列 F-7＝issue #609）。

### Predecessor-owned surface（非重疊聲明）

- **capability 非重疊**：本 change 只 ADDED 新 capability `viewer-app-integration-surface`，**不對任何被 active change 持有 delta 的 capability 出 delta**。開 PR 當下實測快照（`ls openspec/changes/*/specs/`）：`implement-runtime-command-authority-and-rejection` 持有 `embedded-viewer-bridge`／`kit-datachannel-protocol`／`viewer-runtime-command-bridge`／`viewer-viewport`；`converge-console-specs-to-shipped-behavior` 持有 `unified-governance-console`／`edge-console-operator-frontend`；`a4-console-convergence` 持有 `a4-semantic-search`；`migrate-console-to-hifi-design`、`gpu-session-baseline-and-idle-reclaim`、`isolated-branch-stack-browser-e2e` 各持有其 delta 目錄。thaw 時若清單有變，S0 重新實測後更新本段。新 capability 措辭刻意避開「overlay 版面」「3D 標示」「token 權威」詞域，且不重定義 unmapped 計數／MappingCache coverage 等既有 capability 已治理的行為語意（只約束實作來源唯一，見 spec delta 前言）。
- **task 級重疊讓渡**：側欄 A4 導覽 canonical 化＝`a4-console-convergence` tasks 3.3 持有（見上）。
- **檔案級協調（5 檔）**：`web-viewer-sample/src/Window.tsx`、`web-viewer-sample/src/console/EmbeddedViewer.tsx`、`web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`、`web-viewer-sample/src/console/windowParentMessage.dom.test.tsx`、`tests/contracts/vg01-postmessage-v1.schema.json` 為 predecessor 行為承載檔。本 change 對其只做 additive 抽取與薄殼化；**不變式：零 render／testid／data-uc／i18n key 變更**，S1/S2 以現有 DOM tests＋S0 transcript golden 證明。
- **R-O1 推翻聲明**：曾主張兩 change 表面正交；終審推翻——12 態矩陣本體與本 change 抽取素材在同一批檔案內，非正交。故本 change 只做 additive 抽取；canonical 12 態承接（把 predecessor delta 轉正）留待 predecessor archive 之後另案，絕不平行改寫其 delta。
- vg01 spec prose 漏 `stream_state` 屬 predecessor task 6.2 職責，本 change 不碰（碰＝bridge delta 撞域）。

### 精確度註記

- kit-datachannel production mutator 目錄 **8** 條；`runtimeMutatingEvents` envelope 集合 **9** 條（`composeStageRequest`＝harness-only）——非 canon 缺陷，兩軸正交。
- IX-A1-06 不得援引為 gate 權威（非 approved canon 且兩處表述不一致）；gate 真相＝實碼 9 段/7 段鏈（S2 遷移 DoD 以此為等價基準；canonical 需求層只寫可觀察 gate 規則，不引實碼形狀）。
- 失敗態全案統一以 **12 態＋holder-privacy** 為準（predecessor viewer-viewport delta；canonical spec 的 10 態＋「顯示 holder」是將被取代的舊快照；歷史「10+2」措辭一律不再使用）。

## Impact

- Affected specs：新 capability `viewer-app-integration-surface`（ADDED only；canonical spec 於 archive 後才出現）。
- Affected code（thaw 後實作 PR）：`web-viewer-sample/src/viewer/`（新層）、`web-viewer-sample/src/console/`（薄殼化與 re-export 接點）。不改 governance-service／bim-streaming-server／coordinator 對外契約；不碰 design manifest／gate script。
- 本規格 PR 檔案：`openspec/changes/introduce-viewer-app-integration-surface/**`、`openspec/lifecycle-ledger.json`（新 row，status:"deferred"、owner:"web-viewer-sample"、schema 全欄位）、`docs/plans/NOW.md`（lifecycle-ledger projection fenced JSON 的 `changes` 陣列依 id 字母序插入 `{ "id": …, "status": "deferred" }` 一筆）。三源一致由 `scripts/tests/verify-openspec-repository-lifecycle.mjs` fail closed。
- 分支/worktree：`codex/openspec/introduce-viewer-app-integration-surface`＋`.worktrees/introduce-viewer-app-integration-surface/`；`npx openspec validate introduce-viewer-app-integration-surface --strict` 通過後開 PR。
- **subject_commit 尾巴**：ledger row 之 `subject_commit` 於開 PR 時指向 branch head；squash merge 後須比照 `introduction-resolved-subject-binding` 先例 rebind 至 squash commit（tasks 0.5 收尾項＋PR body known gaps 揭露）。
- **R-L1 揭露（不代修）**：predecessor `task_ledger.completed` 記 32、實測 33（33[x]/2[ ]）；本 change 不改別人的列，PR body known risks 揭露並由 issue #611 交 owner 複核。

## Open decisions 與 known gaps（誠實揭露）

- **A2 雙表面（open decision，R-S1）**：預設 unified `#a2` 為目標表面、legacy `#version-diff` 保留至 CH-G 裁決；本 change 不刪 legacy。
- **R-C1 工具列結構封鎖**：vg01 目錄（11 分支）無 select/reset/frame 訊息；補訊息＝embedded-viewer-bridge delta＝predecessor 持有。本 change 內 ⬒✥◫⟲ 四鈕＋fullscreen 誠實 disabled 標 Roadmap；真行為列 F-3（issue #605，前置＝predecessor archive 後出 bridge delta）。
- **R-V2**：viewer origin 頁內 UI 規格化（canon SHALL）未排期，列 F-4（issue #606）。
- **search-bearing 進站限制**：`EdgeConsole` 對 `#workspace?dock=a4` 的判定要求 `window.location.search` 為空，search 非空（含 harness carrier `?harness=1`）會落 `workspace-a4-scrub`→AliasRedirect→type-swap remount 並洗掉 search；S3a 持久性 e2e 以 hash-only client-side 導覽驗證，此限制之收斂屬 `a4-console-convergence` 範疇。
- 完整非目標與 F* 債務表（8 項 GitHub issue 錨 #603–#610，needs-triage）見 design.md §8。
