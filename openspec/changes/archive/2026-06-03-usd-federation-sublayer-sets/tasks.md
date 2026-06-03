## 1. Preflight / Baseline + USD 對齊

- [x] 1.1 USD 對齊：Kit MCP 官方 USD 指南（subLayerPaths.append）+ pxr 26.5 ground-truth introspection（Sdf.Layer/Usd.Stage/UsdGeom API）。USD-Code MCP 403 → 改以 pxr 本體為準。
- [x] 1.2 branch `codex/openspec/usd-federation-sublayer-sets` + worktree（stacked 於 A2，含 governance-service）。

## 2. Failing Tests First（federation）

- [x] 2.1 合成 USD member → build → subLayer 順序 + member byte immutable + federated 疊合內容。
- [x] 2.2 可見度 override 非破壞（member 不變、federated stage 該 member invisible）。
- [x] 2.3 座標系驗證：不一致偵測 + 一致通過。

## 3. Core Implementation（governance-service/federation/）

- [x] 3.1 `builder.py`：sublayer 疊合（具名 root layer，layer_order 排序）+ defaultPrim/upAxis + 可見度 over；member immutable。
- [x] 3.2 `coords.py`：validate_coords（upAxis/metersPerUnit/defaultPrim 一致性）。
- [x] 3.3 `store.py`：SQLite federated_model_sets/members。
- [x] 3.4 `api.py`：APIRouter（POST /api/federated-sets、/members、/validate-coords、/build、GET /{id}）；`app.py` 一行 include_router。

## 4. Coordinator proxy + 前端

- [x] 4.1 `governanceProxy.ts`：additive `/api/governance/federated-sets*` proxy。
- [x] 4.2 console FederationPage 升級為真實 Federation Builder；governanceClient federation 方法；A3 卡片 provenance → asbuilt。

## 5. Validation

- [x] 5.1 `pytest tests/`：22 passed（A1 10 + A2 5 + A3 7，含真實 USD sublayer authoring）。
- [ ] 5.2 前端 `npm run build` + `npm run test`；coordinator `npm run build`（tsc）。
- [ ] 5.3 `npx openspec validate usd-federation-sublayer-sets --strict`。
- [ ] 5.4 over-the-wire HTTP federation E2E（真服務 build federated USD）；`git diff --cached --check`。

## 6. Closeout

- [ ] 6.1 commit + PR（繁中，附驗證輸出，stacked 於 A2 #153）。
- [ ] 6.2 merge 後 archive + sync spec。

## 7. 後續（已誠實標 p1）

- [ ] 7.1 per-member transform 套用（over xformOp）。
- [ ] 7.2 Open in Review Room（federated USD → openStageRequest）。
- [ ] 7.3 BCF viewpoint 綁 federation set version。
- [ ] 7.4 大型 payload deferred load policy。
