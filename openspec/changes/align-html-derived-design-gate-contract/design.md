# Design：HTML 衍生 Design Gate Source/Policy 契約

## Context

目前 design gate 由 `docs/plans/design-system-reference.manifest.json`、`scripts/lib/design-system-gate.ps1` 與相關驗證腳本共同運作；manifest 同時保存 reference inventory 與 engineering policy。現況缺少兩個可獨立驗證的基礎：HTML authority source set 尚未以 Git ref 綁定，engineering policy 也沒有 closed、versioned 的 repo authority。

本 change 是 frozen `align-frontend-design-system-reference` 的第一個窄版 successor，只建立 closed policy 與 ref-bound source collection。舊 change 維持 deferred、frozen、non-canonical、non-owner；本 change 不修改 design HTML、manifest、golden、baseline、capture/rebaseline 流程、classifier/status、consumer 或 production product。

目前由 `git ls-files -- 'docs/plans/*.html'` 得到的完整 source set 為：

| `source_id` | repo-relative path | `source_role` | 權威範圍 |
|---|---|---|---|
| `ai-bim-frontend-backend-design` | `docs/plans/AI-BIM 前後端設計文件.dc.html` | `architecture_behavior` | 服務邊界、route/IA、API/state 語意與交付規則 |
| `ai-bim-console-hifi` | `docs/plans/AI-BIM Console Hi-Fi.dc.html` | `console_hifi_visual` | Console chrome、layout、screen/component、interaction 與 visual state |

## Goals / Non-Goals

### Goals

- 以 Git-tracked `docs/plans/*.html` 建立唯一、base/head 可重建的 design source inventory。
- 將 engineering policy 放在 versioned、closed-schema 且無自我參照 digest 的 repo JSON。
- 對指定 ref 的 raw Git blob bytes 計算穩定 SHA-256，並保留 base-only deletion visibility。
- 以 focused fixtures 鎖定 valid policy/source collection 與 fail-closed 輸入。

### Non-Goals

- 不定義 field-level provenance registry、semantic locator 或 extractor contract。
- 不修改 `scripts/lib/design-system-gate.ps1` classifier、status enum 或 precedence。
- 不接線 PR-body、local preflight、gstack、visual-result 或其他 consumer。
- 不修改兩份 HTML、`design-system-reference.manifest.json`、golden PNG、baseline、rebaseline、capture script 或 production UI。
- 不變更 API、data/event schema、DB、storage、session/conversion lifecycle、deployment 或 runtime ownership。
- 不處理 `migrate-console-to-hifi-design` 的 human-owner task、PR #535、lineage UI、GPU、Kit、WebRTC 或 DataChannel。

## Decisions

### 1. Source inventory 只接受 Git-tracked HTML

Collector MUST 在 current checkout 以 `git ls-files -- 'docs/plans/*.html'` 取得 source set；對 base/head ref 則使用等價 Git tree query，不得用 working-tree directory scan。每個 tracked HTML 必須在 policy `sources` registry 有唯一 `source_id`、唯一 repo-relative path 與 `source_role`。

Base 已存在但 head 刪除的 source 仍須出現在 base/head collection result，避免刪檔繞過 scope。repo 外絕對路徑、origin projection、screenshot、PR prose、untracked file、ignored file 與人工 boolean 一律沒有 authority。新增、改名、刪除、未登錄或 role-ambiguous source 必須 fail closed。

**Rationale：** Git index/tree 是可重播的 ref-bound input，不受本機 ignored/untracked artifact 影響。

**Alternatives rejected：** 固定檔名會漏掉未來 tracked source；directory scan 會把 working-tree artifact 誤升格；repo 外 design origin 無法供 CI 與 reviewer 重播。

### 2. `scripts/config/design-gate-policy.json` 是 closed engineering policy

Policy 採 closed schema，至少包含：

- `schema_version`；
- 恰好兩筆初始 `sources` registry，每筆具有 `source_id`、repo-relative `path` 與 `source_role`；
- Windows/Chromium/DPR1、兩個 viewport、locale/timezone、font/animation 與 dependency/runtime pin；
- pixel comparison、anti-aliasing、semantic parity 與 full-completion eligibility policy。

