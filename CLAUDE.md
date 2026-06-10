# CLAUDE.md

## 0. 文件目的

本檔是 `AGENTS.md` 的 Claude 鏡像入口。`AI-BIM-governance/` 的 repo 邊界、agent 行為、GitHub workflow、GitNexus 規範、B 方案閉環全部以 [`AGENTS.md`](AGENTS.md) 為 source of truth。

若本檔、Graphify wiki、generated skills 或任何歷史文件與 `AGENTS.md` 衝突，採用 `AGENTS.md`。

## 1. Claude 行為對齊

優先序：

```txt
使用者最新明確指令
AGENTS.md / repo-local boundary rules
CLAUDE.md
installed skills / Graphify wiki / generated skills
```

工作守則（精簡）：

- 預設繁體中文；code / API / log / 錯誤訊息保留原語言。
- 編輯前先讀相關檔案與既有模式；不確定 repo 邊界時回到 `AGENTS.md` 與 `docs/agents/repo-boundary-detail.md`。
- 非平凡變更先列出假設、成功標準、最小改動面，再做最小可回復 diff。
- 不修改 secrets / private keys / `.env` 實際機密值；不新增 production dependency 不解釋。
- 修改 function / class / method 前依 GitNexus 規範做 impact analysis；HIGH / CRITICAL 先回報。
- 非平凡功能用 superpowers `writing-plans` → `subagent-driven-development` → `verification-before-completion`；不在 `main` 上開發，走 branch → PR → Actions → merge。
- A1–A10 是本 repo 主要產品項；user-facing feature 必須可從前端 route 操作並有 browser E2E evidence，backend-only done 不接受。
- deploy / runtime / demo 行為必須回到 `scripts/deploy.ps1` golden path；新增 root-level start / smoke / check script 預設視為邊界風險。
- 測試部署區重建口令固定執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`；helper 必須從 freshly fetched `origin/main` 重建 `D:\Users\deploy\AI-bim-geo`，排除 agent/tooling 檔案與 root `docs/`、`openspec/`、`patches/` 後由部署區執行 `.\scripts\deploy.ps1 -Build`。禁止 `-DryRun`。
- 已授權：若 `deploy.ps1 -Build` 被外部 `kit.exe` / conversion `python.exe` 等 host-native runtime blocker 佔用必要 ports 擋住，可停止該 blocking PID 並重跑同一條 `-Build`；不得改用 `-Force` / `-DryRun`。

開發管線（四套工具不平權，固定「主流程 + 輔助」；完整版見 `AGENTS.md` §0.1）：

```txt
設計/prototype → Superpowers 拆 plan → GitNexus impact → 實作 → gstack UI/E2E/screenshot 驗收 → GitNexus detect_changes → PR
```

- **Superpowers**＝plan / execution governance（主線）；**GitNexus**＝impact / detect_changes；**gstack**＝browser QA / screenshot / E2E（user-facing 驗收唯一證據）；**Matt Pocock skills**＝僅 issue / triage / domain-doc 輔助，不得當主線。
- 禁止：Matt Pocock 取代 Superpowers plan／Superpowers 宣告 UI 完成卻不跑 gstack／GitNexus 當產品設計依據／gstack 改 backend symbol 跳過 GitNexus impact。
- 誠實鐵律：前端要真能操作、不可只接 mock；無 backend 處 UI 須標 `DEMO DATA`／`NOT BUILT`／`not observed`。

完成任何工作前回報：

```txt
1. 改了哪些 tracked files
2. 執行了哪些最小驗證
3. 哪些測試沒跑以及原因
4. 已知風險或既有問題
```

## 2. Sub-files（lazy-load，與 AGENTS.md 同一組）

| 何時需要 | 讀這份 |
|---|---|
| 跨 sub-repo 決策、改 repo boundary、查 data 權威歸屬、追資料流 | `docs/agents/repo-boundary-detail.md` |
| 查 A1–A10、frontend operability、script/deploy contract | `docs/agents/product-operability-and-script-contract.md` |
| 開 PR / 處理 GitHub Actions / branch closeout | `docs/agents/github-workflow.md` |
| 修改 code symbol、跑 impact analysis、commit 前 detect_changes | `docs/agents/gitnexus-usage.md` |
| 跑 sub-repo 驗證（pytest / npm test / build / Cloud VM 啟動） | `docs/agents/sub-repo-verify-commands.md` |
| 看舊 PR、了解退役服務與歷史 spec 脈絡 | `docs/agents/history-and-archive.md` |

行數預算：本檔 ≤ 100 行（目標 ≤ 80）；AGENTS.md ≤ 250 行（目標 ≤ 200）。預算規範見 spec `agent-doc-context-budget`。

## 3. 驗證入口（一句話）

完整 sub-repo 驗證指令見 `docs/agents/sub-repo-verify-commands.md`；root contracts：

```powershell
python -m pytest tests -p no:cacheprovider
```

（須走 `.venv\Scripts\python.exe`，否則 user-site packages 會撞 FastAPI/Starlette 版本。）

## 4. GitNexus 入口

修改 code symbol 前 MUST 跑 `gitnexus_impact`；commit 前 MUST 跑 `gitnexus_detect_changes`；HIGH / CRITICAL risk 先回報再繼續。完整規範與 CLI skill 對應表見 `docs/agents/gitnexus-usage.md`。
