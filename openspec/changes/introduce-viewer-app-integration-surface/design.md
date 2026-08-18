# Design — introduce-viewer-app-integration-surface

> 設計過程：Fable apex draft → L1 sonnet×3（契約/code model/遷移）→ L2 opus×2 refute-by-default → L3 終審 → openspec-forge 二階（apex plan → Opus/xhigh 獨立 challenge：9 blocking＋12 nonblocking 全數裁決吸收）。複驗基準：main HEAD `080c714f`（2026-08-18；session 中 main 被並行推進，行號與數字屬快照）。過程草稿（`artifacts/tmp/viewer-redesign/`）為已被吸收之暫存稿、不入庫；本檔自足承載。thaw 後 S0 重驗行號與測試基線。

## 0. 終審裁決吸收表（本 change 全數採納）

| 爭點 | 終審裁決 |
|---|---|
| active 名額 | 6/6 滿額（ledger＋NOW 六筆一致實測）→ 以 `Status: deferred` 開立附 thaw 條件，不替 owner 打破名額 |
| 失敗態數 | 全案統一 **12 態＋holder-privacy**（predecessor viewer-viewport delta；lease-occupied 只顯「editor lease 已被占用」，MUST NOT 顯示 holder user／viewer／display name／nonce／stream detail）；canonical spec 的 10 態＋「顯示 holder」是將被取代的舊快照。predecessor 5.6 已於 2026-08-18 closeout：console 內嵌側 12/12；standalone 側 6 present＋4 裁決不適用（no-session／session-preparing／viewer-origin-missing／gpu-unavailable 屬 console parent 職責）＋2 lab-embed degraded by design |
| ViewerCommandSurface | 否決（漏抽象）→ ElementSemantics／ViewerIntent＋能力型別化 encoder＋ViewerIntentPort（§3）。`colorScheme()` 刪除：Kit 端 messaging extension 零 `color` 讀取、vg01 schema 無 color 欄；顏色只存在於 2D `legendColor()` |
| A2 色彩 | 「五色」為草稿發明錯誤；實碼端到端為 **3 值語意**（added／removed(error)／modified(warning)；5 change_type→3 組）。A2 的 3D 整合已完整活在 legacy `#version-diff`（VersionDiffPage＋ReviewSessionViewerPane mode="a2-overlay"＋批次 ack）→ S5 定性為表面收斂非新建 |
| 狀態模型 | 扁平 union 否決 → 多軸 snapshot（六軸，軸內互斥軸間並存）＋告警閂鎖＋兩衍生函式（§2）；**純函式層，不新造失敗態渲染**（challenge B5：12 態可觀察面屬 viewer-viewport capability，由既有 pane／EmbeddedViewer 持續持有） |
| V-A 路由 | Portal 與「三欄 grid 上移」皆否決（Portal 換 container＝iframe 重建；上移被 A4 無 grid 版面證偽）→ **V-A′**（§4） |
| 側欄 A4 remount | 事實成立（fixtures `hash:"#a4"` → LegacyEdgeConsole → AliasRedirect type-swap）；**修正讓渡給 `a4-console-convergence` tasks 3.3**（challenge B1）；本 change 不做 |
| a4Profile | 完全移除（含 id union 的 "a4"）；Host/route 範圍含 a4 不變（§5） |
| Layer 3 hooks | 只承諾 console 宿主；Layer 0–2 純 TS 兩宿主共用（Window.tsx class 持有 core 實例＝現有模式延續）；`useViewerRoleState` 不建；`useUsdStageTree` 移出（F-7＝#609） |
| 工具列 ⬒✥◫⟲ | 結構性封鎖（vg01 目錄 11 分支無 select/reset/frame；補訊息＝bridge delta＝predecessor 持有）→ 本 change 內誠實 disabled 標 Roadmap；真行為＝F-3（#605）；風險 R-C1 |
| commandRejected 回饋 | 擁有者＝`ViewerIntentPort.send()` rejected 分支（6 值 reason）→ `useViewerCommands` 接可見事件列/toast |
| ReviewSessionViewerPane | 本次抽取主素材（783 行、3 消費端、9 段/7 段兩條近重複 gate 鏈）→ gate 鏈收斂進 primaryBlocker/batchBlocker，pane 薄殼化；且為 S3a 內嵌內容物（12 態渲染重用，不新造第二套） |
| IX-A1-06 | 不得援引為權威（非 approved canon 且兩處表述不一致）；canonical 需求層只寫可觀察 gate 規則；9 段/7 段等價＝S2 遷移 DoD（challenge NB4） |
| C1 | production mutator 目錄 **8** 條；`runtimeMutatingEvents` envelope 集合 **9** 條（composeStageRequest＝harness-only）；兩軸正交、非 canon 缺陷 |
| vg01 prose 漏 stream_state | predecessor task 6.2 職責，本 change 不碰 |
| capability 避讓 | 不對任何被 active change 持有 delta 的 capability 出 delta（快照與動態聲明見 proposal）；新 capability 措辭避開「overlay 版面」「3D 標示」「token 權威」詞域，且不重定義既有 capability 已治理的行為語意（challenge B7） |
| ledger 失真 | predecessor task_ledger.completed 記 32、實測 33 → 揭露不代修（R-L1，issue #611）；converge-console 3.1「CLI 不可執行」前提已證偽 → thaw 最快路徑 |
| 測試基線 | 歷史數字（965/1099/1080）不沿用；S0 實跑重取＋**擷取 ack transcript golden**（challenge B4） |

