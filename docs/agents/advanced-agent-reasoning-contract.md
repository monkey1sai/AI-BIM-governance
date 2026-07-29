> Loaded lazily by `AGENTS.md` / `CLAUDE.md`. Generic routing source-of-truth: `C:\Users\IOT\.codex\docs\agents\task-routing.md`.

# AI-BIM Advanced Reasoning Overlay

This overlay adds only local composition rules. The global task-routing contract owns tiers, effort lanes, worker schemas, stopping rules, and evidence labels.

## When this overlay applies

Use the global routing contract to select Lane F/B/G/S. Default daily work to F or B; apply the local role map below when work crosses service boundaries, touches Kit/WebRTC runtime, changes auth/deploy/permissions, or makes a user-facing done claim.

## Local composition

- Lane F: single coordinator; no worker, plan document, spec, or mandatory GitNexus impact.
- Lane B: single coordinator; at most one debugger when root cause is unknown and one read-only reviewer at completion.
- Lane G: use `explorer`, `debugger`, `reviewer`, or `security_auditor` only for the independent risk surface that triggered governance.
- Lane S: full spec-to-done P0–P7 role composition after explicit invocation only.

Workers are read-only unless the coordinator grants a bounded, non-conflicting file scope. The coordinator owns source-of-truth loading, scope, writes, evidence synthesis, and final verification.

## Machine task packet

`scripts/tests/task-packet.schema.json` 定義 closed `task-packet/v2`；`scripts/tests/fixtures/agent-governance-routing.json` 是 16-case golden corpus，涵蓋 lane、scope、owner、worktree、read-set 上限、agent budget、gates、evidence、authorization requirement 與 escalation。`max_agents` 包含 coordinator；不是額外 child-agent 數。它是對本檔／root lane 規則的 executable projection，不自行從 prompt 猜 lane，也不覆寫較高優先序指令。

以 `node scripts/dev/validate-task-packet.mjs --input <json>` 驗證 packet 或 corpus。JSON Schema 的 draft-07 `if/then` 與 JS semantic validator 共同 fail closed；CI 對 F/B/G/S 的 cross-field mutations 做 parity regression。未知欄位、未知 enum、超出 read-set/agent budget、缺少 high-risk gate 或未標示「未授權」的外部動作均拒絕。Draft-07 無法表達物件陣列內的 `id` uniqueness，因此 executable consumer 必須經同一 CLI/runtime semantic gate，不能只跑 `Test-Json`。

Task packet validator **只驗結構與 routing contract，不授權執行**：結果固定為 `authorization_granted: false`。Lane S packet 不再包含可自我宣告的 `explicit_trigger`，只能宣告 `authorization_requirement: external_explicit_user_instruction`；實際授權必須來自 packet 外、目前對話中的明確 user instruction。closed routing signal evaluator 只回傳 expected minimum lane 與是否需要外部 Lane S 授權，不讀取或保存 prompt，也不能把普通的 `complete`／`do it` 字樣升格為 Lane S。下游若展開 symbolic `read_set`，仍須另行執行 repo containment、檔案數與 byte budget 檢查。

## Apex slot

Every dispatch with at least one child must satisfy the global apex-slot invariant before work starts. The primary counts only when its actual provider model and effort meet the global apex mapping; otherwise reserve an independent apex planner, reviewer, or decision role. If that assignment is unavailable, return `HELD` without dispatching. Other workers use the minimum sufficient model, effort, bounded prompt, evidence duty, and stop condition; high-risk builder and apex reviewer remain separate assignments.

## AI-BIM evidence contract

For user-facing capability, verify a real frontend route and explicit main button, use the default fixture, call the coordinator API, observe the runtime action/result, and capture visible loading/success/failure/retry state with the runtime ID. Record:

```text
Frontend route:
Main button(s) tested:
Fixture used:
Backend API called:
Runtime action / ID:
Visible success or failure state:
E2E command:
Screenshot / trace:
Known gaps:
```

Backend-only tests do not establish frontend completion. Full-system E2E requires both governance CPU semantic evidence and Kit WebRTC visual/runtime evidence. If an external service is absent, label the UI `DEMO DATA`, `NOT BUILT`, or `not observed`.

## Verification and reporting

Use the smallest affected-area checks first, then the repo contract commands. Report verified facts, inferences, unverified risks, and next actions separately. For runtime/deploy work, preserve ownership evidence for ports and PIDs before any stop/restart action. Lane B runs one task/entry impact and detect_changes only for code-symbol/flow changes. Lane G/S retain shared-symbol impact and pre-commit detect_changes; Lane F relies on direct source, targeted tests, and diff unless scope expands.
