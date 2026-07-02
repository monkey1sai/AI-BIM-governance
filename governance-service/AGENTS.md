# governance-service — Agent Rules

本檔是 `governance-service/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 為跨 repo 邊界上位規範；衝突時以根目錄為準。

## Role

A1「BIM 治理與模型檢核」與目前 A2/A3 core governance backend authority。落地端內部 Python/FastAPI 服務（`127.0.0.1:49102` loopback），對真實 IFC 跑宣告式規則集，產出 governance score、failed elements、issue / BCF / diff / federation 等 CPU governance results。純 CPU host-native ifcopenshell，無 GPU / Kit。

## Owns

- 規則引擎 `rule_engine/`（predicate、計分、mapping-join、Excel 匯出）
- 規則集 `rules/*.yaml`（宣告式 DSL）
- rule-run 持久化 `db.py`（SQLite：rule_runs / rule_results）
- A2 diff engine（`diff_engine/`）
- A3 federation builder / coordinate validation（`federation/`）
- issue lifecycle 與 BCF export（`issues/`、`bcf/`）
- 內部 API `app.py`（:49102 loopback）
- 服務自身測試 `tests/` 與 evidence 產生器 `scripts/`

## Does Not Own

- IFC→USDC 轉檔（屬 `bim-streaming-server` conversion authority :49101）
- 對外控制面 / session / callback outbox（屬 `bim-review-coordinator` :8004）
- 瀏覽器 UI（屬 `web-viewer-sample`）
- Kit viewport / WebRTC / DataChannel runtime 操作（屬 `bim-streaming-server`）
- 把 backend capability 宣告成 user-facing complete；前端驗收屬 `web-viewer-sample` + coordinator proxy

## Required Boundaries

- MUST 綁 `127.0.0.1`；瀏覽器 MUST NOT 直連，一律經 coordinator `/api/governance/*` proxy。
- MUST 唯讀消費既有 `element_mapping.json`；MUST NOT 自行轉檔或改寫 USDC。
- MUST 以 `ifc_guid` 為主鍵；`usd_prim_path` 未對映時為 `null`，不捏造。
- MUST NOT 把 fake/smoke mapping（`mock` / `allow_fake_mapping` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test`）當真實覆蓋率。
- MUST 在 `/health` 誠實回報 ifctester 實際安裝狀態（`app.py` 以 `find_spec` 動態偵測；目前已安裝 ≥0.8.5、支援 buildingSMART IDS）；未實作的能力不得宣稱可用。
- MUST NOT 新增「非 host 既有」生產依賴（host Python312 已具 ifcopenshell/openpyxl/fastapi/uvicorn/pyyaml）。
- MUST NOT 把真實 IFC、大型 artifact commit 進 repo。
- A1/A2/A3 backend tests passed 只能代表 backend slice；user-facing done 還需要 Edge Console route / button / default fixture / browser E2E evidence。

## Before Editing

- 走 host-native `C:\Program Files\Python312\python.exe`（具 ifcopenshell 0.8.5）；勿用 WSL/Docker（本服務不需 GPU）。
- 改 predicate / 計分前先跑現狀 `pytest tests/` 拿 baseline。

## Verify

```bash
"/c/Program Files/Python312/python.exe" -m pytest tests/ -v
"/c/Program Files/Python312/python.exe" scripts/run_governance_evidence.py
```

## Done Criteria

- `pytest tests/` 全綠（含真實 IFC 萃取證明 + API E2E）。
- 真實 IFC evidence 更新於 `docs/evidence/governance-rule-run-pass/`，無假數字。
- 若功能對使用者可見，必須回報前端驗收狀態；若尚未接 UI，明確標示為 backend-only partial，不得宣告整體完成。
- 最終回覆列出 changed files、validation、known risks。
