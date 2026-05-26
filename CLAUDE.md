# CLAUDE.md

## 0. 文件目的

本檔是 `AGENTS.md` 的 Claude 鏡像入口。`AI-BIM-governance/` 的 repo 邊界、agent 行為、OpenSpec / GitHub workflow、GitNexus 規範、B 方案閉環全部以 [`AGENTS.md`](AGENTS.md) 為 source of truth。

若本檔、OpenSpec artifact、Graphify wiki、generated skills 或任何歷史文件與 `AGENTS.md` 衝突，採用 `AGENTS.md`。

## 1. Claude 行為對齊

優先序：

```txt
使用者最新明確指令
AGENTS.md / repo-local boundary rules
CLAUDE.md
OpenSpec artifacts
installed skills / Graphify wiki / generated skills
```

工作守則（精簡）：

- 預設繁體中文；code / API / log / 錯誤訊息保留原語言。
- 編輯前先讀相關檔案與既有模式；不確定 repo 邊界時回到 `AGENTS.md` 與 `docs/agents/repo-boundary-detail.md`。
- 非平凡變更先列出假設、成功標準、最小改動面，再做最小可回復 diff。
- 不修改 secrets / private keys / `.env` 實際機密值；不新增 production dependency 不解釋。
- 修改 function / class / method 前依 GitNexus 規範做 impact analysis；HIGH / CRITICAL 先回報。
- OpenSpec change 不得在 `main` 上開發；走 branch → PR → Actions → merge → sync/archive。

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
| 開 PR / 處理 GitHub Actions / OpenSpec sync-archive / branch closeout | `docs/agents/github-workflow.md` |
| 修改 code symbol、跑 impact analysis、commit 前 detect_changes | `docs/agents/gitnexus-usage.md` |
| 跑 sub-repo 驗證（pytest / npm test / build / Cloud VM 啟動） | `docs/agents/sub-repo-verify-commands.md` |
| 解讀 OpenSpec archive、看舊 PR、了解退役服務脈絡 | `docs/agents/history-and-archive.md` |

行數預算：本檔 ≤ 100 行（目標 ≤ 80）；AGENTS.md ≤ 250 行（目標 ≤ 200）。預算規範見 spec `agent-doc-context-budget`。

## 3. 驗證入口（一句話）

完整 sub-repo 驗證指令見 `docs/agents/sub-repo-verify-commands.md`；root contracts：

```powershell
python -m pytest tests -p no:cacheprovider
```

（須走 `.venv\Scripts\python.exe`，否則 user-site packages 會撞 FastAPI/Starlette 版本。）

## 4. GitNexus 入口

修改 code symbol 前 MUST 跑 `gitnexus_impact`；commit 前 MUST 跑 `gitnexus_detect_changes`；HIGH / CRITICAL risk 先回報再繼續。完整規範與 CLI skill 對應表見 `docs/agents/gitnexus-usage.md`。
