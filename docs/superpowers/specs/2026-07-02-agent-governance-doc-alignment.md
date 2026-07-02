# Spec: Agent 治理文件對齊與收斂（2026-07-02 審計 P0–P2）

## 背景與需求來源

2026-07-02 使用者指示全面重新檢視 agent 治理體系（claude/codex skills、AGENTS.md、CLAUDE.md、sub-repo AGENTS.md、workflows、docs/plans 對齊、token 與開發速度）。5 個 readonly subagent 平行審計，完整發現與 file:line 證據見 `artifacts/2026-07-02-agent-governance-audit.md`。使用者拍板依 P0 → P1 → P2 順序執行修復。

## 問題陳述

1. 治理層（AGENTS.md / CLAUDE.md / docs/agents）未對齊 `docs/plans` 效力序：後端凍結契約、正典路由 A.1.1、A1–A10 裁決源（§4.4）零引用；`AGENTS.md` 把效力序第三的設計規格當主來源。
2. 多處 stale 敘述會直接誤導 agent 決策：spec-to-done SKILL 兩句與 branch protection 現實相反、CodeRabbit 被誤標為 required check、PR body label 缺 " tested" 字尾、gitnexus-usage.md 殘留分岔的舊 GitNexus block、governance-service ifctester 敘述過時、`_worker` 死服務殘留引用。
3. 結構冗餘：CLAUDE.md/AGENTS.md 近逐字重複段、一次性 workflow 殘留、`.codex` 鏡像凍結 drift、worktree 殘骸污染搜尋。

## 變更範圍

### P0（本 spec 首個 PR）— 純文件 stale 修正與 plans 指路
- `AGENTS.md`：需求效力序修正 + 凍結契約指路 + mermaid 補 governance-service/kit-manager 節點 + §3 wiki 段誠實化 + §2 表補 docs/plans 跳板列。
- `docs/agents/product-operability-and-script-contract.md`：路由改無斜線正典並指向 A.1.1 唯一來源；§1 補凍結契約與 §4.4 裁決源；§4 label 對齊 check 腳本逐字格式。
- `docs/agents/github-workflow.md`：補「AI Coding Governance」PR body 表規格；merge gate 描述改為 required checks 為準。
- `docs/agents/gitnexus-usage.md`：移除分岔副本，改指向 root 自動維護區塊。
- `governance-service/AGENTS.md`、`bim-streaming-server/AGENTS.md`：修 ifctester stale 與 `_worker` 死引用。
- `.claude/skills/spec-to-done/SKILL.md`、`.claude/workflows/ship-item.{md,js}`：branch protection / required checks 敘述對齊現實（gate 邏輯與閘門順序不變）。

### P1（後續 PR）— 結構收斂
- 兩份 gitignored 厚 CLAUDE.md（bim-streaming-server、web-viewer-sample）修死服務引用後收斂為薄鏡像並納版控；bim-review-coordinator/CLAUDE.md 獨有內容併回 AGENTS.md。
- `gitnexus/*` 6 skill 檔與 `repo-health` 納入 `.gitignore` 白名單追蹤（修復 MUST 級規則指向未版控檔案的結構風險）。
- 移除一次性 workflow 殘留（fu1/fu2/fu34/fullsystem/repo-wide-round-1/bim-frontend-redesign-plan/fe-redesign-alignment-audit/ui-blueprint-a-vs-b-decision/spec-to-done-design/plan-next-spec-to-done 舊版）。
- root CLAUDE.md 壓行至 ≤100、AGENTS.md 至 ≤200（消除近逐字重複段）；`repo-boundary-detail.md` 補 governance-service 邊界段、歷史敘事遷 `history-and-archive.md`；`sub-repo-verify-commands.md` 補 governance-service 驗證段。
- spec-to-done SKILL 的 `.claude`/`.codex` adapter copy 互補段落同步。

### P2（本機動作，不進 PR）
- worktree 殘骸清理、`.codex` untracked drift 同步、generated skills 快照清理、agent memory 整併。

## 非目標
- 不改任何 runtime 行為、API、deploy path；不動 `docs/plans/*` 權威內容本身（CARC §2 補登為獨立後續 PR）。
- 不改 merge gate 的閘門順序與 buffer 邏輯（僅修正其描述中與 GitHub 實況不符的字面）。

## 驗收
- 本地 `check-pr-body-evidence.ps1` 預跑通過；GitNexus `detect_changes` 無 code symbol 變更、risk low。
- CI 11 項 required checks 全綠。
- P1 完成後 root CLAUDE.md 與 AGENTS.md 均低於硬預算（≤130 / ≤250）並向目標（≤100 / ≤200）收斂；「目標行數」的剩餘缺口為 GitNexus embedded block（工具自動維護、不可手動刪）與刻意的鏡像設計（CLAUDE.md 高頻規則本文化，避免每 session 追讀 AGENTS.md 反而多耗 token），屬已審酌的取捨。`diff -rq .claude/skills .codex/skills` 僅剩刻意設計的 adapter copy 差異。

## 執行紀錄

- P0：PR #274 merged（2026-07-02）；首輪撞 missing_openspec，補本 spec 檔後綠。
- CARC §2 補登：PR #276 merged（2026-07-02）。
- P1：PR #275——首輪 pr-review-agent 抓出 `.codex/skills` 8 檔撞 `generated_tooling_path` hard blocker（`scripts/lib/pr-review-agent.ps1:343`）。依「不由 agent 自行放寬 review gate」原則縮範圍：`.codex` 側退出版控、維持本機鏡像（`git rm --cached` + 還原 `.gitignore` codex 白名單），`.claude` 側 7 檔納管照舊；AGENTS.md「本機 agent 產物」政策句同步明文化。`.codex/skills/spec-to-done` 的 stale 同步 diff 暫存本機，待使用者拍板規則調整後再入。
- P1b（進行中）：repo-boundary-detail 歷史敘事遷移 → history-and-archive（sonnet 起草 + 守恆/現行性雙 judge + 主對話審批，ultracode workflow）。
- P2：worktree 殘骸與 generated 快照已由使用者手動清除（2026-07-02）；`.codex` drift 7 檔本機同步完成；agent memory 整併完成；global Hermes 五件套與 23 個無關 skills 留使用者決定。
