# runtime-verification-evidence Specification

## Purpose
Define the evidence tiers and acceptance rules for runtime verification. This
spec separates contract checks, single-Kit render evidence, dedicated multi-Kit
routing evidence, stress evidence, and real IFC conversion quality metrics so
the roadmap can distinguish API success, geometry/render success, blocked
hardware prerequisites, and deferred capacity tiers.
## Requirements
### Requirement: Runtime verification evidence is tiered

The workspace SHALL record runtime verification evidence by tier instead of using a single ambiguous end-to-end status. Evidence tiers MUST distinguish non-GPU contract checks, single Kit GPU render checks, multi Kit routing checks, and stress checks.

#### Scenario: Non-GPU contract evidence is recorded

- **WHEN** `bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1` is run
- **THEN** the verification report records the command, result, and that it validates DataChannel stage-loading contract shape without claiming GPU viewport render success

#### Scenario: Hardware-dependent evidence is blocked

- **WHEN** a verification tier requires GPU, Kit SDK, valid geometry, multiple Kit instances, or load-test inputs that are unavailable
- **THEN** the verification report records `blocked` with the missing prerequisites and next runnable step instead of leaving the item as plain unverified

### Requirement: Single Kit render evidence uses valid geometry

The workspace SHALL only treat Kit viewport render as verified when the loaded model contains valid renderable geometry and browser evidence proves video readiness.

#### Scenario: Repo-local storage fixture is selected

- **WHEN** single Kit render evidence is prepared
- **THEN** the fixture MUST come from repo-local `storage/` unless the verification report explicitly records an approved exception and reason

#### Scenario: Header-only IFC fixture is rejected for render evidence

- **WHEN** a smoke fixture only contains IFC header / footer text and no renderable building geometry
- **THEN** the verification report MUST NOT classify the run as successful Kit GPU viewport render evidence

#### Scenario: Valid geometry renders in browser

- **WHEN** a valid IFC, USD, or USDC fixture is loaded through `_worker`, `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server`
- **THEN** the evidence records the fixture identity, artifact URLs, `review_request_id` or `session_id`, video readiness, non-zero video dimensions, `openedStageResult`, and a viewport screenshot or equivalent visual proof

### Requirement: Dedicated Kit routing evidence requires multiple Kit instances

The workspace SHALL only classify `dedicated_instance` routing as runtime-verified when the purchased and deployed GPU environment provides two or more distinct Kit instance endpoints. Dedicated multi-Kit runtime verification SHALL remain deferred until GPU purchase and deployment provide that capacity.

#### Scenario: GPU capacity purchase and deployment is pending

- **WHEN** no purchased and deployed GPU capacity tier provides at least two Kit endpoints
- **THEN** dedicated_instance runtime verification is recorded as deferred pending capacity
- **AND** the evidence MUST NOT classify the dedicated runtime tier as in-progress, passed, or failed

#### Scenario: Root scripts coordinate multi Kit startup

- **WHEN** GPU capacity has been purchased and deployed and multi Kit runtime verification needs to launch or check more than one service
- **THEN** the orchestration entrypoint MUST live under root `scripts/` while `bim-streaming-server/scripts/` may remain the low-level single-instance launcher

#### Scenario: Single local_fixed instance cannot verify dedicated routing

- **WHEN** the environment only has one `local_fixed` Kit instance on signaling port `49100`
- **THEN** a second viewer receiving GPU busy / already streaming is recorded as an environment capacity limit, not as a failed `dedicated_instance` routing verification

#### Scenario: Multiple dedicated instances stream concurrently

- **WHEN** coordinator registers two or more Kit instances with distinct signaling ports and a session requests `routing_policy=dedicated_instance`
- **THEN** evidence records distinct `kit_instance_bindings[]`, distinct stream configs, concurrent browser readiness for each assigned artifact group, and Socket.IO collaboration continuity across the shared `session_id`

### Requirement: Stress verification has explicit thresholds

The workspace SHALL define thresholds before claiming large IFC or Socket.IO concurrency stress verification.

#### Scenario: Large IFC stress is measured

- **WHEN** a large IFC fixture is used for conversion and review-session readiness
- **THEN** evidence records fixture size, conversion duration, memory or process observations when available, readiness state transitions, final status, and viewer behavior while conversion is `processing`

