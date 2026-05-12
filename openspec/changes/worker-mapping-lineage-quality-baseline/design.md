## Context

`_worker` 目前已經能從 IFC 產出真實 `model.usdc`、`ifc_index.json`、`usd_index.json`、`element_mapping.json` 與 quality metrics。現行 specs 仍把 mapping coverage 定義為 measure-first，且 lineage 只存在於 `metadata.json`、conversion result 與 artifact group index 中；沒有穩定 API 讓 UI 或驗證腳本查出 source -> derived -> mapping 的關係。

本 change 仍由 `_worker` 擁有檔案本體、object URL、conversion job、artifact readiness、lineage graph 與 quality report。`_bim-control` 只接收 metadata，`bim-review-coordinator` 只管理 review session，`bim-streaming-server` 只載入與渲染 USDC，`web-viewer-sample` 只消費 mapping / highlight contract。

## Goals / Non-Goals

**Goals:**

- 提供 `GET /api/artifacts/{artifact_id}/lineage`，讓任何 source / derived / index / mapping 相關 artifact 都能查到同一個 artifact group 的 lineage graph，且 graph node 必須列出 stable artifact IDs。
- 將 `storage/*.ifc` 批次轉檔變成 mapping baseline 的標準驗證來源，Windows 本機對應 `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`。
- 把 quality metrics 從 observed-only 擴充成可判斷 `pass` / `warn` / `fail` 的 baseline policy；所有 IFC entity coverage 的 `minimum_coverage_ratio` 鎖定為 `1.0`，並保留 threshold 未鎖定時的 backward-compatible 行為。
- 讓 worker UI 能檢視 lineage graph 與每個 fixture / artifact 的 quality status，協助人工確認 source -> derived -> mapping 是否完整。

**Non-Goals:**

- 不重寫 IFC->USDC converter adapter，也不改變 #1 已 archive 的 real conversion 成果。
- 不新增 `_bim-control`、coordinator、Kit 或 viewer 的資料權威責任。
- 不要求無 GPU 環境跑 Kit/browser issue highlight smoke；GPU/Kit 不可用時只能記錄 blocked，不得偽造 passed。
- 不引入新的 production database、queue 或 external dependency。

## Decisions

1. **Lineage API 由 `_worker` 從現有 object/index metadata 組圖**

   `WorkerStore` 已保存 source index、artifact group index、conversion job result 與 derived `metadata.json`。第一版 lineage API 應以這些現有 JSON 為 source of truth，回傳 normalized graph，而不是新增資料庫或讓 `_bim-control` 回查 worker local files。

   Lineage graph node 必須列出 stable artifact IDs。對 derived artifacts，優先沿用 conversion result 的 `derived_artifact_ids.model_usdc`、`derived_artifact_ids.ifc_index`、`derived_artifact_ids.usd_index`、`derived_artifact_ids.element_mapping`，不得為 mapping/index nodes 臨時生成不可追蹤的 pseudo ID。

   替代方案是把 lineage 複製到 `_bim-control` 再查詢，但這會混淆「metadata authority」與「file/conversion facade」邊界，也會讓 local object layout 的 missing-link diagnostics 變得不準。

2. **Batch conversion 先做驗證 helper，不新增 production batch API**

   批次 baseline 的目的在於校準 `storage/*.ifc` fixture 與轉檔品質，不是對外 SaaS batch job queue。實作應優先新增 repo-local helper，例如 `_worker` 測試 helper 或 root/worker script，透過既有 `GET /api/dev/ifc-sources` 與 `POST /api/dev/ifc-sources/{source_id}/conversions` 逐一執行。

   若未來需要 production batch API，應另開 queue / async dispatch spec；本 change 不把驗證 helper 擴張成平台能力。