## 1. Code model 終版

```
web-viewer-sample/src/viewer/
├─ protocol/   kitDataChannel.ts（26 events，對齊 tests/contracts/kit-datachannel-v1.schema.json；
│                                 註記 production mutator 8／envelope 9）
│              vg01.ts（11 分支，對齊 tests/contracts/vg01-postmessage-v1.schema.json，含 stream_state）
├─ transport/  DataChannelClient（request_id correlation、trace 注入、單一 terminal、目錄防呆、
│                                 _sendStreamMessage 三道 UX gate＋6 值 reason 具名承接）
│              Vg01Port（role 參數化單 class：console/viewer 兩側 origin+source 驗證）
│              LeaseChannel（claim/heartbeat/release；heartbeat 讀 stream/stage 軸快照——依賴方向：Lease 讀它們）
├─ state/      ViewerModel = { snapshot: ViewerSnapshot; latches: ViewerAlarmLatches }
│              ViewerSnapshot 六軸：session/host/lease/stream/stage/artifact（軸內互斥、軸間並存）
│              visibleStates(m): VisibleStateId[]   // 12 態謂詞（純函式；不驅動新渲染）
│              primaryBlocker(m, item?): BlockerCode|null   // 遷移等價基準＝pane 現行 9 段 item gate 鏈
│              batchBlocker(m): BlockerCode|null            // ＝7 段 batch gate 鏈
│              HighlightModel（applySingle/applyBatch 雙 ack 語意不合併；guid→prim_path 翻譯在此）
│              viewerObservationStore（純 TS store；App class 與 hooks 皆可讀）
├─ intent/     ElementSemantics = {axis:"severity",value} | {axis:"diff",value: added|removed|modified}
│                               | {axis:"discipline",value} | …（A5–A10=新增 axis，encoder 不動）
│              ViewerIntent（highlight[replace,單筆]/highlight_batch/focus/clear/select/reset_view/tree_children）
│              Vg01Capability = highlight|highlight_batch|focus|clear
│              DataChannelCapability = Vg01Capability|select|reset_view|tree_children
│              ViewerIntentEncoder<C,W>（vg01: semantics→severity 欄；DataChannel: guid→prim_path）
│              ViewerIntentPort<C>.send(intent, model) → ok{requestId,sentCount?,unmappedGuids?}
│                                                      | {blocker: BlockerCode}
│                                                      | {rejected: CommandRejectedReason}  // 非靜默
├─ react/      useViewerSession（組合 Model+LeaseChannel+附掛；命名 delta 於 proposal 論證）
│              useViewerCommands（注入 ViewerIntentPort；rejected → 可見事件列）
│              ViewportHost / useViewportSlot（V-A′；內容物＝重用 ReviewSessionViewerPane）
│              EmbeddedViewer（自 console/ 遷入、原位 re-export）
│              OverlayHud（live-gated 加性：stagePath/streaming pill 實測值＋工具列 disabled 殼）
│              SelectionCallout（selected_guid；selection_sync 為選用 capability）
└─ profiles/   ViewerAppProfile（§5）＋ a1Profile／a2Profile／a3Profile（＋test-only fixture profile）
```