#### Scenario: Socket.IO concurrency stress is measured

- **WHEN** Socket.IO collaboration stress is run with more than two clients
- **THEN** evidence records client count, event types, broadcast success criteria, observed failures, and coordinator health after the run

#### Scenario: Socket.IO target load uses local sustainable capacity

- **WHEN** Socket.IO stress is prepared on the user's workstation
- **THEN** the verification MUST first determine the machine's maximum sustainable client count and use 90% of that count as the formal stress target

### Requirement: Real conversion evidence distinguishes API success from geometry success

Runtime verification evidence SHALL distinguish `_worker` API flow success from real IFC geometry conversion success. Evidence MUST NOT claim single Kit render readiness when the source artifact was converted by a placeholder path.

Current accepted real conversion evidence uses the worker adapter backed by
external `ifcopenshell` and `usd-core`; API-only success without those hard
quality gates is contract evidence only.

#### Scenario: API-only conversion smoke passes

- **WHEN** `_worker` accepts an IFC, creates a conversion job, and returns conversion result metadata
- **THEN** the evidence records API success separately and does not claim real geometry or Kit viewport success unless the derived USDC passed real conversion validation

#### Scenario: Placeholder output is detected

- **WHEN** `model.usdc` contains placeholder text, fake geometry, or a mock mapping marker
- **THEN** the verification report classifies the run as blocked for real render evidence and records the placeholder source

### Requirement: Real conversion evidence records quality metrics

The workspace SHALL record real conversion quality metrics before treating a conversion as accepted evidence. Metrics MUST include fixture identity, fixture size, converter identity, duration, USDC openability, source IFC entity count, USD prim count, mapped entity count, unmapped entity count, coverage ratio, coverage status, lineage API status, and whether a minimum coverage baseline is locked.

Evidence before threshold lock MUST use a measure-first policy: coverage report is required, but low coverage alone MUST NOT fail CI until the baseline threshold is established. Evidence after threshold lock MUST record `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, denominator policy for all source IFC entities, pass/warn/fail policy, and whether the current conversion satisfies issue-to-real-prim readiness.

#### Scenario: Large IFC fixture is converted

- **WHEN** a repo-local IFC fixture is converted by the real conversion path
- **THEN** the evidence records fixture path or identifier, file size, converter identity, duration, resulting artifact URLs, USDC openability, lineage API result, and mapping coverage metrics

#### Scenario: Mapping coverage is measured before threshold lock

- **WHEN** the real conversion path produces a coverage report before a minimum threshold is locked
- **THEN** the evidence records the observed coverage, keeps CI passing if the hard conversion checks passed, and does not classify minimum issue-to-real-prim coverage as verified

#### Scenario: Mapping coverage is evaluated after threshold lock

- **WHEN** the real conversion path produces a coverage report after a minimum threshold is locked
- **THEN** the evidence records `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status`, policy diagnostics, and whether the conversion is accepted, warned, or failed by the locked baseline

#### Scenario: Non-geometric entity coverage is recorded

- **WHEN** a fixture contains non-geometric IFC entities such as property sets, type objects, relationship entities, project, site, building, or storey containers
- **THEN** the evidence records whether those entities materialized as non-renderable USD prims and includes them in mapped/unmapped entity counts

#### Scenario: Warning coverage remains reviewable

- **WHEN** real conversion evidence records `coverage_status=warn`
- **THEN** the evidence may classify the artifact group as reviewable with degraded mapping quality, but MUST NOT classify issue-to-real-prim baseline as verified

#### Scenario: Lineage API is missing from conversion evidence

- **WHEN** real conversion succeeds but the lineage API cannot return the source -> derived -> mapping graph for the converted artifact
- **THEN** the evidence records conversion success separately and MUST NOT claim lineage visualization or traceability baseline passed

### Requirement: Single Kit render evidence uses real worker artifacts

Single Kit render evidence MUST 使用 `bim-streaming-server` internal-only 轉檔產出的 artifacts 來驗證從 IFC source 到 browser viewport 的 review-session path（B 方案：`_worker` 已自 repo 刪除，對外入口為 `bim-review-coordinator` `POST /api/external/ifc-ready`，轉檔權威為 `bim-streaming-server`）。Evidence 必須包含 `conversion_job_id` 與 `external_model_version_id` binding，讓 rendered stage 可追溯回 source IFC（`source_ifc_ref`/`source_ifc_etag`）。

Visual preview step 必須使用既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` path 載入 streaming-produced `model.usdc`；不得要求任何已刪除的 `_worker`/`_bim-control` 服務，也不得要求 `bim-review-coordinator` 在本地 parse 或 render USD/USDC。重量模型檔只在客戶落地端流動；雲端僅收 metadata-only callback。

