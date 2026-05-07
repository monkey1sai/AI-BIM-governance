## Context

`introduce-worker-review-session-lifecycle` 已經把 `_worker` 做成新 flow 的 artifact + conversion facade，並讓 `_bim-control` 只保存 metadata / review intent。目前剩下的不一致在 demo entrypoint：步驟 ①/② 的 UI 與文件仍有 `_s3_storage`、`_conversion-service`、`_conversion-server` 的舊入口，且 `_bim-control` stepbar 容易讓人誤以為主資料庫可以讀取本機 `.\storage` 或直接觸發轉檔。

本 design 將 `.\storage` 定義為 local demo source folder，只由 `_worker` 掃描與讀取。`_worker/data/objects` 仍是 worker 產出的 versioned object layout；兩者分開，避免把尚未 intake 的原始 IFC 與已登錄 artifact 混在一起。

## Goals / Non-Goals

**Goals:**

- 讓 `_worker` 在 demo mode 下列出 fake source folder 內的所有 `*.ifc`，並從使用者選取的 IFC 建立 source artifact 與 conversion job。
- 讓 `_worker` 提供步驟 ①/② demo UI，客戶看到的入口就是 worker，而不是 legacy storage / conversion console。
- 讓 `_bim-control`、`web-viewer-sample`、coordinator、scripts 與 docs 全部改用 worker-only artifact path。
- 移除 `_s3_storage`、`_conversion-service`、`_conversion-server` 作為可啟動服務與主要 runtime dependency。
- 保留既有 review loop：`_worker -> _bim-control -> bim-review-coordinator -> web-viewer-sample -> bim-streaming-server -> _worker objects`。

**Non-Goals:**

- 不實作真實 cloud object storage、browser direct upload、正式檔案權限、SSO、tenant isolation 或 GPU autoscaling。
- 不讓 `_bim-control` 掃描 filesystem、讀 IFC bytes 或執行 conversion。
- 不讓 `_worker` 成為 review metadata authority、session control plane、WebRTC viewer 或 Omniverse runtime。
- 不重寫 WebRTC negotiation、selection/highlight/focus command semantics、或 GPU instance lifecycle；本 change 只擴充 stage loading，讓 multi-artifact bindings 能在同一 runtime stage 中被實際 composition。

## Decisions

### 1. `_worker` owns dev source scanning

`_worker` 新增 dev-only source root setting：`WORKER_DEV_STORAGE_ROOT`。預設值為 repo root 的 `storage/`，也就是從 `_worker` service root 解析 `../storage`。若資料夾不存在，list API 回傳空清單與可診斷狀態，不自動建立 production-like storage。

Alternatives considered:

- `_bim-control` 掃描 `.\storage`：拒絕，會讓主資料庫跨界保存或讀取大型 file bytes。
- Browser 直接讀 `.\storage`：拒絕，瀏覽器不能任意讀本機資料夾，也會把 filesystem concern 放到 UI。
- 重用 `_s3_storage` static folder：拒絕，這次 change 的目的就是讓 `_worker` 成為唯一 artifact boundary。

### 2. Dev source API uses opaque IDs, not raw paths

`GET /api/dev/ifc-sources` 回傳相對 root 的 display metadata 與 opaque `source_id`，不得回傳 absolute path。`POST /api/dev/ifc-sources/{source_id}/conversions` 由 server 重新解析該 ID、讀取 source root 內的 IFC、建立 source artifact、建立 conversion job，並回傳 artifact/job identifiers。

Implementation notes:

- Source discovery is recursive and case-insensitive for `.ifc`.
- The server must not follow symlinks when listing or opening sources.
- Every resolved candidate path must stay inside `WORKER_DEV_STORAGE_ROOT`.
- `source_id` can be derived from normalized relative path plus file stat, but clients must treat it as opaque.
- Existing `POST /api/artifacts` and `POST /api/conversions` remain the lower-level worker API.

### 3. Worker demo UI is a small server-rendered/static console

`_worker` serves a demo UI at `GET /` and `GET /ui` on port `8005`. The UI is scoped to demo steps ①/② only:

- list available IFC sources;
- show selected IFC metadata;
- start worker conversion for the selected source;
- poll conversion status/result;
- show artifact group readiness and link to step ③ coordinator flow.

The UI must use the existing demo visual language and stepbar conventions, but it must not replace `web-viewer-sample` for review/streaming interactions.

### 4. Retire legacy services after references are migrated

Removal is safe only after all current runtime references move to `_worker`:

