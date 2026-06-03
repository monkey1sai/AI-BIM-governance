## 1. Preflight / Baseline（measure-before-change，紅隊 R6）

- [x] 1.1 確認 host `C:\Program Files\Python312\python.exe` 具 `ifcopenshell 0.8.5` + `openpyxl 3.1.5` + `fastapi/uvicorn/pyyaml/pytest`，且 `ifctester` 未安裝（如實記錄）。
- [x] 1.2 確認 IFC4X3 真實 fixture（`storage/fixture-bytes.ifc`）可 host-native 解析；型別分布（IfcWall 339 / IfcDoor 72 / IfcBuiltElement 6715）。
- [x] 1.3 在 `codex/openspec/governance-rule-run-service` branch + `.worktrees/` worktree 開發，不在 main。

## 2. Failing Tests First（規則引擎，CPU、確定性）

- [x] 2.1 合成 IFC4 fixture：2 門（1 有/1 缺 FireRating）+ 2 牆（1 有名+在樓層/1 無名+未指派）。
- [x] 2.2 斷言 `property_required` 真的讀到 Pset 值（evidence 帶 `psets_read` 與 value）。
- [x] 2.3 斷言 `spatial_contained` 經 `get_container` 判定樓層指派。
- [x] 2.4 斷言每個 fail 帶可在模型中解析的真實 `ifc_guid`；score 在 [0,100]；total = pass+fail+error。
- [x] 2.5 斷言未知 IFC 型別 → warning 而非崩潰。

## 3. Core Implementation（governance-service）

- [x] 3.1 `rule_engine/`：models / predicates（property_required / attribute_required / spatial_contained / naming_convention）/ engine（含跨 schema 型別別名 IFC4X3↔IFC4）。
- [x] 3.2 `rules/default-governance.yaml`：3 條 MVP 規則（DOOR-FIRERATING-REQUIRED / ELEMENT-NAME-REQUIRED / WALL-STOREY-ASSIGNED），純 ifcopenshell predicate，不依賴 ifctester。
- [x] 3.3 `mapping_join.py`：`ifc_guid -> usd_prim_path`（未對映 `null`）+ fake/smoke mapping 隔離。
- [x] 3.4 `excel_export.py`：openpyxl 失敗構件 + summary 兩個工作表。
- [x] 3.5 `db.py`：SQLite 持久化 `rule_runs` / `rule_results`。
- [x] 3.6 `app.py`：FastAPI `127.0.0.1:49102` loopback；`/health`（誠實 ifctester=false）、`POST /api/rule-runs`（202 + 背景執行）、`GET /api/rule-runs/{id}`、`/results?status=failed`、`/export?fmt=excel`（fmt=bcf → 501 p15）。

## 4. Coordinator Proxy（瀏覽器邊界）— 移至 change 2（前端整合）

> 服務端已以綁定 `127.0.0.1:49102` 強制 loopback 邊界（half 已實作）。coordinator 對瀏覽器的 `/api/governance/*` proxy route 屬「前端整合」層，與 Edge Console / Rule Center 前端同屬 change 2（`edge-console-shell`）一併實作與驗證，使 change 1 維持為可獨立驗證的純 backend authority。

- [ ] 4.1（change 2）`bim-review-coordinator` additive `/api/governance/rule-runs*` proxy（loopback 轉發 `:49102`）；先跑 GitNexus impact。
- [ ] 4.2（change 2）`coordinator npm run verify` 仍綠。

## 5. Validation

- [x] 5.1 `pytest tests/` 全綠（合成 + 真實 IFC + API E2E）：10 passed。
- [x] 5.2 真實 IFC evidence（IFC4X3、7126 構件、failed 71、score 99.0）寫入 `docs/evidence/governance-rule-run-pass/2026-06-02/`。
- [x] 5.3 `npx openspec validate governance-rule-run-service --strict` 通過（"Change 'governance-rule-run-service' is valid"）。
- [ ] 5.4 `git diff --cached --check`（trailing whitespace）；GitNexus detect-changes 確認 scope。

## 6. Documentation / Closeout

- [x] 6.1 `governance-service/README.md` + repo-local `AGENTS.md` / `CLAUDE.md`（7 段式）。
- [ ] 6.2 PR（繁中標題/描述，附 validate 輸出、依賴/授權風險、rollback）。
- [ ] 6.3 merge 後 `npx openspec archive governance-rule-run-service`，sync `openspec/specs/governance-rule-run-authority/spec.md`。

## 7. 後續（本 change 範圍外，已標 p1/p15）

- [ ] 7.1 前端 Rule Center / Issues 語意驗收頁（change 2：edge-console-shell）。
- [ ] 7.2 IDS-XML 匯入（`pip install ifctester` + smoke 證據，p1）。
- [ ] 7.3 BCF 匯出 issue→.bcfzip（p15，LGPL 閘門）。
- [ ] 7.4 真實多元素 `element_mapping.json` join 覆蓋率（待真實轉檔產出）。
