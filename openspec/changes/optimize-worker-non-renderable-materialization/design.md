## Context

`optimize-worker-source-entity-enumeration` has been completed: the 89MB canonical fixture enumerates 1,604,773 IFC entities in ~33.2s with `fallback_used=false`, and `source_entity_enumeration` is no longer the timeout phase. The next observed blocker is `_worker`-owned `non_renderable_entity_materialization`. Inside `_materialize_unmapped_entities` (`_worker/app/converters.py:640`), every unmapped source IFC entity becomes a USD `Xform` prim with six attributes (`ifc:entityKey`, `ifc:entityId`, `ifc:guid`, `ifc:type`, `ifc:name`, `worker:nonRenderableIfcEntity`). At ~1.5M unmapped entities, Python-level USD authoring exceeds the remaining per-fixture timeout budget.

The current baseline requirement in `openspec/specs/worker-artifact-pipeline/spec.md` is strict: "_worker MUST materialize every IFC entity as a USD prim with stable traceability". This change re-opens that requirement so the carrier of non-renderable IFC entity identity can be either a USD prim or a sidecar mapping artifact, but never at the cost of dropping the all-entity coverage denominator or IFC traceability fields.

The affected ownership boundary remains `_worker`: file bytes, object URLs, conversion jobs, converter diagnostics, mapping output, artifact groups, and verification evidence. `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` remain downstream consumers that only see `_worker`'s artifact group after conversion succeeds.

## Goals / Non-Goals

**Goals:**

- Make `non_renderable_entity_materialization` measurable enough to distinguish USD authoring cost from identity-write cost.
- Optimize the materialization path so the canonical `--limit 1` 89MB fixture produces `model.usdc` within the configured 600s per-fixture timeout.
- Preserve all-IFC-entity coverage semantics: every source IFC entity remains in `coverage_denominator=source_ifc_entity_count` and keeps stable IFC traceability fields.
- Keep conversion result, quality metrics, lineage, artifact group readiness, and review viewer handoff backward-compatible. Any new fields are additive optional diagnostics.
- Permit (but do not mandate) shifting the non-renderable IFC entity carrier from USD prims to a sidecar mapping artifact, with a clearly documented downstream handoff.
- Record before/after evidence and update roadmap/verification docs without claiming `minimum_coverage_locked=true` prematurely.
- Secondary: where it can be done safely, reduce `guid_extraction` / `name_extraction` cost in source enumeration so the combined burn-down is meaningful at full-batch scale.

**Non-Goals:**

- No changes to `_bim-control` metadata authority, coordinator session lifecycle, web viewer rendering, Kit runtime, WebRTC, GPU provisioning, auth, or production deployment.
- No switch to a different converter stack unless explicitly justified by measured evidence and approved as a separate dependency decision.
- No weakening of coverage by counting only renderable geometry, `IfcProduct`, or GUID-bearing entities.
- No full production batch-job scheduler; this remains a local canonical verification helper path.
- No changes to `web-viewer-sample` highlight / focus contracts; if the carrier moves, the viewer must keep current `primary_usd_prim_path` / `usd_prim_paths` shape for renderable mapped entries.

## Optimization Options Considered

`_materialize_unmapped_entities` 先前執行的是每個 entity 逐一呼叫 USD 層級的 O(N) Python 迴圈。下方選項在 `/opsx:explore` 階段作為**測量前假說**提出，並於 §2 baseline 剖析測量後標注了對應效果（見「Baseline-annotated effect」欄）。最終選擇記錄在下方的「Selected Option(s)」小節；canonical baseline 顯示 `xform_define_seconds=365.5s`（materialization 的 97.4%）後，**選定 Option 4（sidecar carrier）+ Option 3（chunked progress writes）**。Option 1 因即使 5× ChangeBlock 提升後投影仍超過 600s budget 而被排除。此表作為測量前考量選項的稽核紀錄保留於本文件，不代表仍在審議中的決策。

