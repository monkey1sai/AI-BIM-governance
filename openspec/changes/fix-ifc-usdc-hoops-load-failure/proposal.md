## Why

使用者以 Postman 送入真實 341MB IFC 後，`bim-review-coordinator` 已成功下載 IFC 並派工給 `bim-streaming-server`，但 host-native Kit/HOOPS conversion job 以 `A3D_LOAD_CANNOT_LOAD_MODEL` 失敗，沒有產生 `model.usdc`、artifact refs 或 `viewer_url`。目前已透過既有 log capture change 取得根因證據；下一步必須把此類可由 IfcOpenShell 解析的 IFC 轉成可開啟 USD/USDC，不能只停在更好的錯誤訊息。

## What Changes

- 在 `bim-streaming-server` host-native conversion adapter 中，當 Kit/HOOPS 對可解析 IFC 回報 `A3D_LOAD_CANNOT_LOAD_MODEL` 或等價 import failure 時，加入真實幾何 fallback path：使用 IfcOpenShell 讀取 IFC geometry，再用 OpenUSD API 產生 `model.usdc`。
- fallback 仍由 `bim-streaming-server` conversion authority 執行；`bim-review-coordinator` 不執行轉檔、不保存大型模型權威，只負責 intake、dispatch、poll/ingest、callback outbox 與 local viewer handoff。
- fallback 輸出必須產生 store 既有 required artifacts：`model.usdc`、`element_mapping.json`、`entity_index.json`、`metadata.json`，並填入非 fake 的 quality metrics。
- fallback 不得產生 placeholder USDC；若 IfcOpenShell / OpenUSD prerequisites 缺失或 geometry 無法產生，仍必須誠實回報 non-ready failure。
- archive 前必須以使用者當前等價的真實 IFC 驗證 `conversion_status="ready"`、streaming result `model.status="ready"`、`artifacts.model_usdc.url` 存在，並可由 USD runtime 開啟。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `streaming-ifc-usdc-conversion-authority`: 將「可解析 IFC 但 HOOPS import failure」從單純 failed 診斷擴充為可使用真實 fallback converter 產生 ready USD/USDC 的情境。
- `host-native-conversion-authority-service`: host-native converter adapter 必須在 HOOPS 不支援特定 IFC 時嘗試 IfcOpenShell + OpenUSD fallback，且只在 validated artifacts 完整時發布 ready result。

## Impact

- Owner repo/folder: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/`、`bim-streaming-server/tests/`、`openspec/changes/fix-ifc-usdc-hoops-load-failure/`。
- Runtime boundary: conversion execution 仍在 `bim-streaming-server`；coordinator / viewer 不新增轉檔責任。
- API: `POST /api/conversions/ifc-to-usdc` 與 `GET /api/conversions/{id}/result` 路徑不變；成功時 result 仍回既有 artifact refs / quality metrics shape。
- Data: fallback 會新增/填充同一 conversion artifact directory 內的 `model.usdc`、sidecars 與 metadata，不改 callback metadata-only 原則。
- Dependencies: 不宣告新的 production dependency；fallback 會把已安裝的 `ifcopenshell` 與 OpenUSD `pxr` 視為 host-native converter prerequisites。缺失時以 `converter_unavailable` 或等價 non-ready diagnostic 回報，不產 fake ready。
- Non-goals: 不修改外部公司雲端 bim-control、不重新引入 `_worker` / `_bim-control` runtime、不把 Kit/WebRTC 放進 Docker、不把 log body 或模型 bytes 放進 cloud callback。
