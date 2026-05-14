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

Single Kit render evidence MUST 使用 `_worker` real conversion artifacts 來驗證從 IFC source 到 browser viewport 的 review-session path。Evidence 必須包含 conversion job ID 與 artifact group ID，讓 rendered stage 可追溯回 source IFC。

Canonical storage batch burn-down 必須在 canonical `--limit 1` real conversion 成功後，加入 single-file visual preview step，才可宣稱使用者能在 web UI 檢視轉檔成果。此 visual preview 必須使用既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` path 載入 worker-hosted `model.usdc`；不得要求 `_worker` 在本地 parse 或 render USD/USDC。

#### Scenario: Real worker artifact 在 browser render

- **WHEN** valid IFC 經 `_worker` 轉檔、經 `bim-review-coordinator` routing、由 `bim-streaming-server` 載入，並顯示在 `web-viewer-sample`
- **THEN** evidence 記錄 source IFC identity、`conversion_job_id`、`artifact_group_id`、`model.usdc` URL、mapping URL、`openedStageResult`、非零 video dimensions，以及 viewport screenshot 或等效 visual proof

#### Scenario: Canonical single fixture preview 在 browser render

- **WHEN** canonical `--limit 1` storage fixture 完成 real conversion，且其 worker-produced `model.usdc` 透過既有 review viewer flow 載入
- **THEN** evidence 記錄 canonical fixture path、`conversion_job_id`、`artifact_group_id`、derived USDC artifact ID 或 URL、`openedStageResult`、非零 viewport/video dimensions，以及 screenshot 或等效 visual proof

#### Scenario: Kit 或 GPU prerequisite 不可用

- **WHEN** real conversion 成功，但目前環境無法執行 Kit/GPU/browser verification
- **THEN** evidence 分別記錄 conversion success，並將 single Kit render evidence 標為 `blocked`，同時列出 missing runtime prerequisite

#### Scenario: Worker conversion passed 但 visual preview blocked

- **WHEN** canonical `--limit 1` conversion 成功，但 `web-viewer-sample`、coordinator、Kit runtime、WebRTC、GPU 或 browser automation 不可用
- **THEN** evidence 將 conversion result 與 visual preview 分層記錄，將 visual preview 標為 `blocked`，且不得宣稱 converted USDC 已在 web UI 被 visually inspected

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
