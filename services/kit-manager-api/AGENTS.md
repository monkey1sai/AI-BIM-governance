# services/kit-manager-api Agent Rules

本檔是 `services/kit-manager-api/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`services/kit-manager-api` 是 Kit Manager 的 lightweight FastAPI backend。它列出可開啟的 `.usdc` artifact、記錄單一 Kit instance 的 open / close intent，並把 stage composition payload 轉送給 Kit control endpoint。

服務埠口：`127.0.0.1:8010`（依 deploy/env 設定）。

## Owns

- `app/main.py` — FastAPI routes：`/health`、`/api/usdc`、`/api/kit/instances/current/*`
- `app/usdc_repository.py` — 從 `STORAGE_ROOT` 掃描可用 `.usdc`
- `app/kit_service.py` — open / close intent、instance state、stage composition payload
- `app/kit_gateway.py` — 對 Kit control URL 的 best-effort dispatch
- `tests/` — API 與 settings contract 測試

## Does Not Own

- operator-facing UI（屬 `apps/kit-manager-web`）
- Review Room / Edge Console（屬 `web-viewer-sample`）
- Kit runtime / GPU process lifecycle（屬 `bim-streaming-server` 與 root deploy scripts）
- review session lifecycle / coordinator proxy（屬 `bim-review-coordinator`）
- IFC→USDC conversion authority（屬 `bim-streaming-server`）

## Required Boundaries

- MUST NOT 直接啟動 / 停止 Kit process、Docker container 或 GPU runtime；只發送 control intent。
- MUST NOT 把 missing Kit control 視為成功 runtime evidence；只能回報 `recorded_only` / `blocked` / dispatch status。
- MUST 從 env / settings 讀 runtime topology，不硬寫 host machine-specific path。
- Runtime / Docker / port / env 相關改動 MUST 更新或明確驗證 root `scripts/deploy.ps1` golden path。
- User-facing Kit Manager feature 完成需要 `apps/kit-manager-web` 前端按鈕與可觀察狀態；API-only 不算完整驗收。

## Before Editing

- 先讀 `app/main.py`、`app/kit_service.py`、`app/settings.py`、`tests/`。
- 改 API response schema 時同步檢查 `apps/kit-manager-web/src/models.ts` 與 `docs/contracts/kit-manager-api.contract.md`。
- 改 runtime topology 時同步檢查 `compose*.yml`、`.env*.example`、`scripts/deploy.ps1`。

## Verify

```powershell
cd services/kit-manager-api
python -m pytest tests -q
```

若使用 root venv，優先走：

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests -q
```

## Done Criteria

- API contract 與 `apps/kit-manager-web` client model 沒有漂移。
- 相關 pytest 通過，或清楚說明未跑原因。
- 若改動影響 user-facing Kit Manager flow，最終回報包含前端 URL / button / visible result / evidence。
- 最終回覆列出 changed files、validation、known risks。
