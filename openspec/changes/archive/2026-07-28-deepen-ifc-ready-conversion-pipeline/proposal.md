## Why

B-scheme 閉環（IFC-ready intake → 下載 → 序列派工 → poll/ingest → metadata-only outbox → ledger）的編排深度目前卡在 `bim-review-coordinator` 的 composition root（`createCoordinatorApp` 內大量 closures），週邊 queue/client/store 相對淺。改 poll、outbox、ledger 或 retry 語意時必須在巨型 composition root 內導航，locality 差、AI/人類可維護性差。架構 review（C1）已收斂加深邊界與 hook 契約，現在需要把定案變成可實作、可驗證的 OpenSpec change，且 **不改變 public wire contract**。

## What Changes

- 在 `bim-review-coordinator` 引入 deep module **IfcReadyConversionPipeline**，擁有：accept（含 create/replay/download/enqueue）、serial dispatch 脈絡、poller、ingest、ConversionLedger 寫入、callback outbox enqueue、dispose / test-only pending 觀測。
- Express route 收斂為薄 adapter：HTTP auth/normalize → domain command → pipeline 方法 → status 映射。
- **onConversionTerminal** 同步 hook：僅在 conversion terminal（ready|failed）於 job/outbox/ledger 完成後呼叫；hook 失敗不回灌 ingest；auto Review Session **不**進入 pipeline 核心。
- Artifact health 第一刀仍由 route/app best-effort 處理，不上多點事件匯流排。
- **非 BREAKING**：`POST /api/external/ifc-ready`、internal conversion-result/ingest、retry/prioritize、outbox summary 等 **path 與對外 JSON 形狀凍結**（既有 vitest 為尺）。
- Domain 詞彙以 root `CONTEXT.md` 為準（IfcReadyConversionPipeline、IntakeCommand、Conversion terminal、onConversionTerminal）。

### 非目標

- 不修改 `bim-streaming-server` conversion authority 行為或 public conversion API。
- 不合併前端 dual coordinator client、不重構 `Window.tsx` / A1 UI。
- 不把 auto Review Session、kitPool、EventLog、ArtifactHealthLedger 吸入 pipeline。
- 不變更 MinIO watcher 產品語意（仍 loopback 打 ifc-ready）。
- 不重開 SAFE_ID / dual payload identity 跨語言統一（另案 C7）。
- 不改 governance proxy path 或 R1 凍結面。

## Capabilities

### New Capabilities

- `ifc-ready-conversion-pipeline`: 定義 coordinator 內 IFC-ready→conversion closed loop 的 deep module 擁有範圍、入口語意、terminal hook 契約、以及與 Review Session / artifact health 的 seam。

### Modified Capabilities

- `conv-prioritize-retry`: 將 pending-dispatch 脈絡與 retry/prioritize 控制動作的擁有者從「app dispatcher closure」改述為 **IfcReadyConversionPipeline** 擁有（行為與 HTTP 契約不變）。
- `conversion-webhook-lifecycle`: 標明 conversion terminal 後 outbox enqueue 與 job terminal 寫入由 pipeline 必做；auto session 觸發移出為 terminal 後 observer（行為不變：ready 才可建 session、outbox 與 session 狀態獨立）。

## Impact

- **Owning folder**：`bim-review-coordinator/`（主）；`CONTEXT.md`（domain 詞）；OpenSpec 本 change。
- **API / wire**：無 intentional 變更；回歸以既有 coordinator vitest 為準。
- **Session**：autoCreate 仍用 SessionStore/kitPool/eventLog，掛在 `onConversionTerminal`。
- **Storage**：ExternalIfcReadyStore、ConversionLedger、CallbackOutbox 仍為 SoT adapters；ownership 的是編排，不是改 schema。
- **跨 repo**：streaming / governance / viewer / scripts **不需**為本 change 改行為。
- **Active-change 協調**：與 `a4-semantic-search-model-qa`、runtime-command、hifi design 無 capability 寫入衝突；實作時避免與同時改 `app.ts` 的 PR 硬撞。
- **驗證**：Slice 式搬移；每片跑 external-ifc-ready、auto-poll、dispatch-queue、control-routes、host-native-ingest、callback-outbox、ledger-intake 等既有測。