#### Scenario: Streaming-owned artifact 在 browser render

- **WHEN** valid IFC 經外部落地端 IFC Worker → `bim-review-coordinator` `POST /api/external/ifc-ready` intake → `bim-streaming-server` internal conversion 產出、經 coordinator routing、由 `bim-streaming-server` 載入，並顯示在 `web-viewer-sample`
- **THEN** evidence 記錄 source IFC identity（`source_ifc_ref`/`etag`）、`conversion_job_id`、`external_model_version_id`、`model.usdc` 參照、mapping 參照、`openedStageResult`、非零 video dimensions，以及 viewport screenshot 或等效 visual proof
- **AND** evidence 記錄 `conversion_authority="bim-streaming-server"`，且不得宣稱任何 `_worker`-hosted artifact

#### Scenario: Kit 或 GPU prerequisite 不可用

- **WHEN** internal conversion 成功，但目前環境無法執行 Kit/GPU/browser verification（含 runtime image Linux Kit launcher 的 NVIDIA graphics/Vulkan/GPU/Kit license 阻塞）
- **THEN** evidence 分別記錄 conversion success，並將 single Kit render evidence 標為 `blocked` 或 `deferred`，同時列出 missing runtime prerequisite
- **AND** `deferred` MUST NOT 被報為 `passed`，且 host-local Kit MUST NOT 充當 substitute pass

#### Scenario: Conversion passed 但 visual preview blocked

- **WHEN** internal conversion 成功，但 `web-viewer-sample`、coordinator、Kit runtime、WebRTC、GPU 或 browser automation 不可用
- **THEN** evidence 將 conversion result 與 visual preview 分層記錄，將 visual preview 標為 `blocked`，且不得宣稱 converted USDC 已在 web UI 被 visually inspected

#### Scenario: Cloud callback delivery is layered separately

- **WHEN** internal conversion 成功並產出 metadata，但公司雲端 callback endpoint 不可達（OQ1 pending）
- **THEN** evidence 將 `cloud_callback_outbox` 與 conversion / render 分層記錄，記 retry / `dead_letter` 狀態，且 conversion / render evidence 不因 callback 未送達而被否定

### Requirement: Batch storage IFC evidence calibrates mapping baseline

Runtime verification evidence MUST 在宣稱 mapping coverage baseline locked 前，包含 repo-local `storage/*.ifc` fixtures 的 batch conversion evidence tier。Evidence 必須識別 fixture glob、resolved root、fixture count、per-fixture conversion job IDs、per-fixture artifact group IDs、USDC openability、source IFC entity count、mapped/unmapped entity counts、coverage ratio、`minimum_coverage_ratio=1.0`、coverage status、lineage API status，以及所有 required fixtures 是否 passed。

標準 local Windows fixture glob 是 `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`。在 worktrees 與 CI-like local runs 中，此 requirement 可以透過 `_worker` `dev_storage_root` resolution 指向 repo-local `storage/*.ifc`，但 evidence 必須記錄 resolved path 或 approved exception。

Canonical baseline evidence 必須包含 per-fixture duration、可取得時的 phase timings、converter identity、output file size、warnings 與 failure diagnostics。Evidence 必須將 overall batch 分類為 `blocked`、`partial`、`timed_out`、`failed` 或 `passed`。Dry-runs、subset runs、timeout runs，以及任何有 failed fixture-level quality checks 的 run，都不得標示 `minimum_coverage_locked=true`。

`minimum_coverage_locked` 為 batch summary 頂層 aggregate flag，與 per-fixture `quality_metrics.minimum_coverage_baseline_locked`（見 `Real conversion evidence records quality metrics`）為兩個不同層級的 key，分別由 batch summary 與每個 conversion result 攜帶。Evidence MUST 各自記錄兩者，且不得以其中之一覆寫或替代另一者。