| # | Approach (hypothesis) | Coverage impact | Streaming impact | Baseline-annotated effect | Notes |
|---|----------------------|----------------|------------------|---------------------------|-------|
| 1 | `Sdf.ChangeBlock` + direct `Sdf.PrimSpec` / `Sdf.AttributeSpec` instead of `UsdGeom.Xform.Define` + `CreateAttribute` | None | None | **高度改善，主要目標。** Baseline 測得 `xform_define_seconds=365.5s`（375s materialization 中 69,189 個 entity 的 97.4%）；`attribute_write_seconds=8.2s`（2.2%）。瓶頸在 schema 層級的 `Xform.Define` + `CreateAttribute` notification 成本，正是 `Sdf.ChangeBlock` + `Sdf.PrimSpec` 設計用來繞過的模式。即使保守估計 5× 吞吐量提升，1.5M entity 的投影仍需 ~1,690s；加上 option 3 chunking 與現有 geometry / enumeration 時間（~225s），剩餘 600s budget 仍然很緊，但這是唯一針對實測瓶頸的 USD-prim 內部路徑。 | USD 內部優化。保持 stage 形狀與下游 contracts。最低 blast radius。 |
| 2 | Flat container under a single `Scope` prim with deterministic prim names; collapse `_unique_prim_path` set-membership cost | None on coverage; prim path strings change | Path string changes for non-renderable prims (irrelevant to viewer if those prims were not highlighted) | **低度改善。** Baseline `unique_prim_path_seconds=0.5s`（materialization 的 0.13%）。Set membership 並非瓶頸所在。 | 對走訪 USD stage tree 並假設現有前綴的消費端有中度風險。單獨不值得引入 prim-path 的大幅變動。 |
| 3 | Chunked authoring with progress writes (e.g. flush per N entities), allowing resumable / diagnosable progress | None | None | **已部分實作。** Progress write 在 192 次發布中花費 `0.28s`。搭配 option 1 可保持可診斷性，自然契合 `Sdf.ChangeBlock` 在退出時 flush notification 的特性；chunked block 可提供增量進度回報。單獨不提升吞吐量。 | 可診斷性 + 有界的 `ChangeBlock` 大小。 |
| 4 | Sidecar carrier: non-renderable IFC entity identity is written to `element_mapping.json` (or a new `entity_index.json` artifact) and is not authored into the USD stage; USD stage only contains renderable + mapped prims | None on denominator, but mapping artifact takes the carrier role | Streaming server no longer sees non-renderable prims (they were never rendered anyway); coordinator/viewer still get full coverage data via mapping artifact | **純吞吐量最高改善** — 消除所有 1.5M 個 `UsdGeom.Xform.Define` 呼叫。以次秒級 JSON dump 取代 365s+ 的 USD authoring 迴圈。 | **此 change 已選用**（搭配 Option 3 chunked progress writes）。Carrier-shift Handoff Framework 已依實際 coordinator/viewer/streaming source 填寫完成。新 `entity_index.json` artifact 已在 lineage 中登記；舊版 `usd_prim` carrier 透過 `materialization_strategy="usd_prim"` 保留為 opt-in 回歸測試選項。 |
| 5 | Secondary: reduce `guid_extraction` / `name_extraction` cost in source enumeration by reusing IfcOpenShell attribute access patterns or caching schema lookups | None, must keep ifc_guid / name fidelity | None | **邊際改善。** Baseline `guid_extraction=10.6s + name_extraction=10.0s ≈ 20.6s`，占 27.4s enumeration 的一部分。即使減半也只省 ~10s — 相對 365s 的主要瓶頸微乎其微。 | 屬次要範疇 §4；從未阻塞主要 burn-down。除非 option 1 成功且仍有餘裕，否則延後處理。 |

Option (4) 是純吞吐量面向最具潛力的假說，但也是唯一跨越 artifact-carrier 邊界的選項。選擇 MUST 以完成下方 Carrier-shift Handoff Framework 為前提。

## Selected Option(s)

**選定：Option 4（sidecar carrier）+ Option 3（chunked progress writes）。**

### Baseline profile citations

