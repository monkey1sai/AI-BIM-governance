# Design：HTML 衍生 Design Gate 契約

## Context

目前 design gate 由 `docs/plans/design-system-reference.manifest.json`、`scripts/lib/design-system-gate.ps1` 與相關驗證腳本共同運作；manifest 同時保存 reference inventory、change-scope 規則與 engineering policy。現有 classifier 已使用 base/head manifest 聯集，但仍有三個契約缺口：HTML authority source set 未被獨立驗證、衍生欄位沒有 field-level provenance、status enum 仍含 legacy `reference_authority_mixed_fail_closed` 且缺少獨立的 design-source-only 狀態。

本 change 是 frozen `align-frontend-design-system-reference` 的窄版 successor，只建立 source inventory、policy、provenance 與 classifier 的可實作設計。舊 change 維持 deferred、frozen、non-canonical、non-owner；本 change 不修改 design HTML、manifest、golden、baseline、capture/rebaseline 流程或 production product。

目前由 `git ls-files -- 'docs/plans/*.html'` 得到的完整 source set 為：

| `source_id` | repo-relative path | `source_role` | 權威範圍 |
|---|---|---|---|
| `ai-bim-frontend-backend-design` | `docs/plans/AI-BIM 前後端設計文件.dc.html` | `architecture_behavior` | 服務邊界、route/IA、API/state 語意與交付規則 |
| `ai-bim-console-hifi` | `docs/plans/AI-BIM Console Hi-Fi.dc.html` | `console_hifi_visual` | Console chrome、layout、screen/component、interaction 與 visual state |

## Goals / Non-Goals

### Goals

- 以 Git-tracked `docs/plans/*.html` 建立唯一、base/head 可重建的 design source inventory。
- 將 engineering policy 移到 versioned、可驗證且無自我參照 digest 的 repo policy。
- 要求 HTML-derived 與 policy-derived 欄位具備 machine-resolvable provenance；drift 或不可回溯時 fail closed。
- 以 base/head source、policy 與 changed paths 聯集產生 exact status enum，保留合法 backend-only N/A，並禁止 source/product moving-goalpost PR。
- 以 positive/negative fixtures 鎖定 source inventory、provenance、分類 precedence 與 legacy status rejection。

### Non-Goals

- 不修改兩份 HTML 的內容、stable IDs 或視覺設計。
- 不修改 `design-system-reference.manifest.json`、golden PNG、baseline、rebaseline、capture script 或 production UI。
- 不變更 API、data/event schema、DB、storage、session/conversion lifecycle、deployment 或 runtime ownership。
- 不處理 `migrate-console-to-hifi-design` 的 human-owner task、PR #535、lineage UI、GPU、Kit、WebRTC 或 DataChannel。
- 不以 design fidelity evidence 取代 functional/runtime E2E，也不宣稱任何 product screen 或 runtime 已完成。

## Decisions

### 1. Source inventory 只接受 Git-tracked HTML

Validator MUST 分別在 base 與 head ref 以 Git index/tree 語意解析 `docs/plans/*.html`，不得用 working-tree directory scan。每個 tracked HTML 必須在 policy 的 `sources` registry 有唯一 `source_id`、唯一 path、`source_role` 與允許的 derivation contract；新增、刪除、改名或未登錄 source 都必須由 base/head 聯集看見。repo 外絕對路徑、origin projection、screenshot、PR prose、untracked file 與人工 boolean 一律沒有 authority。

新增 tracked HTML 若尚未登錄 source role 或無法確定性抽取，結果為 `unknown_fail_closed`；不得靜默忽略。Base 已存在但 head 刪除的 source 仍由聯集保留，避免刪檔繞過 scope。

**Rationale：** `git ls-files`／Git tree 能建立可重播的 ref-bound input，且不受本機 ignored/untracked artifact 影響。

**Alternatives rejected：** 固定兩個檔名會漏掉未來 source；directory scan 會把 untracked 檔案誤升格；repo 外 design origin 無法供 CI 及 reviewer 重播。

### 2. `scripts/config/design-gate-policy.json` 是 v2 engineering policy authority

新增的 versioned JSON policy 採 closed schema，至少包含：

- `schema_version` 與完整、ordered status enum；
- `sources` registry 及 source role；
- product、reference-missing、gate-infrastructure、allowed derivative 與 non-product path ownership rules；
- Windows/Chromium/DPR1、兩個 viewport、locale/timezone、font/animation、dependency/runtime pin；
- pixel comparison、semantic parity、dynamic mask 與 live-surface rules。

