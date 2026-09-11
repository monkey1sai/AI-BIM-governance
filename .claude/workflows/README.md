# .claude/workflows — 索引

本目錄的 Dynamic Workflow 腳本清單與引用關係。新增 workflow 時同步補一列（repo-health 健檢會抓「無 in-repo 引用的孤兒 workflow」）。

## 索引

| Workflow | 用途 | 引用處 / 觸發方式 |
|---|---|---|
| `std-plan.js` | RETIRED：固定回報 retired_workflow、agentCallsUsed=0，不派工或修改狀態 | `docs/agents/spec-to-done-retirement.md` |
| `std-implement.js` | RETIRED：固定回報 retired_workflow、agentCallsUsed=0，不派工或修改狀態 | `docs/agents/spec-to-done-retirement.md` |
| `std-evidence.js` | RETIRED：固定回報 retired_workflow、agentCallsUsed=0，不派工或修改狀態 | `docs/agents/spec-to-done-retirement.md` |
| `std-evidence-closeout.js` | RETIRED：固定回報 retired_workflow、agentCallsUsed=0，不派工或修改狀態 | `docs/agents/spec-to-done-retirement.md` |
| `fu-adversarial-verify-generic.js` | immutable target/base/subject 對抗複驗：最多 2 批 verifier（refute-by-default）＋sequential holistic critic；machine-bound evidence taxonomy；結果含 fix_now/external_blockers/known_gaps/follow_ups/unverified/refuted 完整 taxonomy，其中只有 in-scope `fix_now` 進入修復通道；verifier+critic 合計最多 32 findings | 獨立、明確授權的 immutable review；`tests/test_fu_verdict_schema.py`、`tests/test_dacs_findings_contract.py`、`tests/test_fu_adversarial_batching.py`、`tests/test_fu_adversarial_runtime.mjs` 硬編名稱/路徑（改名須連動） |
| `spec-to-done-adversarial-verify.js` | RETIRED：固定回報 retired_workflow、agentCallsUsed=0，不派工或修改狀態 | `docs/agents/spec-to-done-retirement.md` |
| `ship-item.js` | P6 bounded args validation；Workflow runtime 無 host capability 時 durable HELD | external trusted executor／broker 與啟用真相見 `ship-item.md` |
| `ship-item.md` | ship-item 的權威程序文件（非腳本） | `ship-item.js` 引用 |
| `repo-health-scan.js` | 五面向 repo 健檢唯讀掃描（版本漂移/清理/.claude 資產/文件同步＋進度差異） | `.claude/skills/repo-health/SKILL.md` 編排 |
| `plan-next-spec-to-done-aware.js` | RETIRED：固定回報 retired_workflow、agentCallsUsed=0，不派工或修改狀態 | `docs/agents/spec-to-done-retirement.md` |
| `plan-test-deploy-and-tidy.js` | 勘查測試區一鍵部署＋參數整理＋散落檔清理計畫 | 獨立 slash workflow（刻意無 skill 編排） |
| `fable5-repo-advisory.js` | 告別盤點：6 視角唯讀掃描＋合併去重＋懷疑者驗證 | 獨立 slash workflow（一次性盤點工具，保留可重跑） |
| `saas-blueprint-tournament.js` | **已退役**：PR #301 一次性 SaaS 文件產生器；舊 input packet／11-file contract 已不存在 | 保留同名入口並 fail-closed；current source 讀 `docs/plans/docs-plans-README.md` → `AI-BIM 前後端設計文件.dc.html` §01–§08 |
| `routing.json` | active `agent()` workflow 的模型 routing 資料（tiers/fallback 鏈） | `scripts/gen_routing.py` codegen 至上述 active JS 的 `// <routing:gen>` 區塊；retired/fail-closed workflow 不生成 |

## 命名備註

- `std-` ＝ 已退役的 spec-to-done 相容入口前綴；`fu-` ＝ 修復對抗複驗（fix-up verify）家族前綴。`fu-` 名稱被契約測試硬編，改名成本高於效益，維持現名並在此登錄定義（repo-health 2026-07-07 裁決）。
- 「獨立 slash workflow」＝僅靠 `export const meta.name` 被 harness 自動發現、無 skill/command 編排，屬刻意設計，非死碼。
- `saas-blueprint-tournament` 是歷史例外：保留 `meta.name` 讓舊呼叫得到明確 `retired_workflow`，但不再執行或生成文件；新需求須走 current core docs 與 OpenSpec change。
