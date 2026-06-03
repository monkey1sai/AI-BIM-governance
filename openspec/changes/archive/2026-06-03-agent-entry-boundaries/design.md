## Context

本 change 回應 agent boundary / git workflow governance，不實作產品功能。設計站負責產品方向與操作語意；repo 程式碼與 contracts 仍是行為 source of truth。

## Decisions

### D1: 將 A1-A10 寫成 agent contract，而不是只留在外部設計站

外部設計站「05 BIM治理與模型檢核」是產品項目的定位來源；repo agent 若不知道 A1-A10，容易把局部 API / service 視為完整產品。根目錄 `AGENTS.md` 與 lazy-loaded docs 會記錄這個對齊，但不把設計站取代為程式行為 source of truth。

### D2: user-facing done 以 frontend-operable vertical slice 為準

凡是使用者功能，完成標準必須包含 frontend route、明確按鈕、default fixture、可觀察狀態、關鍵 runtime IDs 與 browser E2E evidence。backend/API-only completion 只能算 backend slice，不能算 user-facing feature done。

### D3: script governance 先用 contract / registry / PR template 收斂

本 change 不新增 executable guard script，因需求明確要求先不修改程式碼。第一步先建立 `SCRIPT_CONTRACT.md` 與 `script-registry.json`，把現有 root scripts 分類，並把 `scripts/deploy.ps1` 定為 canonical deploy / demo path。後續若要強制執行，可另開 change 新增 `guard-script-contract.ps1` 與 GitHub Actions。

## Non-goals

- 不新增或修改產品程式碼。
- 不新增 `scripts/guard-script-contract.ps1`。
- 不修改 GitHub Actions workflow。
- 不改 deploy/runtime 行為。
