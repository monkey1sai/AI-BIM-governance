## Why

`bim-streaming-server` 的 host-native conversion authority service（`127.0.0.1:49101`）有 5 個誠實性 / 安全性破口，會讓服務在錯誤狀態下偽裝正常、或把不該外露的檔案攤平對外。本 change 把這 5 點收斂成單一「host-native conversion service hardening」，全部走純程式 L1（不需 secret、不新增 production dependency）：

1.（#3）`/artifacts` 用 `StaticFiles(directory=artifacts_root)` 把整個 artifacts 目錄攤平對外，無 per-job scope，且 mount 包在 `except Exception: pass` 靜默失敗（無 log、外部無法得知路由是否註冊成功）。
2.（#4）`GET /health` 硬寫 `status=ok` + `ifc_to_usdc_conversion=True`，從不呼叫 converter `preflight()`；converter prereq 缺失時仍回報健康，上游 readiness check 被騙（silent failure）。
3.（#10）placeholder 偵測（adapter `convert()` 與 store `_assert_publishable_outputs`）只掃前 4096 bytes，placeholder 標記若出現在 4096 之後即放行；且兩處 marker 來源不一致。
4.（#11）HOOPS / Kit 失敗時的 log path 靠脆弱 regex 從 PowerShell throw prose 抽取，ps1 訊息格式一改 regex 就靜默失 match，operator 拿不到 log path。
5.（#13）`storage_root` 未設 `STORAGE_ROOT` env 時 fallback 到 `Path.cwd()`，使 IFC path-traversal sandbox 退化；host-native 啟動腳本目前未設 `STORAGE_ROOT`，啟動後 sandbox 退化到模組目錄。

## What Changes

Owner = `bim-streaming-server`；coordinator / web-viewer-sample / callback outbox / DataChannel 邊界不變。

- **#3 `/artifacts`**：`build_app` 移除 `StaticFiles` flat mount 與其 `try/except`，改 scoped 路由 `GET /artifacts/{job_id}/{filename}`，以 `Path.resolve().relative_to(artifacts_root)` 擋路徑穿越與跨 job 存取，非法或不存在回 404，命中回 `FileResponse`。維持 `127.0.0.1` loopback bind，不加 token-gate（留給後續 auth change）。
- **#4 `GET /health`**：呼叫 `store.converter.preflight()`，未就緒時回 `status="degraded"` + `ifc_to_usdc_conversion=False` + `reason`，就緒時維持 `ok`。HTTP 狀態碼維持 `200`（health 為服務身分 introspection，非 liveness gate）。`HeadlessConverterNotConfigured` 補 `preflight()` 統一介面。
- **#10 placeholder**：兩處改掃完整檔案（移除 4096 上限）；`_PLACEHOLDER_MARKERS` 下放為單一 source of truth，store 與 adapter 共用同一份；錯誤碼 `placeholder_usdc` 與 message 形狀不變。
- **#11 失敗診斷**：`convert-ifc-to-usdc.ps1` 在 emit log path 處額外印一行 `##CONV_META##` 單行 JSON；`_run_powershell_conversion` 改以 sentinel JSON 抽取 + 解析失敗 fallback 空 metadata；保留既有 prose 供人類閱讀，`result.error` 既有欄位不變。
- **#13 storage sandbox**：`Ifc2UsdcPowershellConverterAdapter.__init__` 移除 cwd fallback，未取得 `STORAGE_ROOT` 即 raise；`preflight()` 補 `STORAGE_ROOT` 檢查；`adapter_from_env` 顯式讀並傳 `storage_root`；`bim-streaming-server/scripts/start-host-native-conversion-service.ps1` 補設 `STORAGE_ROOT=<repo_root>/storage`（對齊既有 `RUNTIME_STORAGE_ROOT` 慣例）。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `host-native-conversion-authority-service`：ADD 四條 requirement（scoped traversal-safe artifacts serving、health 反映 converter preflight、placeholder 全檔掃描、storage sandbox root 顯式不退化 cwd）。
- `streaming-ifc-usdc-conversion-authority`：ADD 一條 requirement（conversion 失敗診斷以結構化 sentinel 抽取 log path）。

## Impact

- Owner repo / folder：
  - `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/{host_native_conversion_service,conversion_authority,ifc2usdc_powershell_adapter}.py`
  - `bim-streaming-server/scripts/{convert-ifc-to-usdc,start-host-native-conversion-service}.ps1`
  - `bim-streaming-server/tests/{test_host_native_conversion_service,test_conversion_authority_api}.py`
  - `docs/evidence/streaming-server-ifcopenshell-semantic-sidecar-pass/l4_verify_sidecar_pass.py`（#13 連帶：直接建構 adapter 的 evidence script 補傳 `storage_root=<repo>/storage`，否則新契約下建構即 raise）
  - `openspec/changes/harden-host-native-conversion-service/`
- Runtime boundary：純 streaming-server 內部 hardening。host-native conversion service `127.0.0.1:49101` 對外 API surface 不變（`/health` body additive 新增 `reason`；`/artifacts` 由 flat mount 改 scoped route，但 URL 形狀 `/artifacts/{job_id}/{filename}` 不變）。不改 coordinator / viewer / callback outbox / DataChannel command。
- API：`GET /health` body additive 新增 `reason`（degraded 時）；`GET /artifacts/{job_id}/{filename}` 行為收斂為 per-job + traversal-safe，既有合法 URL 仍可取檔。
- Data：無 schema 變更；`element_mapping.json` / `entity_index.json` / `quality_metrics.json` / `result.error` 既有欄位不動。placeholder 偵測語意不變（仍 raise `placeholder_usdc`）。
- Dependencies：無新增 production dependency。
- Runtime 行為變更（operator 需注意）：未設 `STORAGE_ROOT` 時 host-native conversion service 啟動會 fail honest（raise `converter_unavailable`）；啟動腳本已同步補設 `STORAGE_ROOT`，正常啟動路徑不受影響。
- Non-goals：
  - 不對 `/artifacts` 加 `X-Internal-Conversion-Token` token-gate（屬後續 auth change，對應風險 #2 / #6）。
  - 不改 `/health` HTTP 狀態碼（維持 200）。
  - 不改 HOOPS A3D primary converter binary（vendor-side）。
  - 不改 `_run_ifcopenshell_openusd_fallback` 既有 fallback 邏輯。
  - 不引入新 production dependency。
  - 不破壞 callback outbox metadata-only 規約。
  - 不改 USD prim 路徑 / hierarchy（會破 viewer highlight 對齊）。
  - 不 retro-fit 既有已產出 artifact（只對新 conversion 生效）。