在執行 full 13-file canonical batch 前，evidence 必須先包含針對 canonical fixture root 的 completed real `--limit 1` run。若該 single-fixture run timeout 或 failed，evidence 必須記錄 bottleneck diagnostics 並維持 production mapping baseline unlocked。若該 single-fixture run succeeded，evidence 接著必須包含透過既有 review viewer flow 的 passed visual preview，或清楚分類的 visual-preview blocker，full batch evidence 才能被視為已具備人工檢視前置結果。

#### Scenario: Full storage fixture batch passes

- **WHEN** 所有 required `storage/*.ifc` fixtures 都完成 real IFC->USDC conversion，且具備 openable USDC、truthful mapping output、lineage API success，並且每個 source IFC entity 都 mapping 到至少一個 real USD prim path
- **THEN** evidence 記錄 `minimum_coverage_locked=true`、`minimum_coverage_ratio=1.0`、`coverage_denominator=source_ifc_entity_count`、per-fixture metrics，並將 batch status 設為 `passed`

#### Scenario: Storage fixture batch incomplete

- **WHEN** fixture root unavailable、不含 IFC files，或刻意只跑 subset
- **THEN** evidence 以 `blocked` 或 `partial` 記錄 missing prerequisite 或 subset reason，且不得把 production mapping baseline 標為 locked

#### Scenario: One fixture fails baseline

- **WHEN** 任一 required fixture 在 conversion、USDC openability、truthful mapping checks、lineage API lookup 或 locked coverage threshold 中失敗
- **THEN** batch evidence 記錄 failed fixture 與 reason，overall batch status 不得是 `passed`

#### Scenario: Canonical single-fixture run timeout

- **WHEN** required `--limit 1` canonical storage run 在完成前超過 configured timeout
- **THEN** evidence 記錄 `timed_out`、configured timeout、elapsed duration、last known phase diagnostics，且不得將 canonical batch baseline 分類為 passed 或 locked

#### Scenario: Canonical batch evidence records phase timings

- **WHEN** canonical storage batch evidence 由 real conversion run 產出
- **THEN** evidence 記錄 available conversion phases 的 per-fixture phase timings，並把 missing phase timing 標示為 unavailable 或 not reached

#### Scenario: Canonical full batch waits for single-file gate

- **WHEN** full 13-file batch evidence 在 canonical single-fixture conversion gate 尚未 passed 或產生 deterministic blocker 前被嘗試
- **THEN** evidence 記錄 full batch not ready，並維持 `minimum_coverage_locked=false`

### Requirement: Issue-to-real-prim evidence requires locked real mapping

Runtime verification evidence SHALL only classify issue-to-real-prim highlight baseline as verified when the worker mapping is real, coverage baseline is locked, and the highlighted prim path can be traced from an issue's IFC GUID through `element_mapping.json` to `primary_usd_prim_path` or `usd_prim_paths`.

#### Scenario: Issue highlight uses real mapping

- **WHEN** a reviewer or smoke test highlights an issue whose IFC GUID appears in real mapping output with a valid primary USD prim path
- **THEN** the evidence records the issue identifier, IFC GUID, mapped USD prim path, conversion job ID, artifact group ID, and `minimum_coverage_locked=true`

#### Scenario: Issue highlight uses fallback or missing mapping

- **WHEN** the highlighted issue path comes from fallback IDs, synthetic IDs, missing mapping, or an unlocked coverage baseline
- **THEN** the evidence MUST NOT classify issue-to-real-prim baseline as verified, even if the browser or Kit interaction itself succeeds

### Requirement: Source entity enumeration optimization evidence

Runtime verification evidence MUST 在 canonical batch baseline 推進前記錄 source entity enumeration burn-down。Evidence MUST 包含 canonical fixture 識別、command、timeout 設定、baseline 計時或 timeout 結果、實作的優化摘要、優化後的 `source_entity_enumeration` 計時、source IFC entity 數量、conversion 是否越過 enumeration 階段、fallback 使用情形，以及下一個 gating phase 或 blocker。

若 source entity enumeration 在設定的 timeout 內仍無法完成，evidence MUST 將結果歸類為 `timed_out` 或 `blocked`，保留 `minimum_coverage_locked=false`，並指出尚未解除的限制屬於 `_worker` 內部，或是 worker converter 邏輯之外的外部因素。

