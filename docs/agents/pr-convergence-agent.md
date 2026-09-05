# PR Convergence Agent — 狀態機、disposition、bounded retry、base sync

> 正本：`docs/plans/agent-hooks-ci-convergence-redesign.md` §7–§9。本檔是可執行契約的索引，不是第二套規則。
> Owner ruling D-6(a)（2026-09-04）：八個 state 是既有兩台 machine 的**投影**，不是新的持久化 machine。

## 1. 既有正本（不可取代）

| 機制 | 正本 | 本層如何使用 |
|---|---|---|
| review loop（`continue / held / complete`、`max_attempts = 2`、exact-identity 重啟、same-fingerprint 拒絕）| `scripts/lib/risk-proportional-review.mjs:1092-1164` | `deriveConvergenceState` 直接吃 `advanceReviewLoop` 輸出 |
| disposition 詞彙 `ACCEPTED / FIX_REQUIRED / FALSE_POSITIVE / DEFERRED / ESCALATE` 與強制規則 | `scripts/lib/autonomous-delivery-finalization.mjs:1027-1175` | `review-disposition-mapping.mjs` 把 reviewer 層六值**映射**進去，不新增第三套 |
| bundle 收斂 `escalated / held / passed` | 同上 `:1310-1411` | 作為 `bundle_status` 觀察值 |
| merge 前置條件與 HELD 理由 | `scripts/dev/manage-pr-queue.mjs:339-364` | `evaluateMergePreconditions` 只回報 `observed_ready`，`ready` 恆為 `false`；authority 在 server |

## 2. 新增的薄層（皆有測試，皆在 required `agent-governance` check 內執行）

| 檔案 | 用途 |
|---|---|
| `scripts/lib/pr-convergence-state.mjs` | `deriveConvergenceState(observation)` → 八 state 之一；`TRANSITIONS`；`retryCarriesNewInformation`；`evaluateMergePreconditions` |
| `scripts/lib/review-disposition-mapping.mjs` | reviewer 層 ↔ 交付層雙向 mapping；`unverified → ESCALATE`、高風險 class → ESCALATE 強制套用 |
| `scripts/lib/review-finding-registry.mjs` + `scripts/tests/review-finding-record.schema.json` | 以 `(head_sha, finding_id)` 為 key 的獨立 join record；`computeFindingFingerprint`（跨 head/round 穩定）；`sameFingerprintNoNewEvidence`；`classifyStaleness` |
| `scripts/base-sync-policy.json` + `scripts/lib/base-sync-policy.mjs` | base sync 四例外 predicate、封閉 reason enum、`classifyBaseSyncCounts` |

## 3. State 投影規則（優先序由上而下）

| 條件 | State | final sync？ |
|---|---|---|
| bundle `escalated` 或任一 finding `ESCALATE` | `ESCALATED` | 否 |
| loop `held`（含 `attempt_budget_exhausted`、`exact_identity_changed_restart_cycle`、`same_evidence_fingerprint_no_retry`）或 bundle `held` | `HELD` | 否 |
| loop `complete` ∧ threads 完整且 0 未解 ∧ 0 open `FIX_REQUIRED` ∧ 無 gate 執行中 | `CONVERGED` | **是，僅此一處** |
| gate 在 exact head 執行中 | `VERIFYING` | 否 |
| 有 open `FIX_REQUIRED` | `FIXING` | 否 |
| finding 待 disposition | `DISPOSITION` | 否 |
| `attempts_used == 0` | `REVIEW_PENDING` | 否 |
| `attempts_used == 1`，loop `continue` | `RE_REVIEW` | 否 |
| `attempts_used >= 2`，loop 仍 `continue` | `HELD` | 否 |

`HELD` / `ESCALATED` 無自動出口：離開需人類決定並開**新 run**。

## 4. Retry 何時算「新資訊」

`retryCarriesNewInformation(prev, next)` 只看五個欄位：`head_sha`、`input_sha256`、`policy_sha256`、`verification_manifest_sha256`、`evidence_fingerprint`。
**換 agent、換 model、重跑相同命令、重送相同 prompt 都不改變任何一個 → 不是新資訊 → 不消耗 round。** 這與 `advanceReviewLoop` 的身分 tuple 一致。

## 5. Finding fingerprint

`sha256(stable({origin, path, symbol, rule↓, title↓}))` — 排除 head、行號、時間、散文。同一缺陷在不同行再被回報仍碰撞；改 rule 或 path 才視為不同 finding。`round` 上限 2，由 schema 與 `assertRoundAdvance` 雙重釘死。

## 6. Base sync（owner 新增需求）

- 預設禁止；`origin/main` 前進不是理由，`BEHIND` 不是 conflict。
- 四例外：`real_conflict`（server 回報）、`semantic_overlap`（經 `verification-manifest.json` classifier + policy `boundary_globs`）、`protection_forced`（僅 `CONVERGED` ∧ merge sink ∧ `BEHIND`）、`base_affects_correctness`（`full_dispatch_globs` / security registry / 明列路徑）。
- 治理數字是 `discretionary_sync_count == 0`；`protection_forced` 回報、不設上限、永不違規；連續 3 次 → starvation warning，改序列化 merge。
- 計數由 GitHub server truth 推導（`artifacts/metrics/base-sync/`，gitignored）；agent 不得自行寫入 branch。
- 已修訂 `.claude/workflows/ship-item.md`：merge-base 相等只在 **final push** 前要求。

## 7. 明確不是本層的權限

- 不 merge、不 approve、不 resolve thread、不改 branch protection。
- 不讀 `.env`、不呼叫 GitHub（純函式）；`scripts/dev/collect-*.mjs` 的 `gh api` 皆為 GET。
- `ci-local-parity/v1` 與 `actions-baseline/v1` 永遠是 `advisory_only` / `measurement_only`。
