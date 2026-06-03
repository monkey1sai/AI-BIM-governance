## Why

A3 第一版（usd-federation-sublayer-sets）能把多 discipline USD 以 sublayer 疊合，但兩個實用環節仍是 p1 骨架：(1) **per-member transform** 只記錄不套用——協調會常需把某專業模型位移/旋轉去 deconflict 或對齊坐標原點；(2) **Open in Review Room** 只標「走既有 openStageRequest」，沒有實際把 federated stage 交給 viewer 的接點。本 change 把這兩項做成可驗證的真實切片。

## What Changes

- **per-member transform（已套用）**：`build_federated_usda` 解析每個 member 的 `transform_json`（translate / rotateXYZ / scale，皆可選），在 **root（最強）layer** 對 member `root_prim` author `over` + xformOp，**member usdc 不被開啟寫入（immutable）**。
  - 經真實 pxr 26.5 ground-truth 驗證：`UsdGeom.Xformable.Add*Op` 會讀現有（composed）`xformOpOrder` 再 append，故 member 自身既有 transform **完整保留**（值仍從 member 弱層解析），federation op 落 outermost；依 scale→rotateXYZ→translate 加，使 translate 最外層（標準 TRS）。
- **Open in Review Room（handoff descriptor）**：新增 `GET /api/federated-sets/{id}/review-room`，回傳 viewer `streamConfig.stage_composition` 同形的 handoff（`primary` = 已疊合的 `federated_review.usda`，`secondary_layers` 空）。誠實邊界：governance-service 為 CPU loopback，**不啟動 GPU 串流**；實際 WebRTC 由 host-native Kit + coordinator session 負責。
- coordinator proxy `GET /api/governance/federated-sets/:id/review-room`；前端 Federation 頁加 per-member 位移輸入、`transformed` 顯示、「Open in Review Room」按鈕，並把兩個 p1 標示翻為 asbuilt。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `usd-federation-sublayer-sets`：新增 per-member transform（root layer over xformOp，member immutable）與 Review Room handoff descriptor（stage_composition）。

## Impact

- Owner repo / folder:
  - `governance-service/federation/builder.py`（transform）、`federation/api.py`（review-room）、`tests/test_federation_builder.py` + `tests/test_federation_api.py`。
  - `bim-review-coordinator/src/routes/governanceProxy.ts`（review-room proxy）。
  - `web-viewer-sample/src/console/`（governanceClient `reviewRoom` + FederatedMember.transform_json + FederationPage 位移輸入/handoff 顯示）。
- API / data shape:
  - member 新增可選 `transform_json`；build 結果新增 `transformed`；新增 `GET …/review-room`。
- Dependencies:
  - **不新增依賴**（純 pxr authoring，CPU）。
- Non-goals:
  - 不在 governance-service 啟動 GPU 串流 / 不復活退役 socket collaboration；review-room 只給「載入什麼」，不負責 Kit 進程與 viewport。
- 交叉驗證（誠實）：以真實 pxr 26.5 證明 member root 自帶 translate(10,0,0) + federation translate(0,0,5) → 合成 stage 上 resolved local translation = (10,0,5)，member 檔 SHA1 不變。
