## Why

`worker-real-conversion-quality` 已解除 placeholder IFC->USDC blocker，但 roadmap 仍留下兩個 Phase 1 gap：mapping coverage 還停在 measure-first，且 `metadata.json` 的 lineage 不能透過 API 查詢。若不先把 coverage baseline、batch fixture evidence 與 lineage API 鎖成 contract，後續 issue highlight、worker UI traceability 與 runtime evidence 仍無法判斷「source IFC -> derived USDC -> mapping」是否達到可審查品質。

## What Changes

- 將 roadmap 候選 #3 `worker-artifact-lineage-api` 與 #3A `worker-mapping-quality-baseline` 收斂成同一個 `_worker` change，避免 lineage API 與 coverage evidence 分別定義卻互相缺欄位。
- 新增 `GET /api/artifacts/{artifact_id}/lineage` contract，回傳 source、derived、index、mapping artifact 的可查詢 lineage graph，包含 `artifact_group_id`、`conversion_job_id`、parent/children 關係、stable artifact IDs、object URL、metadata URL、quality metrics summary 與 missing-link diagnostics。
- 定義 mapping coverage baseline policy：從 current measure-first 轉為 fixture-calibrated gate；所有 IFC entity coverage 的 `minimum_coverage_ratio` 鎖定為 `1.0`，要求每個 source IFC entity 都有 stable USD prim 對應。幾何 entity 應成為 renderable / highlightable prim，property、type、relationship、project/site/building 等非幾何 entity 也必須成為可查 lineage 的 non-renderable USD prim，不得排除於分母之外。
- 將 `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 作為本機 Windows 驗證與品質校準的標準 IFC fixture glob；在 worktree 內同義使用 repo-local `storage/*.ifc`，不得改用 legacy `_s3_storage` 或 `_conversion-service` fixture。
- 定義批次轉檔驗證：至少掃描 `storage/*.ifc`、逐一建立 worker dev-source conversion、記錄每個 fixture 的 coverage / duration / USDC openability / lineage API result，並輸出可被 roadmap 引用的 evidence summary。
- 將 issue -> real prim highlight 的最低可接受條件寫進 evidence contract：只有 coverage baseline locked 且 mapping 能回溯 real IFC `GlobalId` -> `primary_usd_prim_path` / `usd_prim_paths` 時，才能宣稱 issue-to-real-prim baseline verified。
- `coverage_status=warn` 時 artifact group 仍可進入 review session，但 UI / evidence 必須顯示 mapping quality warning；只有 `coverage_status=fail` 才阻擋 mapping readiness 與 issue-to-real-prim verified readiness。
- 非目標：不重開 #1 real conversion adapter、不改 `_bim-control` 資料權威、不讓 `web-viewer-sample` 保存 mapping、不改 `bim-streaming-server` conversion/runtime ownership、不處理 multi-Kit / OVAS / SaaS tenant isolation。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `worker-artifact-pipeline`: 新增 artifact lineage query API contract，要求 lineage graph 列出 source / derived / index / mapping stable artifact IDs，並把 mapping coverage baseline 從 measure-first 升級為「所有 IFC entity 必須轉成 USD prim」且 `minimum_coverage_ratio=1.0` 的 pass / warn / fail quality policy。
- `runtime-verification-evidence`: 新增 `storage/*.ifc` 批次 fixture conversion evidence、minimum coverage locked evidence，以及 issue-to-real-prim highlight baseline 的驗收條件。
- `worker-demo-upload-convert-ui`: worker UI 需能顯示 lineage graph 與 per-fixture quality status，但仍只作 artifact / conversion observability，不取代 review viewer。

## Impact

- `_worker`: 主要影響 FastAPI routes、`WorkerStore` artifact lookup / lineage graph read path、conversion quality metrics schema、dev-source batch verification helper、worker UI 與對應 pytest。
- API / data structure: 新增 `GET /api/artifacts/{artifact_id}/lineage`，擴充 conversion result / artifact group quality metadata，既有 conversion endpoints 保持 backward-compatible。
- Storage / fixtures: 驗證標準以 repo-local `storage/*.ifc` 為準；本機 Windows 絕對路徑為 `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`。
- `runtime-verification-evidence`: 從「coverage observed only」補上 threshold lock、batch fixture matrix、pass/warn/fail policy 與 blocked 記錄規則。
- `web-viewer-sample` / `bim-review-coordinator` / `bim-streaming-server`: 只消費 worker artifact URLs、mapping URLs、session bindings 與 runtime evidence；不接管 conversion、mapping ownership 或 lineage authority。
- Dependencies: 本 proposal 不新增 production dependency；若實作需要 CLI helper 或 test helper，優先使用既有 Python / pytest / FastAPI stack。