來自 canonical `--limit 1 --timeout-seconds 600 --profile-source-entities` 的執行結果，fixture 為 `許良宇圖書館建築_2026 - 複製 (10).ifc`（89,394,282 bytes，`conversion_job_id=conv_20260513102219_4c543c8f`，`artifact_group_id=ag_ec7eda49abf7`，`source_artifact_id=artifact_src_17f2e857a8ff`）：

- `non_renderable_entity_materialization` 在 `375.09s` 時 timeout，已 materialize `1,604,773` 個 entity 中的 `69,189` 個。以此速度完成全部 entity 的投影時間：**~8,160s（超出 600s budget 的 13.6 倍）**。
- materialization 內部逐操作拆解：
  - `xform_define_seconds = 365.48s` — **佔整個 phase 的 97.4%**。這是每個 prim 的 `UsdGeom.Xform.Define` schema 層級 notification + `Tf` notice 來回成本。
  - `attribute_write_seconds = 8.19s` — 2.2%。
  - `unique_prim_path_seconds = 0.51s` — 0.13%。
  - `row_append_seconds = 0.14s`、`mapping_append_seconds = 0.17s`、`progress_write_seconds = 0.28s` — 可忽略不計。
  - `sidecar_append_seconds = 0.0s` — baseline 未執行 sidecar 路徑。（在 post-change 執行中，此欄位測量記憶體內 list/dict append 成本；實際的 `entity_index.json` JSON dump 另以 `quality_metrics.sidecar_write_seconds` 單獨追蹤。）
- Source enumeration 在 `27.38s` 內完成，其中 `guid_extraction = 10.61s`、`name_extraction = 10.05s`、`iteration = 2.25s`（共 1,604,773 個 entity）。將 `guid_extraction + name_extraction` 減半約可節省 ~10s — 相對 365s 的主要瓶頸微乎其微。

### Expected win (sidecar path)

Sidecar carrier 以一次性批次寫入將 1.5M 個 entity 條目寫入 JSON artifact（`entity_index.json`）。預估 wall time：**< 5s**（~1.5M 筆小型記錄的 JSON encode 受 I/O 而非每筆 record 的開銷限制）。這完全消除了 365s 的 `Xform.Define` 迴圈，使 materialization phase 縮短至走訪 `source_entities` + 寫入一個 JSON 檔案的時間（目標：合計 < 10s）。全 fixture 轉換預估：`ifc_open (4.3s) + source_entity_enumeration (27.4s) + geometry_iteration (190.9s) + mesh_authoring (8.1s) + non_renderable_entity_materialization (<10s) + stage_save + stage_reopen ≈ 240–260s`，遠在 600s budget 之內。

### Rejected options

- **Option 1（`Sdf.ChangeBlock` + `Sdf.PrimSpec`）** — 即使在 `xform_define_seconds` 樂觀估計 10× 加速下，69k entity 的投影 materialization 時間約為 ~37s，換算至 1.5M entity 為 ~860s，仍超出 600s budget。提升確實，但不具決定性保障。
- **Option 2（flat `Scope` prim path 壓縮）** — 所優化的實測成本為 `unique_prim_path_seconds = 0.51s`（0.13%）。改善可忽略不計；徒增 prim-path 變動，毫無實測收益。
- **Option 5（次要 `guid_extraction` / `name_extraction` 優化）** — 實測潛在節省約 10s，在主要 burn-down 落地後延後至 §4 follow-up；除非 canonical 重跑後仍有餘裕，否則不在此 change 內執行。

### Combination notes

- **Option 3（chunked progress writes）** 保留，因為 §2.1 中已加入的每 entity 診斷路徑（`materialized_entity_count`、`last_operation`、`elapsed_seconds`、`progress_write_count`）已存在並可在 sidecar 路徑中重用。Sidecar carrier 仍走訪 `source_entities` 並回報進度；per-batch 寫入是最後的一次性 JSON dump。
- 此 change **不在** code 中啟用 Option 1。若未來有 evidence 顯示 sidecar 路徑不足（例如較大 fixture 的 JSON encode > 30s），`Sdf.ChangeBlock` 仍作為可重用假說保留在此表中。

