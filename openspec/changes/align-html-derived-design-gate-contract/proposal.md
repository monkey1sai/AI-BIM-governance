# 變更：建立 HTML 衍生 Design Gate 契約

> 所屬：`AI-BIM-governance` workspace；owner：design-gate governance、`scripts/`、`scripts/tests/`。

## Why

目前 repo 已採 `docs/plans/*.html` 作為設計需求的 doc-first 來源，但 design gate 尚缺一份可機器驗證的 HTML source-set、衍生 metadata provenance 與 base/head scope 分類契約。結果可能把 repo 外部 origin、未追蹤檔案、人工 PR 說明、過期 digest 或無法回溯的衍生欄位誤當成設計權威，也無法穩定區分 design-source-only、gate-infrastructure-only、production product 與 source/product 混合變更。

`align-frontend-design-system-reference` 仍是 deferred、frozen、non-canonical、non-owner。其 successor crosswalk 已裁決：HTML-derived gate v2 與 classifier 必須另開 successor，且不得夾帶 `migrate-console-to-hifi-design` 的產品換皮、human-owner 工作或 #535 rebaseline 修復。本 change 只承接 source-set、provenance、scope classifier 與 fail-closed negative-fixture 的治理契約，不 thaw 或 apply 舊 align change。

## What Changes

- 將目前 checkout 中所有 Git-tracked `docs/plans/*.html` 定義為 design gate 的唯一需求輸入集合。來源必須是 repo-relative、可由 base/head 證明存在的 tracked HTML；repo 外絕對路徑、origin 投影、screenshot、PR prose、未追蹤檔案與人工 boolean 不具權威性。
- 定義衍生 metadata 的 provenance 契約。每個 HTML-derived 欄位必須可回溯至 tracked HTML source、其 digest 與語意位置；policy-derived 欄位必須可回溯至 versioned policy path 與 policy digest。缺少 provenance、digest drift、來源不在 source-set、欄位無法回溯或 source/policy 類型混淆時，design gate SHALL fail closed。
- 定義 base/head scope classifier。分類結果至少包含 product `passed`、`mixed`、`partial_reference_missing`，以及 non-product `design_source_update_only`、`gate_infrastructure_only`。同一變更同時觸及 authority HTML 與 production UI 時，結果必須是 `design_source_and_product_mixed_fail_closed`，不得由任一單側 evidence 將其升格為 passed。
- 定義 unknown、source drift、缺少衍生 metadata、缺少必要 evidence、無法判定 changed-path ownership 或 provenance 不完整時的 fail-closed 行為；不得以「沒有發現問題」代替可驗證的通過證據。
- 建立與上述契約對應的 negative fixtures，至少覆蓋缺少 source、外部或未追蹤 source、digest 不一致、無法回溯的 HTML-derived 欄位、錯誤的 policy provenance、base/head scope 不一致、HTML 與 production UI 混合變更、未知 changed path，以及缺少衍生 evidence。測試須證明這些輸入不會產生 product `passed`。
- 維持 design fidelity gate 與 functional/runtime E2E 為兩個獨立閘門；本 change 只規範 design-gate 的來源、分類與 fail-closed 語意，不宣稱任何 production screen、runtime 或 E2E 已完成。

## Capabilities

### New Capabilities

（無。本 change 不新增 capability。）

### Modified Capabilities

- `agent-operability-governance`：新增 design-gate governance 契約，要求使用 tracked `docs/plans/*.html` source-set，要求衍生 metadata 具備可驗證 provenance，要求以 base/head changed scope 產生明確分類，並對 unknown、drift、mixed、missing 或不可回溯狀態 fail closed。既有 A1–A10、frontend-operable、canonical deploy 與 ship-cycle 規則維持不變。

## Impact

- 變更 owner 限於 design-gate governance、`scripts/` 與 `scripts/tests/`；tracked HTML 僅作唯讀 source-set，不修改 HTML 內容。
- 不修改 production UI、frontend runtime、backend runtime、API contract、data schema、event contract、DB、MinIO/storage layout、session/conversion lifecycle、Kit、GPU、WebRTC 或 DataChannel。
- 不修改 `design-system-reference.manifest.json`、golden PNG、baseline、rebaseline 行為或 `web-viewer-sample/scripts/capture-design-system-reference.mjs`。
- 不承接或改寫 `migrate-console-to-hifi-design` task 6.4 human-owner 工作，不取代 PR #535，不處理 GPU/Kit/WebRTC，不新增 lineage UI 或 lineage runtime surface。
- 舊 `align-frontend-design-system-reference` 維持 deferred、frozen、non-canonical、non-owner；本 change 不直接 apply 舊 delta、不修改其 canonical spec 或 archive。
- API、data、event、storage、session、runtime boundaries 均為 no change；本 change 僅收斂 design-gate governance 與其 scripts/tests 可驗證語意。