宿主組裝：console＝UnifiedShell 包裹層＋ViewportHost（V-A′）＋WorkspacePage 中欄 registerSlot；viewer origin＝App class 持有 core 實例（Layer 0–2），Layer 3 不承諾。

**transport 翻譯 vs domain enrich 界線**（challenge NB6）：guid→prim_path 之「查表翻譯」屬 core（HighlightModel/encoder，唯一實作）；把 rule-run／diff 結果與 mapping「合成 domain 列資料」之 enrich（如 A1 頁 `enrichRuleResultsWithMapping`）屬 app 層、允許存在——S4 的 mappingCache 收斂決策無論併或不併，皆不違反 spec Requirement 4（該需求只約束翻譯位置與 direct import，不約束 domain enrich）。

## 2. 狀態模型

- `ViewerModel = { snapshot, latches }`；六軸：session／host／lease／stream／stage／artifact（軸內互斥、軸間並存）；閂鎖：leaseExpired／firstFrameTimedOut／streamDisconnected（set/clear 為事件驅動顯式解除，非條件推導）。
- `visibleStates(m)`：12 態謂詞、每態一個謂詞，1:1 對映既有 data-uc／testid／i18n key（清單於 S0 凍結入 §10）。12 態＝no-session、session-preparing、viewer-origin-missing、lease-occupied（holder-privacy）、stream-disconnected、lease-expired、authority-unavailable、stage-unproven、gpu-unavailable、first-frame-timeout、stage-load-timeout、stage-mismatch。
- **不新造渲染**：12 態的可觀察面（DOM/錨點/i18n）由既有 `ReviewSessionViewerPane`／`EmbeddedViewer`／`Window.tsx` 持續持有（viewer-viewport capability 治理域）；`visibleStates()` 只是同構純函式，供 S2 等價測試與 predecessor archive 後的收斂案使用。
- `primaryBlocker(m, item?)`／`batchBlocker(m)`：遷移等價基準＝pane 現行 9 段／7 段 gate 鏈；等價性以現有 DOM tests＋S0 transcript golden 證明（此為 S2 遷移 DoD，非 canonical 需求措辭）。
- HighlightModel：applySingle／applyBatch 兩方法（逐筆／批次雙 ack 語意不合併）；guid→prim_path 翻譯自 `App._mappingCache` 遷入且 transcript 等值。

## 3. Intent 與 encoder 模型

app 層只講語意（ElementSemantics）與意圖（ViewerIntent）；型別化 encoder 依宿主能力集（Vg01Capability ⊂ DataChannelCapability）把語意轉具體訊息欄位；`ViewerIntentPort<C>.send()` 回傳三態（ok／blocker／rejected 6 值 reason），一律非靜默。A5–A10＝新增 semantics axis，encoder 與下層不動。unmapped 計數與 ack 欄位形狀之行為權威＝`embedded-viewer-bridge` 既有 spec；本設計只規定其判定與計算實作來源唯一（core state 層）。

## 4. V-A′ 掛載方案

