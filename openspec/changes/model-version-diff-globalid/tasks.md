## 1. Preflight / Baseline

- [x] 1.1 確認 host numpy + `ifcopenshell.util.placement.get_local_placement`；版本對 fixtures（圖書館 7139 / 轉檔測試2 7139、GUID 共同 7137）。
- [x] 1.2 branch `codex/openspec/model-version-diff-globalid` + worktree（off 已含 governance-service 的 main）。

## 2. Failing Tests First（diff 引擎）

- [x] 2.1 合成 base/target（移動 + pset 改 + 新增 + 移除）→ 斷言 added/removed/moved/property_changed/matched。
- [x] 2.2 相同模型 → 0 added/removed/moved。
- [x] 2.3 真實版本對 → matched>7000、計數一致、items 帶真實 type/guid。

## 3. Core Implementation（governance-service/diff_engine/）

- [x] 3.1 `keys.py`：placement_xyz（numpy 4x4 平移）、tag_of、pset_hash（與幾何獨立）、type_name_loc_key。
- [x] 3.2 `engine.py`：多級對齊（GlobalId→Tag→type+name+loc）+ 分類（added/removed/moved/property_changed）+ 計數；geometry_changed 標 warning。
- [x] 3.3 `store.py`：SQLite model_diffs/model_diff_items。
- [x] 3.4 `api.py`：APIRouter（POST /api/diffs 202 背景、GET /{id}、/items?change_type=、apply-overlay 501）；`app.py` 一行 include_router。

## 4. Coordinator proxy + 前端

- [x] 4.1 `governanceProxy.ts`：additive `/api/governance/diffs*` proxy。
- [x] 4.2 console VersionDiffPage 升級為真實 Diff Builder；governanceClient diff 方法；A2 卡片 provenance → asbuilt。

## 5. Validation

- [x] 5.1 `pytest tests/`：15 passed（A1 10 + A2 5，含真實版本對 diff）。
- [x] 5.2 前端 `npm run build` + `npm run test`（38 passed）；coordinator `npm run build`（tsc）綠。
- [ ] 5.3 `npx openspec validate model-version-diff-globalid --strict`。
- [ ] 5.4 over-the-wire HTTP E2E（真服務 + 真實版本對）；`git diff --cached --check`。

## 6. Closeout

- [ ] 6.1 commit + PR（繁中，附驗證輸出）。
- [ ] 6.2 merge 後 archive + sync spec。

## 7. 後續（已誠實標 p1/p15）

- [ ] 7.1 geometry_changed 幾何 tessellation 比對（p1）。
- [ ] 7.2 Issue impact（resolved/reopened/new，待 Issue DB）。
- [ ] 7.3 3D overlay 顏色（走 client highlightPrimsRequest，p15）。
- [ ] 7.4 usd_prim_path join（待真實多元素 mapping）。
