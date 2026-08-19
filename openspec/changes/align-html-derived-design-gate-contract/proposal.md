# 變更：建立 HTML 衍生 Design Gate 契約

> 所屬：`AI-BIM-governance` workspace；owner：design-gate governance、`scripts/`、`scripts/tests/`。

## Why

目前 repo 已採 `docs/plans/*.html` 作為設計需求的 doc-first 來源，但 design gate 尚缺一份可機器驗證的 HTML source-set 與 closed engineering policy。結果可能把 repo 外路徑、origin projection、未追蹤或 ignored 檔案、PR prose 或 working-tree bytes 誤當成設計權威，且 base 已存在但 head 刪除的 source 可能逃過審核。

`align-frontend-design-system-reference` 仍是 deferred、frozen、non-canonical、non-owner。其 successor crosswalk 已裁決 HTML-derived gate 必須另開 successor，且不得夾帶 `migrate-console-to-hifi-design` 的產品換皮、human-owner 工作或 #535 rebaseline 修復。為符合固定 40-call 執行上限，本 change 只承接 closed policy 與 ref-bound source collection；provenance、classifier/status 與 typed consumers 各自留給後續互不重疊的 successor。

## What Changes

- 新增 closed-schema `scripts/config/design-gate-policy.json`，登錄兩份 tracked HTML 的 stable source ID、repo-relative path、unique role，並保留目前已驗證的 Windows/Chromium、viewport、locale/timezone、pixel 與 semantic engineering values。
- 將 current checkout 的 source set 定義為 `git ls-files -- 'docs/plans/*.html'` 的 Git-tracked 結果；base/head 使用等價 Git tree query，保留 base-only deletion visibility。
- 對指定 ref 的 raw Git blob bytes 計算 SHA-256，輸出 source ID、role、path、resolved ref/commit 與 digest 作為 collection integrity data。本 change 不定義 field-level provenance。
- 以 schema 與 source fixtures 證明 missing/unknown policy key、external/origin-projected/untracked/ignored/unregistered/role-ambiguous source 皆 fail closed，且不會寫入 manifest、golden、baseline、capture 或 rebaseline surface。

## Capabilities

### New Capabilities

（無。本 change 不新增 capability。）

### Modified Capabilities

- `agent-operability-governance`：新增 design-gate source/policy governance 契約，要求 closed engineering policy、tracked `docs/plans/*.html` source-set、ref-bound raw-blob digest 與 base-only deletion visibility；無法驗證時 fail closed。既有 A1–A10、frontend-operable、canonical deploy 與 ship-cycle 規則維持不變。

## Impact

- 變更 owner 限於 design-gate governance、`scripts/config/`、source collector 與 `scripts/tests/`；tracked HTML 僅作唯讀 source-set，不修改 HTML 內容。
- 不修改 production UI、frontend runtime、backend runtime、API contract、data schema、event contract、DB、MinIO/storage layout、session/conversion lifecycle、Kit、GPU、WebRTC 或 DataChannel。
- 不修改 `design-system-reference.manifest.json`、golden PNG、baseline、rebaseline 行為或 `web-viewer-sample/scripts/capture-design-system-reference.mjs`。
- 不承接或改寫 `migrate-console-to-hifi-design` task 6.4 human-owner 工作，不取代 PR #535，不新增 lineage UI 或 lineage runtime surface。
- 舊 `align-frontend-design-system-reference` 維持 deferred、frozen、non-canonical、non-owner；本 change 不直接 apply 舊 delta、不修改其 canonical spec 或 archive。
- 不實作 field-level provenance registry、`design-system-gate.ps1` classifier/status、PR-body/local-preflight/gstack/visual-result consumers；它們分別屬於 `align-html-derived-design-gate-provenance`、`align-html-derived-design-gate-classifier-status` 與 `align-html-derived-design-gate-typed-consumers`。
- API、data、event、storage、session、runtime boundaries 均為 no change；GPU、Kit、WebRTC、first-frame、stage 與 DataChannel 對本 governance-only change 為 N/A，但 N/A 不代表 runtime/product pass。
