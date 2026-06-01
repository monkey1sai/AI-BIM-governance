## Context

CH-1 收斂 host-native conversion service 的 5 個 hardening 點（#3/#4/#10/#11/#13），全在 `bim-streaming-server` conversion 路徑內，不跨 repo。對應 2026-06-01 風險報告中 conversion service 同檔群（Wave 0 的 #3/#4 + Wave 2/3 的 #10/#11/#13）。全部走純程式 L1，不需 secret、不新增 production dependency。

## Goals / Non-Goals

- Goals：service fail honest（health 反映 preflight、storage root 顯式不退化）、artifacts serving 防穿越、placeholder 偵測無盲區、失敗診斷結構化可取。
- Non-Goals：見 proposal「Non-goals」（不加 token-gate、不改 HTTP code、不改 HOOPS binary / fallback、不新增 dependency、不破壞 callback metadata-only、不改 USD prim 路徑、不 retro-fit）。

## Control flow / Source of truth

- `/artifacts` serving：唯一來源 = `config.artifacts_root` 下 `{job_id}/{filename}`；traversal guard 用 `resolve().relative_to(artifacts_root.resolve())`，沿用 `conversion_authority._artifact_url` 既有路徑模式。不引入新儲存體。
- `/health`：converter readiness 的 source of truth = `store.converter.preflight()`；health 只反映、不快取狀態。
- placeholder marker：single source of truth = `conversion_authority._PLACEHOLDER_MARKERS`（adapter import 同一份），消除 store 端硬寫 boolean literal 的脫節。
- 失敗診斷 log path：來源 = `convert-ifc-to-usdc.ps1` emit 的 `##CONV_META##` 單行 JSON；Python 端 `_run_powershell_conversion` 只解析不臆測，解析失敗 fallback 空 metadata。
- storage sandbox root：來源 = `STORAGE_ROOT` env（顯式），無預設退化到 cwd。

## Key Decisions（explore open questions 收斂）

- **#3 不加 token-gate**：維持 loopback + 防穿越即收掉「目錄攤平 + 路徑穿越」風險；token-gate 牽涉 viewer/coordinator 取檔要不要帶 header、是否破壞 `_artifact_url` 無 header GET 假設，屬 auth 範疇，留後續獨立 auth change。
- **#4 health 維持 HTTP 200 + body `degraded`**：既有 spec scenario 與 test 把 `/health` 當服務身分 introspection，上游 readiness smoke 讀 body 欄位而非 HTTP code；改 503 會破壞既有 TestClient 斷言且超出 hardening 範圍。
- **#10 全檔 `read_bytes()`**：host-native 產出的 `model.usdc` 為本地單檔且體積可控（demo/MVP 規模），全讀最簡單且零盲區；不預先加 chunk 抽象（避免 speculative complexity），實測出現超大檔再改分塊掃描。
- **#11 用 stdout `##CONV_META##` sentinel（非 sidecar 檔）**：失敗路徑下 artifact dir 可能不存在，sidecar 檔不可靠；stdout sentinel 不依賴檔案系統狀態，且 Python 端 combined 已同時含 stderr+stdout，抽取最穩。保留現有 prose 兩行供人類閱讀。
- **#13 hard-fail + 補啟動腳本**（使用者 2026-06-01 拍板）：fail honest 優於靜默退化成 repo-wide / 模組目錄 sandbox；值 `<repo>/storage` 對齊既有 `RUNTIME_STORAGE_ROOT` 慣例（README / structured-log 範例一致），不需新增資料擺放決策。

## Validation Strategy

- L1 import sanity：`_PLACEHOLDER_MARKERS` 下放後三檔可載入、無循環 import。
- L2 pytest（走 root `.venv\Scripts\python.exe -m pytest ... -p no:cacheprovider`）：
  - `bim-streaming-server/tests/test_host_native_conversion_service.py`（#4 degraded、#10 >4096、#11 sentinel、#13 storage 必填、#3 traversal）
  - `bim-streaming-server/tests/test_conversion_authority_api.py`（#3 / #10 store 路徑）
- L3 root contracts 回歸：`pytest tests`。
- L4 OpenSpec：`npx openspec validate harden-host-native-conversion-service --strict`。
- baseline：apply 前先跑 L2/L3 拿綠燈基準（既有 test 全綠），改完用同指令比較；commit 前 `git diff --cached --check`。

## 環境限制

- Kit 渲染需 Windows host-native GPU；本 change 不觸及 Kit runtime，pytest 在 conversion adapter 單元 + fake converter 層級，不需 GPU。
- pytest 必走 root `.venv\Scripts\python.exe`（user-site packages 會把 FastAPI / Starlette / uvicorn 拉成不相容版本）。