- `scripts/start-all.*`, `stop-all.*`, health checks, verify scripts, and open-demo scripts stop starting or checking ports `8002` / `8003`.
- `_bim-control`, coordinator, viewer, streaming runtime config, and smoke tests no longer emit or expect `http://127.0.0.1:8002/static/...` or `http://127.0.0.1:8003/...`.
- Current docs mark `_worker` as the only local file/conversion boundary. Historical docs may remain only if clearly archived and excluded from current runbooks.
- `_conversion-server` is removed as an alias folder because `_conversion-service` is no longer a current service.

### 5. Persistent data ownership stays unchanged

- Dev source IFC files before intake: local demo input under `WORKER_DEV_STORAGE_ROOT`, owned operationally by `_worker` in demo mode.
- Source/derived object bytes after intake/conversion: `_worker/data/objects` or configured `WORKER_OBJECTS_ROOT`.
- Conversion jobs and lineage: `_worker`.
- Project/model/artifact metadata, review intent, issue/annotation metadata: `_bim-control`.
- Review session state and collaboration events: `bim-review-coordinator`.
- USD runtime state and WebRTC stream: `bim-streaming-server`.
- Browser interaction state: `web-viewer-sample`.

### 6. Streaming runtime composes all ready model bindings

當 review session 的 `artifact_bindings` 帶入多個 ready model URLs，`bim-streaming-server` 不再只挑第一筆。它先依 `load_order` 開啟第一個 loadable binding 作為 primary stage，接著把其餘 loadable model bindings composition 到目前 stage：

- 優先以 session layer sublayer composition 載入 secondary USD/USDC，避免改寫來源檔案。
- 若 sublayer 無法載入，回報 failed binding；不把失敗項目偽裝成成功。
- 保留 top-level `url` 的單檔相容路徑，避免破壞既有 viewer / smoke scripts。
- `openedStageResult` 回傳 `primary_binding`、`loaded_bindings`、`failed_bindings`、`partial_load` 與 `applied_mode`，讓 viewer 與測試能分辨「真的多載入」與「只載入 primary」。

## Risks / Trade-offs

- [Risk] Removing `_s3_storage` / `_conversion-service` breaks scripts or demos that still reference `8002` / `8003`. → Mitigation: migrate references first, run `rg` for legacy names/ports, update smoke tests, then delete folders.
- [Risk] Local source scanning can expose unintended files. → Mitigation: require an explicit bounded root, return relative metadata only, reject traversal, ignore symlinks, and only accept regular `.ifc` files.
- [Risk] Worker UI could be mistaken for the review viewer. → Mitigation: scope it to steps ①/② and link forward to coordinator/viewer for steps ③/④/⑤.
- [Risk] Conversion completion remains asynchronous and demo timing can vary. → Mitigation: UI and smoke scripts poll `GET /api/conversions/{conversion_job_id}` and `GET /api/conversions/{conversion_job_id}/result` until terminal status or timeout.
- [Risk] Kit/WebRTC validation is still hardware-dependent. → Mitigation: API-only validation must pass without Kit; streaming validation remains a documented manual check when GPU/Kit is available.
- [Risk] USD composition 對任意來源 USDC 的 defaultPrim / layer metadata 可能不一致。→ Mitigation: primary stage 一定先開啟；secondary binding 載入失敗時回報 `failed_bindings` 與 `partial_load=true`，不阻斷 primary review session。

## Migration Plan

1. Add `_worker` dev source setting, list API, selected-source conversion API, tests, and UI.
2. Update `_bim-control` stepbar and any hard-coded step ①/② URLs to point to `_worker`.
3. Update `web-viewer-sample`, coordinator configs/tests, streaming defaults, root scripts, smoke scripts, and current docs to use worker object URLs only.
3a. Extend streaming stage loading to compose all model artifact bindings by `load_order` and update DataChannel contract validation.
4. Run worker, bim-control, coordinator, viewer, and smoke validations without `_s3_storage` / `_conversion-service`.
5. Delete `_s3_storage/`, `_conversion-service/`, and `_conversion-server/` only after validation and reference checks pass.
6. Run OpenSpec validation and GitNexus detect changes before commit.

Rollback is repo-level: restore the deleted legacy folders and previous script/docs references from version control if worker-only validation fails after implementation. The new worker APIs should be additive until the final deletion step.

## Open Questions

- 已決定：只提交 `storage/README.md` 與 placeholder，不提交 tiny demo IFC；demo 操作者自行把 `.ifc` 放到 repo root `storage/`。
- Historical docs 中提到 `_s3_storage` / `_conversion-service` 的舊計畫文件要整批移到 archive，還是只加上「historical」標記？