Fine-grained source enumeration profiling evidence MAY 於 canonical burn-down runs 中紀錄。啟用時，SHOULD 區分 model iteration、entity id extraction、IFC class extraction、GlobalId extraction、Name extraction、row append 與 progress write 計數，使 evidence 能將 IfcOpenShell/runtime 成本與 `_worker` identity-scan 成本分離。

任何 canonical burn-down run（無論該 run 是否啟用 secondary `guid_extraction` / `name_extraction` 優化），若以 `--profile-source-entities` 旗標執行，evidence MUST 記錄該次 run 的 `guid_extraction` 與 `name_extraction` 子階段 elapsed seconds、它們所佔 `source_entity_enumeration` 的比例，以及該 run 的優化狀態（`optimization_applied=true`、`optimization_applied=false`、`deferred_to_follow_up`）。當 evidence 記錄為 `deferred_to_follow_up` 時，MUST 附上下一個候選 change 名稱。

#### Scenario: Before and after timing recorded

- **WHEN** `_worker` 對 canonical fixtures 變更 source entity enumeration 行為
- **THEN** verification evidence 同時記錄改動前的 timeout 或 baseline 計時、以及改動後的 `source_entity_enumeration` 計時
- **AND** evidence 引用所使用的 canonical fixture 實際路徑或 source identity

#### Scenario: Canonical single fixture advances past enumeration

- **WHEN** 優化後重跑 canonical `--limit 1 --timeout-seconds 600`
- **THEN** evidence 記錄 conversion 是否越過 `source_entity_enumeration`
- **AND** 若 conversion 成功，evidence 記錄產出的 `conversion_job_id`、`artifact_group_id`、衍生 USDC artifact ID 或 URL、mapping artifact ID 或 URL，以及 readiness 狀態

#### Scenario: Optimization evidence keeps baseline unlocked when incomplete

- **WHEN** 優化後的執行仍 timeout、失敗或僅產出部分 evidence
- **THEN** runtime verification evidence 記錄確切的 phase 與失敗原因
- **AND** canonical batch baseline 維持 `minimum_coverage_locked=false`

#### Scenario: Secondary GUID and name extraction measurement is always recorded

- **WHEN** canonical burn-down run 以 `--profile-source-entities` 執行（即便該 run 並未啟用 secondary 優化）
- **THEN** evidence 記錄 `guid_extraction` 與 `name_extraction` 子階段 elapsed seconds、`source_entity_enumeration` 佔比，以及 `optimization_applied` 狀態（`true` / `false` / `deferred_to_follow_up`）
- **AND** 若 `optimization_applied=true`，evidence 記錄 before/after 差值與 `ifc_guid` / `name` fidelity 在所有 source entity 一致的證明
- **AND** 若 `optimization_applied=deferred_to_follow_up`，evidence 記錄 follow-up change 候選名稱與 deferral 原因

### Requirement: Non-renderable entity materialization optimization evidence

Runtime verification evidence MUST record the non-renderable entity materialization burn-down before the canonical batch baseline can advance. Evidence MUST include the canonical fixture identity, command, timeout setting, baseline `non_renderable_entity_materialization` timing or timeout result, implemented optimization summary (including which option from the design comparison was selected and whether a sidecar carrier was used), post-change `non_renderable_entity_materialization` timing, count of entities materialized as USD prims, count of entities materialized to sidecar carrier when applicable, whether conversion advanced past materialization to `stage_save` / `stage_reopen` / `lineage_lookup`, fallback usage, and the next gating phase or blocker.

If non-renderable entity materialization remains unable to complete within the configured timeout, evidence MUST classify the result as `timed_out` or `blocked`, preserve `minimum_coverage_locked=false`, and identify whether the unresolved limitation appears to be `_worker`-owned or external to the worker converter logic.

When the secondary scope (`guid_extraction` / `name_extraction` cost in source enumeration) is exercised in the same change, evidence MUST also record before/after `source_entity_enumeration` fine-grained timing and confirm that IFC GUID / Name fidelity for all source entities is preserved.

Fine-grained materialization profiling evidence MAY be recorded for canonical burn-down runs. When enabled, it SHOULD distinguish per-batch USD authoring time, per-attribute write cost, `_unique_prim_path` set-membership cost, and sidecar IO cost so the evidence can separate USD authoring cost from identity-write cost.