3. **Coverage baseline 對所有 IFC entity 鎖定 100%**

   使用者決策是 Omniverse 平台內應採無損 IFC entity traceability；因此 locked policy 的 `minimum_coverage_ratio` 為 `1.0`，且 coverage 分母是 source IFC file 內所有可識別 IFC entity，不再只限於幾何 product。每個 IFC entity 都必須有 stable USD prim 對應。

   這不代表每個 entity 都必須變成 renderable mesh。幾何 / product entity 應對應 renderable 或 highlightable USD prim；`IfcProject`、`IfcSite`、`IfcBuilding`、property set、type、relationship 等非幾何 entity 應轉成 non-renderable USD prim（例如 Xform / Scope / metadata carrier prim），保存 IFC class、entity id、GlobalId（若有）、Name 與上下游關係。實作時仍要用 `storage/*.ifc` 產出 batch matrix，確認所有 entity 都能 materialize。低於 `1.0` 但屬於可人工審查的降級情境時，`coverage_status=warn` 仍可讓 artifact group 進入 review session，但 UI / evidence 必須顯示 warning；`coverage_status=fail` 才阻擋 mapping readiness 與 issue-to-real-prim verified readiness。

4. **Issue-to-real-prim baseline 以 mapping 真實性為前置條件**

   只有 real IFC `GlobalId` 對到 `primary_usd_prim_path` / `usd_prim_paths`，且 coverage baseline 已 locked，才能把 issue highlight smoke 宣稱為 baseline verified。Fallback / synthetic id 不得進入 mapped count，這延續 #1 archive 後的 mapping truthfulness 規則。

5. **Worker UI 是 observability，不是 review viewer**

   `_worker/app/static` 或現有 worker UI 可新增 lineage/quality view，但只顯示 artifact、conversion、quality 與 URLs。正式 review interaction、annotation、issue focus 仍屬 `web-viewer-sample` + coordinator + Kit runtime。

## Risks / Trade-offs

- [Risk] `minimum_coverage_ratio=1.0` 套用到所有 IFC entities，會要求 property / relationship / type metadata 也有 USD prim；如果只產 mesh，會大量 fail。 -> Mitigation: 明確要求非幾何 IFC entities materialize 成 non-renderable USD prim，並以 `storage/*.ifc` batch matrix 測試 all-entity materialization。
- [Risk] 現有 object index 沒有完整 derived artifact reverse lookup。 -> Mitigation: 實作 lineage API 時補 normalized artifact lookup helper，能從 source index、artifact group index、job result 與 derived metadata 補齊，缺欄位時回 diagnostics 而非 500。
- [Risk] `storage/*.ifc` 在不同 worktree / Windows path 下可能位置不同。 -> Mitigation: 以 `_worker` `Settings.dev_storage_root` 的 repo-local `../storage` 為 runtime source，文件只把 `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 當本機標準路徑說明。
- [Risk] Batch real conversion 耗 RAM / disk / time。 -> Mitigation: helper 必須輸出 per-fixture duration 與 failure summary，允許先跑 API-only 或 small fixture subset，但不能把 subset 說成 full baseline lock。
- [Risk] GPU/Kit issue highlight smoke 無法在 Cloud VM 或無 GPU 環境跑。 -> Mitigation: evidence 必須標記 blocked prerequisite，coverage/API baseline 可獨立通過，不得冒稱 browser/Kit passed。

## Migration Plan

1. 先新增 `_worker` lineage graph read path 與 API，保持既有 conversion endpoints 不變。
2. 擴充 quality metrics schema；舊 result 中缺少 baseline 欄位時，read path 預設為 `minimum_coverage_baseline_locked=false` 與 `coverage_status=unlocked`；locked policy 使用 `minimum_coverage_ratio=1.0` 且 `coverage_denominator=source_ifc_entity_count`。
3. 新增 batch fixture verification helper，預設讀取 `_worker` dev source root，並在 Windows 本機使用 `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 等價 fixture glob。
4. 更新 worker UI lineage / quality view。
5. 更新或新增 evidence docs，明確區分 API-only、batch conversion baseline、single Kit/browser issue highlight smoke 與 blocked runtime prerequisites。

Rollback 時可移除新增 API route、UI entry 與 helper；既有 artifact metadata、conversion result 與 object layout 不需要 migration rollback。

## Resolved Decisions

- Lineage API 必須列出 source / derived / index / mapping node 的 stable artifact IDs；mapping/index IDs 優先沿用 `derived_artifact_ids`。
- `coverage_status=warn` 時 artifact group 仍可進 review session，但 UI / evidence 必須顯示 warning；只有 `coverage_status=fail` 才阻擋 readiness。
- `minimum_coverage_ratio=1.0`，分母改為所有 source IFC entities。非幾何 IFC metadata / relationship entities 也必須 materialize 成 non-renderable USD prim，不得排除。