初版 policy MUST 將現有 manifest 已驗證的 engineering values 原樣搬入，包括 Windows `windows-2025`、Node `20.20.2`、npm `10.9.4`、Playwright `1.61.1`、Chromium revision `1228`／version `149.0.7827.55`、DPR1、`1440x900`／`1920x1080`、`zh-TW`、`Asia/Taipei`、fonts-ready、animations-disabled、pixelmatch threshold `0.1`、anti-aliasing excluded、max diff ratio `0.01` 與 semantic parity `1.0`。現有 manifest 在本 change 不改寫；重疊欄位視為 compatibility derivative，validator 必須與 policy 做 exact equality，drift 即 fail closed。

Policy 本身不含 `policy_digest`，避免自我參照。Digest 定義為指定 Git ref 中該 policy blob 原始 bytes 的 SHA-256，而非 working-tree bytes；所有衍生 evidence 記錄 `policy_path`、ref/commit、digest 與使用的 policy key。Policy JSON 缺 key、多未知 key、schema version 不支援或無法解析時 fail closed。

**Rationale：** 將 policy 與 reference inventory 分離，可在不修改 manifest/golden 的前提下建立單一 v2 policy authority；Git blob digest 也不受 Windows checkout 換行影響。

**Alternatives rejected：** 繼續把 policy 埋在 manifest 會混淆需求衍生物與工程規則；在 policy 內保存自身 digest 無法形成穩定封閉值；只 hash parsed JSON 會要求額外、跨語言一致的 canonical-JSON 實作。

### 3. Provenance 使用可共用、field-addressable records

Classifier/validator 的機器輸出必須提供 provenance registry；每個 HTML-derived 或 policy-derived field 以 `provenance_id` 指向一筆 record，避免複製整份 metadata。HTML record 至少包含：

- `source_id`、`source_role`、repo-relative `source_path`；
- source ref、resolved commit 與 Git blob bytes SHA-256；
- `locator_kind`／`locator_value`（stable semantic ID、selector 或明確 section locator）；
- extractor/schema version 與 derivation kind。

Policy record 至少包含 `policy_path`、ref、resolved commit、policy digest 與 exact policy key。每個受治理欄位都必須能由 field path 追到正確類型 record；source/policy 類型混淆、locator 不存在、digest drift、ref/commit 不一致、未知 source 或 dangling `provenance_id` 一律 fail closed。

Provenance evidence 是 validator/classifier 的輸出或 fixture，不要求在本 change 改寫 manifest。後續若要把 registry 持久化進 manifest，必須另開 successor。

### 4. Scope classifier 使用 base/head 聯集與固定 precedence

Classifier MUST 同時載入 base/head 的 source inventory、policy、ownership mapping 與 changed paths；刪除或改名不得只看 head。Canonical enum 恰為以下八值，consumer 不得接受自由文字或未知值：

1. `passed`
2. `mixed`
3. `partial_reference_missing`
4. `design_source_update_only`
5. `gate_infrastructure_only`
6. `design_source_and_product_mixed_fail_closed`
7. `unknown_fail_closed`
8. `not_applicable`

判定 precedence 固定如下：

1. policy/source/provenance/evidence 無法驗證、changed path 無 owner、或 path 組合不在契約矩陣時，為 `unknown_fail_closed`。
2. 同一 change 同時含 tracked authority HTML 與 production UI path 時，為 `design_source_and_product_mixed_fail_closed`，不受 approved/missing 比例影響。
3. Product scope 同時有 approved surface 與 reference-missing surface（包含 approved surface 宣告會連帶影響 missing route）時，為 `mixed`。
4. Product scope 只有 approved surface 時，為 `passed`。
5. Product scope 只有 reference-missing surface 時，為 `partial_reference_missing`。
6. 無 product path，且只含 tracked authority HTML、其允許的 derivative 與必要 gate infrastructure 時，為 `design_source_update_only`。
7. 無 HTML/product path，且只含 gate infrastructure 時，為 `gate_infrastructure_only`。
8. 其餘已明確登錄、與 design 無關的 backend/docs-only scope，為 `not_applicable`。

`passed` 是唯一可讓 full completion 進入後續 evidence 判定的 status，但仍不是充分條件：pixel、semantic、functional/runtime 與其他適用 gates 必須各自通過。`mixed` 與 `partial_reference_missing` 可支援誠實局部工作，但 `Full completion claimed=no`。`design_source_update_only`、`gate_infrastructure_only` 與 `not_applicable` 都不是 product design pass；其中 `not_applicable` 是合法 N/A，不得誤報為 failure 或 pass。

### 5. Legacy status 必須原子遷移