## Carrier-shift Handoff Framework — Answers for this change

選定路徑為 **Option 4（sidecar carrier）**。以下具體回答已於 2026-05-13 對照現行 source 驗證。

### Coordinator side (`bim-review-coordinator`)

- **coordinator 是否消費 `usd_prim_count` 或假設存在 non-renderable USD prim？**
  - **否。** `bim-review-coordinator/src/types.ts:87` 在 `DemoMappingItem` 上宣告 `usd_prim_path?: string | null`（可選）。`src/` 中未消費任何 `usd_prim_count`。coordinator 不迭代 USD stage，也不在 server 端枚舉 non-renderable entity。
  - **是否需要新欄位？** 否。`quality_metrics` 中的 `materialization_strategy` 已足夠；coordinator 直接傳遞 `quality_metrics` 而不做語意轉換。
- **coordinator 是否廣播/持久化任何假設 entity 具有 USD prim path 的 IFC-entity-keyed 事件？**
  - **否。** `dev-console.js:159` 僅在測試鷹架中使用常數 `"/World"` 作為 `usd_prim_path` 的佔位符。實際 review 事件透過 `socket.io` 傳遞，承載來自上游 payload 的 `ifc_guid` / `usd_prim_path`；若 `usd_prim_path` 為 null，下游消費端以 `ifc_guid` keying 為 fallback。
- **artifact group readiness API 是否需要新 flag 來標示 carrier 選擇？**
  - **否。** `model_usdc`、`ifc_index`、`usd_index`、`element_mapping` 的現有 readiness checks 不變。`entity_index` 在 lineage graph 與 readiness check 中作為額外 derived artifact 新增。`quality_metrics` 中的 `materialization_strategy=sidecar` 是充分訊號。

### Viewer side (`web-viewer-sample`)

- **viewer 目前在何處呈現 non-renderable IFC entity？**
  - **不以獨立列表呈現。** `web-viewer-sample/src/Window.tsx:894` 讀取 `element_mapping.json` 並顯式過濾：`payload.items.filter((item) => Boolean(item['usd_prim_path']))`。沒有 `usd_prim_path` 的項目會被從可選 highlight 列表中移除。目前的 non-renderable USD prim（在現有實作下確實攜帶 `usd_prim_path`）通過此過濾器，但不在 non-renderable 專屬 UI 中呈現。
- **若 viewer 迭代 USD stage 以枚舉 non-renderable entity，替代路徑為何？**
  - **不適用。** viewer 目前不迭代 USD stage 進行枚舉。DataChannel `getChildrenRequest` flow 僅在使用者主動展開 tree 時走訪 USD stage；從 stage 消失的 non-renderable prim 不會出現在 tree 展開中，符合目前 viewer 行為（tree 中的 non-renderable 項目原本就沒有 highlight 目標）。
- **目前是否有 DataChannel command 假設 non-renderable prim 存在？**
  - **否。** `Window.tsx:846-947` 顯示 highlight flow 在發送 `highlightPrimsRequest` 前會對 `usd_prim_path` 做 truthiness guard。沒有 `usd_prim_path` 的 issue 與 mapping item 今日以「不發送 DataChannel」分支處理。
- **sidecar 路徑對 viewer 的淨影響：** viewer 現有過濾器能正確處理缺失的 `usd_prim_path`。sidecar 上線不需要任何 viewer 程式碼變更。新的 `entity_index.json` artifact 可透過 lineage 取得，若未來 viewer feature 需要在 tree view 中呈現 non-renderable 條目，但這超出此 change 範疇。

### Streaming side (`bim-streaming-server`)

- **Kit runtime 是否依賴 non-renderable prim 進行 traversal、selection routing 或 metadata lookup？**
  - **否。** 在 `bim-streaming-server/source` 中執行 `grep -ri "non_renderable\|element_mapping\|usd_prim_path"` 回傳零結果。Kit 按照 `_worker` 撰寫的方式載入 USD stage 並渲染 renderable prim；今日 stage 中存在的 non-renderable prim 在渲染層面是惰性的。