#### Scenario: Before and after timing recorded

- **WHEN** `_worker` changes non-renderable entity materialization behavior for canonical fixtures
- **THEN** verification evidence records the pre-change timeout or baseline timing and the post-change timing for `non_renderable_entity_materialization`
- **AND** the evidence references the exact canonical fixture path or source identity used

#### Scenario: Canonical single fixture produces model.usdc

- **WHEN** canonical `--limit 1 --timeout-seconds 600` is rerun after the optimization
- **THEN** evidence records whether conversion progressed past `non_renderable_entity_materialization` and produced `model.usdc`
- **AND** if conversion succeeds, evidence records the resulting `conversion_job_id`, `artifact_group_id`, derived USDC artifact ID or URL, mapping artifact ID or URL, sidecar artifact ID or URL when applicable, and readiness state

#### Scenario: Sidecar carrier choice is documented

- **WHEN** the optimization moves non-renderable IFC entities from USD prims to a sidecar carrier
- **THEN** evidence records the selected option from the design comparison, the count of entities written to the sidecar carrier, the count remaining in USD prims (if any), and the downstream handoff notes that confirm `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` continue to surface complete coverage data

#### Scenario: Secondary GUID / Name extraction evidence is recorded

- **WHEN** the change exercises the optional secondary scope to reduce `guid_extraction` / `name_extraction` cost
- **THEN** evidence records before/after fine-grained timing for those operations and confirms that `ifc_guid` and `name` fields remain correct for all source entities
- **AND** evidence MUST NOT claim secondary scope success if any source IFC entity loses real GUID or Name fidelity

#### Scenario: Optimization evidence keeps baseline unlocked when incomplete

- **WHEN** the optimized run still times out, fails, or only produces partial evidence
- **THEN** runtime verification evidence records the exact phase and failure reason
- **AND** the canonical batch baseline remains unlocked with `minimum_coverage_locked=false`

### Requirement: Demo observation evidence classifies every current capability tier

Runtime verification evidence SHALL include 一份 current demo observation report，並將每個 current demo tier 分類為 `passed`、`failed`、`blocked`、`deferred` 或 `not_observed`。此 report MUST include command 或 observation method、timestamp、service endpoints、runtime prerequisites，以及重播或比較結果所需的 identifiers。

#### Scenario: Current demo observation report is recorded

- **WHEN** demo observation pass 被執行
- **THEN** evidence 記錄 service health、API smoke、focused tests/builds、worker conversion/artifact readiness、review session lifecycle、Socket.IO collaboration、browser E2E、Kit/WebRTC runtime 與 dedicated multi-Kit capacity 的 statuses
- **AND** 每個 status 都包含 commands 或 observation steps、result summary、timestamp，以及可取得時的相關 IDs，例如 `conversion_job_id`、`artifact_group_id`、`review_request_id` 或 `session_id`

#### Scenario: Hardware or capacity prerequisite is missing

- **WHEN** Kit、GPU、browser automation、stream ports、renderable artifacts 或 multiple Kit endpoints 不可用
- **THEN** 受影響 tier 以 `blocked` 或 `deferred` 記錄，並列出 missing prerequisite 與 next runnable step
- **AND** evidence MUST NOT 將該 tier 分類為 `passed`

#### Scenario: A tier is not rerun

- **WHEN** 某個 tier 被刻意跳過，或只有 historical evidence 存在
- **THEN** current report 將該 tier 記錄為 `not_observed`，或另外引用 historical evidence，但不得將其視為 current pass

### Requirement: Demo observation evidence preserves service ownership boundaries

Runtime verification evidence SHALL 將每個 observed result 歸屬到實際擁有該責任的 service 或 folder。Evidence MUST NOT 用某一個 boundary 的成功去宣稱另一個 boundary 也成功。

#### Scenario: Worker evidence is recorded

- **WHEN** `_worker` accepts source artifacts、creates conversion jobs、exposes derived artifacts，或 reports artifact group readiness
- **THEN** evidence 將 `_worker` artifact/conversion status 與 review session、browser、Kit runtime status 分開記錄

#### Scenario: Review session evidence is recorded

- **WHEN** `_bim-control` stores review intent，且 `bim-review-coordinator` creates 或 manages a session
- **THEN** evidence 記錄 metadata authority、session lifecycle、collaboration events 與 close/release behavior，但不得宣稱 USD stage render success

