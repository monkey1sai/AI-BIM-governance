# Design — usd-federation-sublayer-sets (A3)

## USD 對齊來源（Omniverse 疑慮優先 MCP + 對齊官方，誠實）

- **NVIDIA Kit MCP**（官方 USD 指南）：`root_layer.subLayerPaths.append("/path/to/sublayer.usd")` 疊合多個 USD 檔；`GetReferences`/`GetPayloads` 為資產聚合 / deferred load；sessionLayer 作暫態 EditContext。
- **pxr 26.5 本體 ground-truth introspection**（即官方 USD）：確認 `Sdf.Layer.CreateNew` / `subLayerPaths` / `Usd.Stage.Open` / `UsdGeom.SetStageUpAxis` / `SetDefaultPrim` / `Imageable.MakeInvisible` / `GetStageMetersPerUnit` 皆可用。
- USD-Code MCP 當前 403（auth）→ 改以更權威的 pxr 本體 API 為準。

## 跨 repo 資料流

```
瀏覽器 (console FederationPage)
  │ 只打 :8004
  ▼
bim-review-coordinator (:8004)  ── /api/governance/federated-sets* proxy（loopback）──►  governance-service (127.0.0.1:49102)
                                                                                          │ 讀 member USD（唯讀）
                                                                                          │ 寫具名 root layer federated_review.usda（pxr, CPU）
                                                                                          │ federated_model_sets/members (SQLite)
Review Room 載入 federated USD ◄── 既有 openStageRequest（p1 整合）
```

## USD composition 決策（誠實）

- **sublayer**（非 reference / payload）作 whole-discipline 疊合：sublayer 是最弱的 LIVERPS arc（L<I<V<E<**R**<**P**<**S**），適合「不覆寫 member 內部 opinion」的非破壞疊合。
- **具名 root layer** 持久化（`federated_review.usda`）；**sessionLayer 為暫態**（記憶體內、關閉即消失），不作 federation 持久層。
- **member usdc immutable**：只把 member 路徑寫進 root.subLayerPaths，從不開啟 member 寫入；可見度以 root layer 上的 `over` 套用。

## Source-of-truth 歸屬

| 資料 | 權威 owner |
|---|---|
| federated_model_sets / members / federated_review.usda | `governance-service` |
| member model.usdc | conversion authority（`bim-streaming-server`）；federation 唯讀，immutable |
| 共享坐標系判定 | `governance-service`（validate-coords） |

## 儲存 schema

```
federated_model_sets(id, project_id, name, status[draft|built], build_usda_path, created_at)
federated_model_members(id, set_id, model_version_id, discipline, usd_path, layer_order, visibility_default, root_prim, transform_json)
```

## 驗證策略與環境限制

- **單元（合成 USD member，pxr）**：build 2 member（ARC/STR）→ 斷言 subLayer 順序（layer_order 升冪、值小者最強）、member byte immutable、federated stage 含兩 member 內容、可見度 override 非破壞、座標系一致/不一致偵測。
- **API E2E（TestClient）**：create set → add 2 member → validate-coords（一致）→ build → 斷言 sublayer_order / usda 存在 / prim_sample。
- **over-the-wire E2E（真服務）**：HTTP 走 :49102 全鏈路 build federated USD。
- **環境**：host-native `C:\Program Files\Python312\python.exe`（`usd-core 26.5`）；CPU authoring，不需 GPU。
- **後續**：per-member transform（p1）、Open in Review Room 整合（p1）、BCF viewpoint 綁 set version（p1）。