- **移除 non-renderable prim 後 USDC stage 開啟時間是否有實質改善？**
  - **可能是，但此處未測量。** 從 `model.usdc` 移除 ~1.5M 個 `Xform` prim 將減小檔案大小與 stage 開啟時的 prim 數。可在 post-change 的 `stage_reopen` 計時中測量。
- **`highlightPrimsRequest` 是否需要對無 prim 的 entity 提供 fallback？**
  - **不需要新 fallback。** viewer 對於沒有 `usd_prim_path` 的 entity 本已不發送 `highlightPrimsRequest`（見上方 Window.tsx guard）。
- **sidecar 路徑對 streaming 的淨影響：** 不需要變更。Stage 縮小；`getChildrenRequest` 回傳更少的 non-renderable 節點（符合新的 authoritative 事實）。

### Sidecar artifact contract for this change

- **Filename / object key：** `entity_index.json`，寫在 `model.usdc`、`ifc_index.json`、`usd_index.json`、`element_mapping.json` 的 derived object prefix 下方。
- **Artifact id：** `artifact_entity_index_<job-suffix>`（符合現有命名模式）。
- **Lineage：** 以 `kind=entity_index` 節點新增，從 `model_usdc` 延伸出 `has_sidecar` 邊，在 conversion result 中透過 `derived_artifact_ids.entity_index` 與 `entity_index_url` 呈現。
- **Schema (sidecar entries):**
  ```json
  {
    "mapping_method": "ifc_entity_to_sidecar_index",
    "materialization_strategy": "sidecar",
    "source_artifact_id": "<source artifact id>",
    "entities": [
      {
        "ifc_entity_key": "...",
        "ifc_entity_id": "...",
        "ifc_guid": "..." | null,
        "ifc_class": "...",
        "name": "...",
        "renderable": false
      }
    ],
    "summary": {
      "sidecar_entity_count": N
    }
  }
  ```
- **Coverage accounting：**
  - `mapped_count = mapped_renderable_count + sidecar_carrier_count`
  - `usd_prim_count` 僅計算 USD stage prim（renderable + 結構性根節點如 `/World`），不包含僅在 sidecar 中的 entity。
  - `coverage_denominator = source_ifc_entity_count`，不變。
  - `coverage_ratio = mapped_count / source_ifc_entity_count`。

## Decisions

1. **Profile before optimizing.**
   - Rationale: the current evidence identifies `non_renderable_entity_materialization` as the timeout phase, but does not yet isolate USD-level authoring cost versus identity-write cost. A baseline profile is required before selecting an option from the table above.
   - Approach: instrument `_materialize_unmapped_entities` to record per-batch authoring time and entity throughput (always-on, low overhead) and optional per-call USD authoring profile under the verification profiling flag. The first implementation task produces a repeatable canonical baseline.
   - Alternative rejected: blindly migrating to `Sdf.ChangeBlock` without measurement. That may hide a different root cause (e.g. `_unique_prim_path` set cost) and lose evidence value.

2. **Coverage denominator stays at all-entity, regardless of carrier choice.**
   - Rationale: this is the load-bearing invariant that prevents silently dropping non-renderable IFC entities from the coverage report.
   - Approach: whichever option is chosen, the resulting `mapping_summary.source_ifc_entity_count` MUST equal the source enumeration count and `coverage_denominator=source_ifc_entity_count` MUST remain truthful.
   - Alternative rejected: introducing a renderable-only or `IfcProduct`-only fast path. That would make timeout disappear by changing the meaning of coverage.

3. **Sidecar carrier is permitted but gated on documented handoff.**
   - Rationale: shifting carrier from USD prims to a sidecar artifact is the highest-throughput option, but it changes what `bim-streaming-server` sees and what `web-viewer-sample` can highlight via DataChannel `highlightPrimsRequest`. Non-renderable prims were never rendered or highlighted in practice, so this is plausible — but must be explicit.
   - Approach: if option (4) is selected, design.md updates with a section "Non-Renderable Carrier Handoff" describing how `bim-review-coordinator` and `web-viewer-sample` continue to surface non-renderable IFC entities in review UI (e.g. tree view, issue focus) without requiring USD prim presence. `element_mapping.json` keeps `primary_usd_prim_path` / `usd_prim_paths` semantics for renderable entries unchanged.
   - Alternative rejected: defaulting to USD-prim-only carrier forever. That keeps the timeout for the canonical fixture without justification.