#### Scenario: Browser and Kit evidence is recorded

- **WHEN** `web-viewer-sample` connects to `bim-streaming-server`
- **THEN** evidence 記錄 browser readiness、WebRTC/DataChannel status、non-zero video dimensions、`openedStageResult` 或 equivalent runtime response，以及 screenshot 或 blocker evidence，並與 API-only smoke results 分開

### Requirement: Demo observation evidence archives replayable artifacts

Runtime verification evidence SHALL 將 current demo observation results 存入 repo-local verification documentation，並在可取得時 archive 產生的 screenshots 或 machine-readable summaries。

#### Scenario: Browser evidence is captured

- **WHEN** browser 或 Kit runtime observation 產生 visual 或 machine-readable proof
- **THEN** report 引用 repo-local evidence paths、browser URL、capture time、stream endpoint、video dimensions，以及相關 session 或 artifact IDs

#### Scenario: Observation produces no visual artifact

- **WHEN** 某個 tier 因 prerequisite 缺失而無法產生 screenshot 或 machine-readable summary
- **THEN** report 明確記錄 blocker 與 missing artifact，而不是讓 evidence path 保持空白或語意不清

### Requirement: Full canonical batch outcome distribution evidence

Runtime verification evidence MUST 為每次 full canonical 13-file storage batch run 記錄完整的 outcome distribution。Evidence MUST 包含：

- batch command 與引數（建議 `verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`）；
- 13 個 fixture 的 input identity（filename、relative path、size、source artifact ID 或 SHA-256 之類 stable hash）；
- 每個 fixture 的 outcome 分桶（`passed` / `passed_with_quality_warning` / `timed_out` / `failed` / `blocked`）、`coverage_status`、`coverage_ratio`、`unmapped_count`、`no_guid_entity_count`、可取得時的 phase timings 與 stable artifact IDs（`conversion_job_id`、`artifact_group_id`、source artifact ID、derived USDC / mapping / sidecar artifact ID）；
- aggregate `outcome_distribution`（含 `total=13`、各分桶的 `count` 與 `rate`）；
- batch summary 的 `minimum_coverage_locked` 狀態與條件達成情形。

Evidence MUST NOT 宣稱 `minimum_coverage_locked=true` 除非 `outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass`。若 batch 因外部因素（檔案不可讀、磁碟空間、prerequisite 缺失）部分 fixture 為 `blocked`，evidence MUST 區分 owned blocker 與 external blocker。

Evidence MUST 至少對通過的 fixture 子集（建議第一個 89MB fixture，若已通過）嘗試 single-file visual preview，透過既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` flow 載入 `model.usdc`；若 Kit / GPU / browser automation 不可用，記錄 `not_observed` 並附 missing prerequisite，不得宣稱 visual preview 通過。

#### Scenario: Full batch evidence records distribution

- **WHEN** `_worker` 對 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 跑 `verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`
- **THEN** evidence 包含 13 個 fixture 的 outcome 分桶（`passed` / `passed_with_quality_warning` / `timed_out` / `failed` / `blocked`），以及 aggregate `outcome_distribution` 物件（含 `total=13` 與各分桶的 `count` 與 `rate`）
- **AND** evidence 引用每個 fixture 的 filename、relative path、size、stable hash 或 source artifact ID
- **AND** evidence 引用 batch command 與引數

#### Scenario: Full batch evidence records phase timings and IDs for completed fixtures

- **WHEN** batch run 中任一 fixture 完成 real conversion（無論 coverage_status 為 pass 或 warn）
- **THEN** evidence 為該 fixture 記錄 `conversion_job_id`、`artifact_group_id`、source artifact ID、derived USDC / mapping / sidecar artifact ID、phase timings、`coverage_status`、`coverage_ratio`、`unmapped_count`、`no_guid_entity_count`

#### Scenario: Coverage lock requires full batch pass

- **WHEN** `outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass`
- **THEN** evidence 記錄 batch summary `minimum_coverage_locked=true` 與 `status=passed`
- **AND** evidence 含 production baseline 已鎖定的紀錄與 fixture-level 證據連結

#### Scenario: Partial batch keeps coverage unlocked

- **WHEN** 13 個 fixture 中任一個 fixture status ≠ `passed` 或 coverage_status ≠ `pass`
- **THEN** evidence 記錄 batch summary `minimum_coverage_locked=false`，並列出阻塞 fixture 與 outcome 分桶
- **AND** evidence MUST NOT 將 batch 整體標示為 `passed`

#### Scenario: Visual preview attempt is recorded for passing fixtures

- **WHEN** batch run 中至少一個 fixture status=passed 且 coverage_status=pass
- **THEN** evidence 為該 fixture 嘗試 single-file visual preview，透過既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` flow 載入 `model.usdc`
- **AND** 若 Kit / GPU / browser automation 不可用，evidence 將 visual preview 記為 `not_observed` 並列出 missing prerequisite

