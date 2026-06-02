## Why

A3「跨專業模型 Federation」讓建築 / 結構 / 機電 / 消防等 discipline 模型在同一 OpenUSD stage 疊合，供協調會議同時檢視——換一場會議用不同組合時**不需重新轉檔**，只切換要疊哪幾張、順序、可見度。目前 repo 有 A1（治理）+ A2（版本差異），但無 federation 能力。

## What Changes

- 擴充落地端 `governance-service`（:49102 loopback）新增 USD federation 能力：
  - 以 OpenUSD **sublayer** 把多個 discipline 模型疊在具名 root layer（`federated_review.usda`），member 的 `model.usdc` **永不被開啟寫入（immutable）**。
  - 對齊來源（誠實，滿足「Omniverse 疑慮優先 MCP + 對齊官方」）：NVIDIA **Kit MCP** 官方 USD 指南（`root_layer.subLayerPaths.append(...)` 疊合多檔）+ **pxr 26.5 本體 API** ground-truth introspection（Sdf.Layer.subLayerPaths / Usd.Stage.Open / UsdGeom.SetStageUpAxis / MakeInvisible）。
  - **共享坐標系驗證**（federation #1 風險）：比對各 member 的 upAxis / metersPerUnit / defaultPrim，先 validate-coords 再 build。
  - 可見度 override 以 root layer 上的 `over` 非破壞性套用（切換 visibility 不需重轉檔 member）。
  - 持久化 `federated_model_sets` / `federated_model_members`（SQLite，沿用 governance.db）。
  - REST（內部 :49102）：`POST /api/federated-sets`、`/{id}/members`、`/{id}/validate-coords`、`/{id}/build`、`GET /{id}`。
- coordinator additive `/api/governance/federated-sets*` proxy。
- 前端 A3「Federation Builder」頁：經 proxy 建 set / 加 member / 驗坐標系 / build，顯示 subLayer 順序與 federated_review.usda。

## Capabilities

### New Capabilities

- `usd-federation-composition`：落地端以 OpenUSD sublayer 把多個 discipline USD 疊合成 federated stage，member usdc immutable、驗證共享坐標系、誠實標示 LIVERPS / sessionLayer 語義，並維持 loopback / coordinator-proxy 邊界。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder:
  - `governance-service/federation/`（builder / coords / store / REST router）；`app.py` 一行 include_router。
  - `bim-review-coordinator/src/routes/governanceProxy.ts`（additive federation proxy）。
  - `web-viewer-sample/src/console/`（FederationPage 升級 + governanceClient federation 方法）。
- API / data shape:
  - 內部 :49102 新增 `/api/federated-sets*`；coordinator `/api/governance/federated-sets*`；外部契約不變。
- Runtime boundary:
  - USD authoring 為 CPU pxr（.usda 文字 authoring，**非 GPU render**）；瀏覽器只打 :8004；Review Room 載入 federated USD 走既有 `openStageRequest`。
  - federation 只寫具名 root layer，member usdc immutable（呼應 BCF 政策「USDC immutable」）。
- Dependencies:
  - 無新增生產依賴（`usd-core==26.5` host 已具，ground-truth 驗證）。
- Non-goals:
  - 不做 per-member transform 套用（p1，已記錄）、不做 BCF viewpoint 失效追蹤（待 set version）、不在後端 render 3D、不改 conversion authority / 雲端權威。
