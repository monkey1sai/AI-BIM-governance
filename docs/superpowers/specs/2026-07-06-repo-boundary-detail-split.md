# repo-boundary-detail.md 拆分：667 行主檔 → 單一主題 sub-file，消除 agent-doc-context-budget 400 行警告

- 日期：2026-07-06
- Branch：`docs-split-repo-boundary`
- 形式地位：本檔為本 PR 的 formal spec（`docs/superpowers/specs/*.md`，消 pr-review-agent `missing_openspec`）

## 問題

`docs/agents/repo-boundary-detail.md` 667 行，是 agent-governance gate（`scripts/tests/test-agent-governance-check.ps1`，PR #296 落地）目前唯一一條 >400 行 non-blocking `Write-Warning` 來源。`openspec/specs/agent-doc-context-budget/spec.md` 規定 sub-file SHALL 單一主題，>400 行 SHOULD 拆分為更細的單一主題 sub-file。該檔混雜三種主題：(1) workspace 總覽 / 架構決策 / 最重要閉環，(2) per-repo 角色與禁止跨界規則，(3) 資料流與 Source of Truth 原則，適合拆分。

## 假設

拆分只需搬移 + 加 link（spec `agent-doc-context-budget` 的 no-information-loss 條文），不改寫任何事實內容；`repo-boundary-detail.md` 本身必須保留（外部多處硬引用此路徑），縮身後繼續作 repo 邊界主題的入口。

## 改動面（最小，零資訊遺失）

- `docs/agents/repo-boundary-detail.md`（667→249 行）：保留 §1 workspace 範圍、§1.A 架構決策、§2 核心 repo 定位總覽、§9 Optional Mock Services、§10 最重要閉環、§11 總結；原 §3（含 3.4–3.8）、§4–§7、§8（8.1–8.5）三段內容原地換成「一句話摘要 + link」，章節編號與順序不變。
- 新增 `docs/agents/repo-boundaries-per-service.md`（265 行）：逐字搬移原 §3（per-repo 角色 / 負責 / 不負責 / 控制邊界：3.4 coordinator、3.5 streaming-server、3.6 web-viewer、3.7 governance-service、3.8 kit-manager）與原 §8（禁止跨界規則 8.1–8.5），延用原章節編號。
- 新增 `docs/agents/repo-data-flow-and-ownership.md`（187 行）：逐字搬移原 §4（資料類型與歸屬表）、§5（核心資料流 mermaid：5.1–5.5）、§6（通訊方式邊界表）、§7（Source of Truth 原則：7.1–7.4），延用原章節編號。
- `AGENTS.md`（209→211 行）與 `CLAUDE.md`（125→127 行）的 sub-file index 表各補 2 列指向新檔，並更新 §1 folder schema 一句話摘要的落點說明。
- `bim-review-coordinator/CLAUDE.md`、`bim-streaming-server/CLAUDE.md`、`web-viewer-sample/CLAUDE.md` 三份既有 §3.4 / §3.5 / §3.6 引用路徑改指向新檔 `docs/agents/repo-boundaries-per-service.md`（章節號不變，因為內容原地延用原編號搬移）。
- 搬移方式：以行區間精確擷取原檔逐字複製，不改寫、不刪減事實內容，只加最少量銜接句（一句話摘要）與 markdown link。

## 成功標準

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-agent-governance-check.ps1` 全 assert 通過，且不再出現任何 >400 行 `Write-Warning`。
- `wc -l docs/agents/*.md AGENTS.md CLAUDE.md`：全部 `docs/agents/*.md` sub-file ≤400 行；`AGENTS.md` ≤250 行；`CLAUDE.md` ≤130 行。
- 零遺失對帳：667 行（原檔）≈ 249 + 265 + 187 = 701 行（新三檔加總），多出的 34 行全為新增的 frontmatter 說明 / 一句話摘要 / link，無任何事實內容刪減；舊檔每個標題（§3.4–3.8、§8.1–8.5、§4–§7、§5.1–5.5、§7.1–7.4）均可在對應新檔中逐一找到，且延用原編號。

## 明確不做（YAGNI）

- 不修改 `openspec/specs/agent-doc-context-budget/spec.md` 條文本身：本 PR 只是落實既有 SHOULD 建議的執行面，不改規範文字。
- 不重新編排 `repo-boundary-detail.md` 既有章節編號（不把 §9/§10/§11 改成 §4/§5/§6）：避免打斷 `docs/agents/history-and-archive.md` 內既有的 §1.A / §10 / §11 跨檔引用。
- 不動 `AGENTS.md` / `CLAUDE.md` 內的 GitNexus 自動維護區塊（`<!-- gitnexus:start -->` ... `<!-- gitnexus:end -->`）。