4. **Publish progress during long materialization.**
   - Rationale: even after optimization, the fixture is large and `_worker` must remain diagnosable.
   - Approach: phase progress payloads include `materialized_entity_count`, `materialization_strategy` (one of `usd_prim`, `sidecar`, or hybrid), elapsed seconds, last operation, and `progress_write_count`. These fields are additive.
   - Alternative rejected: only writing a final phase timing. That recreates the prior blind timeout pattern.

5. **Validation stays staged.**
   - Rationale: this change burns down `non_renderable_entity_materialization` and (optionally) the next-largest enumeration cost; it does not burn down the entire SaaS roadmap.
   - Approach: focused unit tests first, then canonical `--limit 1 --timeout-seconds 600`. If single-fixture conversion succeeds, collect handoff IDs/URLs and run a single-fixture visual preview via the existing review viewer flow. Full 13-file batch remains a follow-up gate.

6. **Split always-on diagnostics from evidence-only profiling (continues from prior change).**
   - Rationale: canonical evidence needs to attribute cost between USD authoring, identity writing, sidecar IO, and progress writes; production conversion should not pay detailed profiling overhead by default.
   - Approach: always record `materialized_entity_count`, `materialization_strategy`, `elapsed_seconds`, `progress_write_count`, `fallback_used=false`. Fine-grained counters for per-call USD authoring, per-attribute write cost, and sidecar IO are enabled only via the existing `--profile-source-entities` (renamed or extended to a generic `--profile-conversion` if needed) flag.

7. **Secondary scope is optional and bounded.**
   - Rationale: `guid_extraction` (13s) + `name_extraction` (12s) is a known follow-on opportunity, but it is not the canonical timeout phase today.
   - Approach: include task(s) for secondary optimization only after the primary materialization burn-down passes its tests. If secondary work would regress IFC GUID / Name fidelity, defer it to its own change.
   - Alternative rejected: bundling secondary work into the primary critical path. That risks scope creep and delays the canonical first-fixture USDC.

8. **Option Selection Gate.**
   - Rationale: this design lists five hypotheses without measurement. Without an explicit gate, apply could drift past §2 baseline profile and into §3 implementation while the table above silently behaves as a decision.
   - Approach:
     - After §2 baseline profile completes, results are written into this `design.md` under a new "Selected Option(s)" subsection (created at apply time, not now), with citations to the per-batch authoring cost, per-call USD authoring breakdown, `_unique_prim_path` set cost, and (if relevant) sidecar IO cost measured in §2.
     - "Selected Option(s)" subsection MUST name the chosen option(s) (one or a composition), state expected win in seconds based on measurement, and state which hypotheses are rejected with one-line reasons.
     - If option (4) is selected, the Carrier-shift Handoff Framework section MUST be filled with concrete answers in the same subsection.
     - `tasks.md` §2.5 is the gate task that performs this write; §3 MUST NOT start until §2.5 is checked.
   - Alternative rejected: relying on Decision #1 alone. That asserts the order but does not enforce a write-back location.

## Carrier-shift Handoff Framework

`worker-artifact-pipeline` spec now permits non-renderable IFC entity identity to be carried in either a USD prim or a sidecar mapping artifact. Any carrier shift — including this change's option (4) and any future change — MUST answer the following three question groups before code lands.

### Coordinator side (`bim-review-coordinator`)

- Does the coordinator currently consume `usd_prim_count` or any field that assumes non-renderable USD prim presence? If so, what is the new field that carries the same fact when the carrier is the sidecar?
- Does the coordinator broadcast or persist any IFC-entity-keyed event whose payload assumes the entity has a USD prim path? What is the new resolution rule when only a sidecar entry exists?
- Does the artifact group readiness API need a new flag indicating which carrier was used, or is `materialization_strategy` in the conversion result sufficient?

