## MODIFIED Requirements

### Requirement: Worker supports storage IFC batch quality verification

`_worker` MUST 提供針對 repo-local `storage/*.ifc` fixtures 的 batch quality verification 實作路徑。Windows canonical fixture glob `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 與 worktree-local `_worker` dev source root `../storage` 必須被視為同一類 local validation fixture source。

除非後續另開 production batch-job spec，batch verification path 必須沿用既有 worker artifact intake 與 selected-source conversion contracts。每個 fixture result 必須記錄 filename、relative path、size、source artifact ID、artifact group ID、conversion job ID、USDC openability、mapped count、unmapped count、coverage ratio、coverage status、lineage API status、可取得時的 duration，以及 failure / warning details。

Canonical baseline runs 也必須記錄 per-fixture phase timings 與 timeout diagnostics。Phase timings 必須辨識用於診斷 slow 或 stuck runs 的可觀察 conversion phases，包括 source read 或 artifact intake、conversion total duration、IFC open、source entity enumeration、geometry iteration、mesh authoring、non-renderable entity materialization、stage save、stage reopen、artifact publish，以及可取得時的 lineage lookup。若 timeout 或 failure 發生在某個 phase 開始前，必須將該 phase 記錄為 not reached 或 unavailable diagnostic，不得靜默省略。

Batch summary status 必須區分 `blocked`、`partial`、`timed_out`、`failed`、`passed`。除非完整 required canonical fixture set 都完成 real conversion，且每個 fixture 都通過 USDC openability、truthful mapping、lineage API lookup 與 locked all-IFC-entity coverage criteria，`_worker` 不得設定 `minimum_coverage_locked=true`。

Canonical batch implementation 必須先執行 canonical `--limit 1` single fixture。只有該 single-fixture run 產生完整 passing conversion evidence，或產生 deterministic blocker 記錄後，helper 才能嘗試 full 13-file batch。當 single-fixture run passed 時，result 必須提供 stable artifact IDs 與 object URLs，讓既有 review viewer flow 可載入產出的 `model.usdc`。

#### Scenario: Storage IFC fixtures 批次轉檔

- **WHEN** batch verification 針對可讀取的 `storage/*.ifc` fixture set 執行
- **THEN** `_worker` 透過 worker artifact pipeline 為每個 fixture 建立 distinct source artifacts 與 conversion jobs
- **AND** batch summary 記錄每個 fixture 的 conversion quality 與 lineage API status

#### Scenario: Storage fixture root 不可用

- **WHEN** configured dev storage root missing、unreadable 或不含 `.ifc` files
- **THEN** batch verification 回報 `blocked` 與 missing fixture prerequisite，且不得宣稱 coverage baseline locked

#### Scenario: Batch fixture bytes 重複

- **WHEN** 兩個 fixture files 有相同 bytes 但 filename 或 relative path 不同
- **THEN** `_worker` 必須分別保留每個 fixture 的 `original_filename`、source artifact ID、conversion job ID 與 lineage

#### Scenario: Canonical fixture run 記錄 phase timings

- **WHEN** batch verification 執行 real canonical storage fixture
- **THEN** fixture result 記錄 total duration，以及 source intake、conversion、IFC parsing、source entity enumeration、geometry processing、USD authoring、stage validation、artifact publishing 與 lineage lookup 的 available phase timings

#### Scenario: Canonical fixture timeout

- **WHEN** 任一 canonical storage fixture 在產生 completed conversion result 前超過 configured per-fixture timeout
- **THEN** `_worker` 記錄 `status=timed_out`，包含 timeout duration 與 last known phase diagnostics，且不得將 batch status 標為 `passed`

#### Scenario: Canonical single fixture gate full batch

- **WHEN** full fixture set 的 canonical batch verification 在 canonical `--limit 1` run 產生 passing result 或 deterministic blocker evidence 前被要求執行
- **THEN** `_worker` 必須讓 batch evidence 維持 non-passed，並要求先補 single-fixture evidence

#### Scenario: Canonical single fixture exposes preview handoff data

- **WHEN** canonical `--limit 1` fixture 完成 real conversion，且產出 openable USDC 與 lineage
- **THEN** `_worker` expose `conversion_job_id`、`artifact_group_id`、source artifact ID、derived `model.usdc` artifact ID 或 URL、mapping artifact ID 或 URL，以及既有 review viewer flow 所需的 readiness state

#### Scenario: Full canonical batch locks coverage

- **WHEN** 13 個 canonical storage fixtures 全部完成 real conversion，且具備 openable USDC、truthful mapping output、successful lineage lookup，並在 locked all-IFC-entity denominator 下取得 `coverage_status=pass`
- **THEN** `_worker` 回傳 batch `status=passed`，並可設定 `minimum_coverage_locked=true`
