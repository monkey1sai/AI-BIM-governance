> Loaded lazily by `AGENTS.md` / `CLAUDE.md`. Generic routing source-of-truth: `C:\Users\IOT\.codex\docs\agents\task-routing.md`.

# AI-BIM Advanced Reasoning Overlay

This overlay adds only local composition rules. The global task-routing contract owns tiers, effort lanes, worker schemas, stopping rules, and evidence labels.

## When this overlay applies

Use the root repo policy to select Lane F/B/G and the global contract for model/effort routing. Default daily work to F or B; apply the local role map below when work crosses service boundaries, touches Kit/WebRTC runtime, changes auth/deploy/permissions, or makes a user-facing done claim.

## Local composition

- Lane F: single coordinator; no worker, plan document, spec, or mandatory GitNexus impact.
- Lane B: single coordinator; at most one debugger when root cause is unknown or one read-only reviewer at completion, following the root lane budget.
- Lane G: use `explorer`, `debugger`, `reviewer`, or `security_auditor` only for the independent risk surface that triggered governance.
- Lane S is retired with spec-to-done. Use Lane F/B/G for each explicitly authorized PR slice; keep review and merge gates.

Workers are read-only unless the coordinator grants a bounded, non-conflicting file scope. The coordinator owns source-of-truth loading, scope, writes, evidence synthesis, and final verification.

## Machine task packet

`scripts/tests/task-packet.schema.json` 定義 closed `task-packet/v2`；`scripts/tests/fixtures/agent-governance-routing.json` 是 16-case golden corpus，涵蓋 lane、scope、owner、worktree、read-set 上限、agent budget、gates、evidence、authorization requirement 與 escalation。`max_agents` 包含 coordinator；不是額外 child-agent 數。F/B/G 對應目前路由；S 僅保留為歷史資料驗證，不屬於可執行 lane。它不自行從 prompt 猜 lane，也不覆寫較高優先序指令。

以 `node scripts/dev/validate-task-packet.mjs --input <json>` 驗證 packet 或 corpus。JSON Schema 的 draft-07 `if/then` 與 JS semantic validator 共同 fail closed；CI 對 F/B/G 與歷史 S 格式的 cross-field mutations 做 parity regression。未知欄位、未知 enum、超出 read-set/agent budget、缺少 high-risk gate 或未標示「未授權」的外部動作均拒絕。Draft-07 無法表達物件陣列內的 `id` uniqueness，因此 executable consumer 必須經同一 CLI/runtime semantic gate，不能只跑 `Test-Json`。

Task packet validator **只驗結構，不授權執行**：結果固定為 `authorization_granted: false` 與 `authorization_scope: validation_only`。包含歷史 S packet 的結果另標 `retired_lane_validation_only: true`。v2 schema、golden corpus 與 `evaluateRoutingSignal` 保留 S／`explicit_spec_request` 的舊欄位，只供歷史相容性回歸；`external_lane_s_authorization_required` 和 `authorization_requirement: external_explicit_user_instruction` 都是歷史格式，不是目前可重啟 S 的權限。新任務一律依 root policy 選 F/B/G，明確 spec 需求也不恢復已退役 workflow。下游若展開 symbolic `read_set`，仍須另行執行 repo containment、檔案數與 byte budget 檢查。

## Risk-scoped review

When children exist, record one planning/adjudication assignment and follow the active global routing contract for provider-specific model and effort requirements. Use the minimum sufficient model, bounded prompt, evidence duty, and stop condition; do not add a child solely to satisfy an obsolete apex label. High-risk work retains an independent verifier/risk reviewer separate from the builder, plus every required sign-off and evidence gate. If a required capability or independent assignment is unavailable, report `HELD` for that dependent work; continue authorized independent preparation. Provider-specific requirements remain owned by the global contract and do not become another provider's dependency.

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

Use the smallest affected-area checks first, then the repo contract commands. Report verified facts, inferences, unverified risks, and next actions separately. For runtime/deploy work, preserve ownership evidence for ports and PIDs before any stop/restart action. Lane B runs one task/entry impact and detect_changes only for code-symbol/flow changes. Lane G retains shared-symbol impact and pre-commit detect_changes; Lane F relies on direct source, targeted tests, and diff unless scope expands.
