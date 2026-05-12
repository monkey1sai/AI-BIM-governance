## MODIFIED Requirements

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