UnifiedShell 內 children 外新增 `position:relative` 包裹層；`ViewportHost` 為其 absolute 兄弟層。live-only 渲染：離線／未啟動 `return null`＝零新 DOM（design gate 由構造保證；R-D1 由此構造性消除、降級為驗證項）。頁面經 `useViewportSlot().registerSlot(el)` 註冊中欄 rect，ResizeObserver 同步；未註冊 slot（含 A4 分頁）時 host 保持掛載、`visibility:hidden`（canon `#a1↔#a4` 不 unmount、lease 不重 claim）。離開 workspace 由 `page` prop 顯式驅動 unmount → cleanup release lease（不得依賴 React reconciliation）。

- **內容物**：`ReviewSessionViewerPane`（additive 消費——沿用其 12 態渲染、lease/heartbeat、gate、EmbeddedViewer 組裝；如版面與 unified 衝突，僅允許以 wrapper 容器約束外框，不改 pane 內部＝5 檔不變式）。
- **pre-live 控制項**（challenge B6）：「啟動 3D Session」按鈕、session 選擇器等一律 live-gated 加性 DOM（`coordinatorClient.health()` probe 成功才渲染；離線/超時/例外靜默吞掉、零新 DOM——`WorkspacePage` 既有 probe 與 `DockLiveLink`／`A1DockLive` 先例）。design gate 環境（harness 將 `/api/**` 回 503）probe 恆敗 → 離線 baseline 構造性不變，**無需 rebaseline、不動 manifest**。
- **已知限制（challenge B2）**：`EdgeConsole` 對 `#workspace?dock=a4` 的直達判定要求 `window.location.search` 為空；search 非空（含 `?harness=1` carrier）會落 `workspace-a4-scrub`→AliasRedirect→type-swap remount 並洗掉 search。故 S3a 持久性 e2e 規定：**單次 goto 進站（hash-only），其後全部導覽走頁內 client-side 點擊**；side-nav A4 路徑之收斂屬 `a4-console-convergence` tasks 3.3。

## 5. Profile 模型（只含 a1/a2/a3）

`ViewerAppProfile { id:"a1"|"a2"|"a3"; legend(state); semanticsOf(item): ElementSemantics; legendColor(sem): CssToken /*2D only*/; toViewerActions(evt): ViewerIntent[]; fromViewerSelection?: (guid)=>DomainSelection /*capability selection_sync*/; capabilities: ReadonlySet<Capability>; gate(item, m: ViewerModel): GateVerdict }`

- a1Profile：severity 軸；rule-run failures；3D 反查。
- a2Profile：diff 3 值；批次；沿用 pane 既有 a2-overlay 能力（表面收斂）。
- a3Profile：discipline 軸；stage_composition 呈現。
- test-only fixture profile（S5）：驗證「新增 profile 零 core 修改」擴充邊界（spec Requirement 5 的執行者）。
- **a4Profile 完全移除**（含 id union 的 "a4"）；Host/route 範圍含 a4 不變。A4 整合前提三條：(1) `a4-console-convergence` archived；(2) A4 surface 暴露 slot；(3) owner 裁決是否需要內嵌 3D（現況 table-only）。落地＝F-5（#607）。

## 6. 切片設計（每片＝spec-to-done 可獨立完成）

依賴序：S0 → S1 → S2 → S3a → S3b → S4；S5 依賴 S3a、可與 S3b 平行。（側欄 A4 導覽修正不在本 change：讓渡 `a4-console-convergence`。）