初版 policy MUST 保留目前已驗證值：Windows `windows-2025`、Node `20.20.2`、npm `10.9.4`、Playwright `1.61.1`、Chromium revision `1228`／version `149.0.7827.55`、DPR1、`1440x900`／`1920x1080`、`zh-TW`、`Asia/Taipei`、fonts-ready、animations-disabled、pixelmatch threshold `0.1`、anti-aliasing excluded、max diff ratio `0.01` 與 semantic parity `1.0`。

Policy 不含 `policy_digest`，避免自我參照。JSON 缺 key、多未知 key、schema version 不支援、型別錯誤、重複 source ID/path/role 或無法解析時 fail closed。現有 manifest 在本 change 保持唯讀；重疊值的後續 migration 不屬於本 change。

### 3. Collection integrity 不等於 field-level provenance

Collector 對指定 Git ref 解析 commit 與 blob，直接對 raw Git blob bytes 計算 SHA-256；不得 hash working-tree bytes 或 caller 提供的內容。每筆 collection result 至少包含 source ID、role、repo-relative path、requested ref、resolved commit、blob OID 與 SHA-256。

這些欄位只證明 source collection 的 identity/integrity。本 change 不聲稱任何衍生 metadata 欄位已能回溯到 semantic locator，也不產生 provenance registry；該工作由 `align-html-derived-design-gate-provenance` 承接。

### 4. Fixtures 分離 policy 與 source 失敗面

Policy fixtures 至少涵蓋 valid policy、missing required key、unknown key、unsupported schema、wrong type、self-referential `policy_digest` 與 duplicate source identity。

Source fixtures 至少涵蓋 current/base/head valid collection、base-only deletion、external path、origin projection、untracked、ignored、unregistered、renamed 與 role-ambiguous HTML。每個 negative fixture 必須比對 exact failure code/message，且證明 collector 不會輸出成功 eligibility。

Excluded-file guard 必須證明本 change 未修改 HTML、manifest、golden、baseline、capture 或 rebaseline surface。

### 5. Runtime 與 GPU/Kit 邊界不變

本 change 的 apply/validation 只觸及 design-gate governance config、source collector 與 tests。API、storage、session、conversion、Kit runtime、WebRTC/DataChannel 與 GPU rendering 均不在 execution path，因此相關 runtime checks 為 N/A；N/A 不得被報告為 runtime/product pass。若 diff 越界，必須停止並另開 successor。

## Risks / Trade-offs

- **Policy 暫時與 manifest 有重疊值。** 本 change 不建立雙向同步或改寫 manifest；後續 consumer/migration successor 才能處理重疊。
- **Git blob digest 比 working-tree hash 複雜。** 換取跨 Windows checkout 與換行設定的一致性；測試需證明 CRLF working tree 不改變 ref-bound digest。
- **新增 tracked HTML 會先被阻擋。** 這是刻意的治理成本；先在 policy 登錄 stable identity/role，再讓 source 進入 collection。

## Migration Plan

1. 新增 closed-schema policy 與 schema fixtures；manifest、golden、capture/rebaseline 保持唯讀。
2. 新增 ref-bound source collector 與 current/base/head fixtures；驗證 raw Git blob digest、base-only deletion 與 untrusted-source rejection。
3. 執行 affected tests、OpenSpec strict validation、GitNexus detect-changes（若圖譜可用）與 excluded-file guard；失敗時回退個別 task commit。

## Future successors（尚未建立）

- `align-html-derived-design-gate-provenance`：field-level provenance registry、semantic locator 與 provenance negative fixtures。
- `align-html-derived-design-gate-classifier-status`：base/head classifier、八值 status 與 atomic legacy migration。
- `align-html-derived-design-gate-typed-consumers`：PR/local/gstack/visual consumers、design/runtime independence 與 final verification reporting。

上述 successors 不屬於本 change；本 change 不宣稱它們已實作或驗證完成。
