---
name: spec-to-done
description: Use for explicit spec-to-done/full Superpowers, an approved spec with explicit autonomous delivery through a merged PR, or an existing run resume.
---

# spec-to-done

Load for explicit spec-to-done/full Superpowers, an approved spec with explicit autonomous delivery through a merged PR, or an existing run resume.
「實作 spec」、「完成需求」、「使用 agents」本身不啟動此流程。

主代理負責完成可驗證切片，直接做已授權的規劃、實作與工具檢查。
獨立 review 只用於需要另一個判斷的範圍；不得為流程形式委派、重建 spec 或重審未變輸入。

## Invariants
- Evidence before completion. Deterministic verification before model judgment.
- `agent-contracts/spec-to-done.contract.json` 擁有 P0,P1,P3,P4,P5,P6,P7、closed enum、durable state 與 P7 terminal evidence。
- standalone state：`artifacts/spec-to-done/{slug}-state.md`；使用單一 `.claude/skills/spec-to-done/validate-state.mjs`，不手工推論 state 合法。
- maxAgentCalls=40；maxP5VerifierBatches=2；maxP5Rounds=2；maxEvidenceAttempts=2。resume/retry 不歸零。
- 一個 branch/worktree 一個 writer，遵守 repo containment、GitNexus risk、授權與安全 sign-off。Skill 不擴張 push/merge/deploy/process-stop 授權。
- P4 browser evidence、P5 immutable verification、P6 ship-item、人類 exact-head approval、P7 remote evidence 都保留。缺失記 HELD，不把單切片完成當全 spec 完成。
- host 的實際工具與模型是執行來源；Codex 無須模擬 Claude 子代理拓撲。不得宣稱未執行的 workflow/runtime 已通過。

## Load only the current phase
下表路徑全部相對 repo root；只讀当前 phase 的 reference，切換時再載入。
| 目前工作 | 載入 |
|---|---|
| P0 需求、隔離、初始 args | .claude/skills/spec-to-done/references/intake.md |
| P1 計畫／P3 實作 | .claude/skills/spec-to-done/references/implementation.md |
| P4 user-facing browser evidence | .claude/skills/spec-to-done/references/p4.md |
| P5 immutable review／fix | .claude/skills/spec-to-done/references/p5.md |
| 已授權的 P6／P7 delivery | .claude/skills/spec-to-done/references/delivery.md |
| 首次寫 state、resume／handoff | .claude/skills/spec-to-done/references/state.md |
| 實際遇到 HELD | .claude/skills/spec-to-done/references/gates.md |
| 收到 Fabric binding | .claude/skills/spec-to-done/references/fabric.md |
| 重複 reviewer dispatch／retry | .claude/skills/spec-to-done/references/review-reuse.md |
| 已授權 runtime／deployment 操作 | .claude/skills/spec-to-done/references/runtime.md |

不要預載全表。操作細節由相應 scripts/schema 驗證；同一 evidence 沒有新資訊就不再呼叫 reviewer。