### Viewer side (`web-viewer-sample`)

- Where does the viewer surface non-renderable IFC entities today (tree view, issue list, search)? Is the source `element_mapping.json`, `ifc_index.json`, or USD stage traversal via DataChannel?
- If the viewer iterates USD stage to enumerate non-renderable entities, what is the replacement path (e.g. fetch sidecar artifact, render from `element_mapping.json`)?
- Does any DataChannel command (`getChildrenRequest`, `selectPrimsRequest`, `highlightPrimsRequest`) currently assume non-renderable prims exist? If so, is the answer "those calls were never used for non-renderable entities" or "those calls need a graceful no-op when the entity has no prim path"?

### Streaming side (`bim-streaming-server`)

- Does Kit runtime currently rely on non-renderable prims for anything other than rendering (e.g. traversal, selection routing, metadata lookup)?
- If non-renderable prims disappear from the stage, does USDC stage open time improve materially? Is there a measurable regression risk?
- Does `highlightPrimsRequest` need a fallback path when the IFC entity has no prim (e.g. show issue card without 3D focus)?

### Filling the framework

- If this change selects option (4) in §2.5, each question above MUST have a concrete one-paragraph answer in the "Selected Option(s)" subsection, with links to code when the answer is "today's behavior is X".
- If this change does NOT select option (4), the framework is marked "Carrier=USD prim only; framework N/A for this change". The framework remains in `design.md` as a reusable artifact for the next carrier-shift proposal.
- An answer of "we have not verified this" is NOT acceptable as a closure state; a spike task MUST be added to `tasks.md` before code lands.

## Risks / Trade-offs

- **Risk: USD authoring itself dominates and even `Sdf.ChangeBlock` cannot fit in 600s.** → Mitigation: option (4) sidecar carrier is the fallback; record deterministic blocker if neither option fits.
- **Risk: sidecar carrier breaks an undocumented downstream assumption** (e.g. coordinator counting USD prims, viewer iterating stage tree). → Mitigation: design must include a downstream handoff section and the implementation must check coordinator / viewer payload shape before adopting option (4).
- **Risk: optimization accidentally drops non-renderable IFC entities.** → Mitigation: tests must assert `source_ifc_entity_count` is unchanged and `mapped_count + unmapped_count = source_ifc_entity_count`.
- **Risk: added instrumentation changes result payload shape.** → Mitigation: only optional nested diagnostics fields; existing keys remain stable.
- **Risk: `_unique_prim_path` set membership cost masquerades as USD authoring cost.** → Mitigation: baseline profile must measure `_unique_prim_path` cost separately.
- **Risk: secondary `guid_extraction` / `name_extraction` change silently substitutes synthetic IDs for real GUIDs.** → Mitigation: tests inherited from the prior change continue to assert real-GUID-only `mapped_count` and `coverage_ratio` increments.

## Current Evidence

- 2026-05-13 canonical `--limit 1 --timeout-seconds 600 --profile-source-entities`:
  - `ifc_open=4.23s`, `source_entity_enumeration=33.19s`, `geometry_iteration=198.08s`, `mesh_authoring=8.51s`.
  - `non_renderable_entity_materialization` timed out at >356s.
  - Source IFC entity count: 1,604,773; `fallback_used=false`.
  - Source enumeration profile detail: `iteration=2.86s`, `id_extraction=1.29s`, `class_extraction=1.11s`, `guid_extraction=12.99s`, `name_extraction=12.23s`, `row_append=0.34s`.
  - `conversion_job_id=conv_20260513061340_68a74e57`, `artifact_group_id=ag_d73913408c7f`, `source_artifact_id=artifact_src_f2b1d643c433`.
  - `minimum_coverage_locked=false`.
- No completed `model.usdc` was produced for this canonical fixture, so visual preview remains blocked and full 13-file canonical batch remains `not_run`.