| 片 | Outcome | 硬約束 | DoD 摘要（全文見 tasks.md） |
|---|---|---|---|
| S0 | pre-flight＋golden 擷取 | 實跑基線；凍結 12 態錨點清單；逐消費端 ack transcript golden 入 repo | 清單＋基線＋golden 檔完成 |
| S1 | protocol+transport 純抽取＋import 邊界測試 | 原位 re-export；公開介面凍結；不動 render/testid/i18n；邊界測試隨 npm test 跑（不動 CI workflow） | verify 綠；雙 ack transcript 與 golden 等值；gate 具名承接 |
| S2 | state 層（12 態多軸模型，純函式） | 不搬矩陣本體；不新造渲染；零 render 變更 | 12 謂詞單測＋blocker 鏈等價 |
| S3a | ViewportHost（V-A′） | live-only 零新 DOM；重用 pane；page prop 顯式 unmount | hash-only 持久性 e2e＋離線像素零變化＋無 `<video>` 斷言 |
| S3b | 手動啟動＋lease UI＋spectator 邀請 | pre-live 控制項 live-gated；claim 綁 onClick；holder-privacy | 啟動流 e2e＋離開釋放 e2e |
| S4 | a1Profile 接 A1 dock live | live-gate 沿用；gate 雙軸；mappingCache 決策 | A1 全鏈＋unmapped disabled |
| S5 | a2/a3/fixture profiles | A2 表面收斂；legacy 不刪；fixture 驗擴充邊界 | harness 回放＋批次計數＋零 core diff |

## 7. Predecessor-owned surface 與避讓

見 proposal「Predecessor-owned surface」段（capability 動態聲明＋快照、task 級讓渡、5 檔不變式、R-O1 推翻、R-P1 零依賴設計）。

## 8. F* 債務表（GitHub issue 錨，needs-triage，已開立）

| F* | 內容 | 前置條件 | issue |
|---|---|---|---|
| F-1 | Kit 端多色高亮（Kit messaging 零 color 讀取；schema 欄位已存在） | 無（Kit 端獨立） | #603 |
| F-2 | section／measure（Kit extension 加掛＋DataChannel 封閉目錄增修） | predecessor archive（protocol delta 解鎖） | #604 |
| F-3 | 工具列 ⬒✥◫⟲＋fullscreen 真行為（R-C1） | predecessor archive 後出 bridge delta | #605 |
| F-4 | viewer origin 頁內 UI 規格化（canon SHALL；R-V2） | owner 排期 | #606 |
| F-5 | A4 頁採用 slot | §5 三前提 | #607 |
| F-6 | a5–a10 具體 profiles | 本 change archive | #608 |
| F-7 | useUsdStageTree（vg01 無 tree；viewer 側需 client 下傳） | 協定演進或下傳重構 | #609 |
| F-8 | Window.tsx class→function 與 UI 全拆 | 本 change archive | #610 |

（治理帳本失真複核＝#611，非 F* 功能債。）

## 9. 風險登記

| 風險 | 內容 | 處置 |
|---|---|---|
| R-T1 | S1 抽取波及面 | re-export＋公開介面凍結＋S0 transcript golden 等值回歸 |
| R-C1 | 工具列／console 指令結構封鎖 | disabled 標 Roadmap；F-3（#605） |
| R-V2 | viewer origin UI 規格化 canon SHALL 未排期 | F-4（#606）＋PR known gaps |
| R-P1 | predecessor 7.3（GPU 取證）無日期 | 零依賴設計（不搬矩陣本體、不改五檔可觀察行為） |
| R-L1 | predecessor ledger 32/33 失真 | 揭露不代修；#611 交 owner |
| R-D1 | 已由 V-A′ 構造性消除 | 降級為驗證項：離線像素零變化 e2e＋top document 無 `<video>` 斷言 |
| R-S1 | A2 雙表面 | open decision；S5 不刪 legacy `#version-diff`（保留至 CH-G） |
| R-E1 | 瀏覽器取證依賴隔離 alt-port branch stack（active change isolated-branch-stack-browser-e2e 自陳 5.2/5.3 gap） | 退路：S3a/S3b/S5 先以 jsdom/unit 等價測試落地，runtime 取證缺口誠實列 known gap，不假宣稱 |

## 10. S0 凍結清單落點（預留）

thaw 後 S0 將把「predecessor 5.6 的 12 態 testid／data-uc／i18n key 清單」「實跑測試基線數字」「三消費端 ack transcript golden 檔路徑」凍結寫入本節；在此之前本節空白即為尚未 thaw 的誠實訊號。