現行 `reference_authority_mixed_fail_closed` 在同一 implementation change 中改為 `design_source_and_product_mixed_fail_closed`。`scripts/lib/design-system-gate.ps1`、直接 consumer、PR/evidence validators 與 fixtures 必須在同一 commit set 使用新 enum；negative test 必須證明 legacy value 與任意 unknown value 都被拒絕。不得提供同時接受新舊值的 compatibility window。

**Rationale：** enum 是 machine contract；雙接受會讓不同 consumer 對相同 PR 產生不同 verdict。

### 6. Validator、classifier 與 consumer 保持單向依賴

責任邊界為：

```text
Git base/head trees
  -> policy/source validator
  -> provenance validator
  -> base/head scope classifier
  -> PR body / local preflight / CI consumers
```

Consumer 只能使用已驗證的 typed output，不得自行重做 source discovery、覆寫 status 或以 PR prose 補缺 evidence。`scripts/lib/design-system-gate.ps1` 維持 classifier owner；`scripts/tests/verify-design-system-reference.ps1` 與 scope/PR-body/visual-result tests 驗證 policy、provenance及 consumer contract。任何 consumer 收到缺欄、invalid enum 或 validator failure 都必須 fail closed。

### 7. Fixtures 鎖定成功面與失敗面

Positive fixtures 至少涵蓋八個 status 的合法輸入，其中 `passed` 必須是全 approved product scope，`not_applicable` 必須是已登錄 backend-only scope。Negative fixtures 至少涵蓋：missing/untracked/external source、source rename/delete 漏看 base、HTML/policy digest drift、未知或缺失 policy key、dangling/wrong-kind provenance、locator 不存在、base/head ownership 不一致、HTML+product moving goalpost、unknown changed path、missing evidence、legacy status 與 arbitrary status。

每個 negative fixture 都要明確證明不會得到 `passed`；應 fail closed 的 fixture 還要比對 exact error/status，而非只比對 non-zero exit。

### 8. Runtime 與 GPU/Kit 邊界不變

本 change 的 apply/validation 只觸及 design-gate governance scripts、config 與 tests。API、storage、session、conversion、Kit runtime、WebRTC/DataChannel 與 GPU rendering 均不在 execution path，因此 GPU/Kit/WebRTC 驗證為 **N/A**，不得由此 change 宣稱 first-frame、stage、ack 或 runtime pass。若實作 diff 實際越界，必須停止並另開 successor，而不是擴張本 change。

## Risks / Trade-offs

- **Policy 暫時與 manifest 有重疊欄位。** 以 exact-equality validator 防止雙寫漂移；移除 manifest duplicate 是獨立 successor。
- **Git blob digest 實作較 working-tree hash 複雜。** 換取跨 Windows runner 與 checkout 設定的一致性；測試要覆蓋 CRLF working tree 不改變 ref-bound digest。
- **Field-level provenance 增加輸出體積。** 以 registry + `provenance_id` 去重，同時保留可稽核性。
- **Atomic enum rename 會讓舊 consumer 立即失效。** 以 repo-wide exact search、consumer tests 與單一 commit set 收斂；不保留模糊相容期。
- **Fail-closed 會阻擋新 HTML 或新 frontend root。** 這是刻意的治理成本；先登錄 role/ownership 與 fixtures，再讓新 scope 取得 product eligibility。

## Migration Plan

1. 新增 closed-schema `scripts/config/design-gate-policy.json`，登錄目前兩份 tracked HTML 及既有 engineering values；新增 policy/source inventory validator 與 positive/negative fixtures。
2. 新增 ref-bound Git blob digest 與 provenance registry 輸出，驗證 HTML-derived／policy-derived field mapping；保持 manifest、golden 與 capture/rebaseline 檔案不變。
3. 擴充 `scripts/lib/design-system-gate.ps1` 使用 base/head validated inputs 與八值 precedence；在同一 commit set 原子更新 enum consumers並加入 legacy rejection test。
4. 更新 scope、PR-body、reference、visual-result 與 lifecycle-related tests，執行 affected PowerShell tests、OpenSpec strict validate、GitNexus detect-changes 與 repo lifecycle checks。
5. 若任一 validation 失敗，回退該 implementation commit set即可恢復舊 classifier；本 change 無 DB/data migration、無 runtime state rollback、無 golden/rebaseline rollback。

## Open Questions

本 successor 沒有阻擋實作的 open question。下列事項明確留給後續、互不重疊的 successor：

- manifest provenance registry 的持久化與移除重複 policy 欄位；
- HTML source/rebaseline lane 與 golden migration；
- `migrate-console-to-hifi-design` human-owner 裁決；
- RVT↔IFC↔USDC lineage product surfaces，以及本機 GPU/Kit/WebRTC runtime 驗證。