#### Scenario: External blocker is distinguished from owned blocker

- **WHEN** 一個或多個 fixture 因檔案系統錯誤、磁碟空間、prerequisite 缺失或 IfcOpenShell 限制而被分類為 `blocked` 或 `failed`
- **THEN** evidence 記錄是 `_worker`-owned blocker（轉檔器邏輯、quality 政策）或 external blocker（IO、依賴、輸入檔案損毀）
- **AND** evidence 不得用 external blocker 解釋 `_worker`-owned coverage 退化

### Requirement: Full canonical batch evidence MAY be produced incrementally via the resumable queue

Runtime verification evidence for the full canonical batch MAY be produced incrementally by dispatching one fixture per `--run-next` invocation against the persisted queue manifest, instead of one monolithic process. The evidence MUST be derivable entirely from the persisted manifest rows.

`outcome_distribution` and `minimum_coverage_locked` for a queue-produced batch MUST be computed with semantics identical to the predecessor monolithic path: the same five buckets (`passed`, `passed_with_quality_warning`, `timed_out`, `failed`, `blocked`) and the same lock gate (not a partial subset AND every fixture in the `passed` bucket AND every fixture's per-fixture baseline locked). A queue run carried to completion over the canonical fixture set MUST yield the same `outcome_distribution` and `minimum_coverage_locked` as the monolithic path would on the same inputs.

A resumed batch MUST NOT auto-retry a fixture that already has a recorded `failed` or `timed_out` outcome; only fixtures with no recorded terminal outcome are re-dispatched on resume. Evidence MUST record, per fixture, the recorded outcome and the retained-artifact paths, and MUST distinguish a fixture that was explicitly `--retry`-ed (recording the prior outcome) from one that completed on first dispatch. Evidence MUST NOT claim `minimum_coverage_locked=true` unless every fixture row records a terminal `passed` outcome with its per-fixture baseline locked, exactly as in the predecessor gate.

Evidence MUST report the retention footprint (retained vs pruned per fixture) so the canonical-verification scratch reduction is auditable, and MUST surface any manifest-vs-disk drift rather than silently treating a drifted fixture as a clean pass.

#### Scenario: Queue-produced evidence equals monolithic evidence on the same inputs

- **WHEN** the canonical fixture set is run to completion via repeated `--run-next` and summarized with `--summary`
- **THEN** the recorded `outcome_distribution` and `minimum_coverage_locked` equal what the monolithic `--limit`-style path would produce on the same inputs
- **AND** the bucket definitions and lock gate are the predecessor's, reused without redefinition

#### Scenario: Resumed batch does not auto-retry recorded failures

- **WHEN** a batch is resumed after a crash and `--run-next` is invoked
- **THEN** only fixtures with no recorded terminal outcome are dispatched
- **AND** a fixture already recorded as `failed` or `timed_out` is left as-is unless an explicit `--retry` was issued, which the evidence records together with the prior outcome

#### Scenario: Evidence records retention footprint and surfaces drift

- **WHEN** queue-produced canonical evidence is compiled
- **THEN** it reports, per fixture, the retained artifact paths and which large arrays were pruned, so the scratch-footprint reduction is auditable
- **AND** any manifest row whose retained path is missing on disk is reported as a drift diagnostic, not counted as a clean pass

#### Scenario: Lock claim requires every fixture recorded passed

- **WHEN** at least one fixture row is not a terminal `passed` with its per-fixture baseline locked
- **THEN** the evidence records `minimum_coverage_locked=false`
- **AND** the evidence lists the blocking fixtures and their recorded bucket
