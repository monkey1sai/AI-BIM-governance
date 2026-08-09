# Tasks: Introduce Executable Architecture Contracts

## Phase 1 — Desired architecture and canonical validation

- [x] 1.1 Add `architecture/architecture-contract.json` with service, browser, data residency, readiness, invariant, delta, and exception contracts.
- [x] 1.2 Add Draft-07 JSON Schemas for architecture contract and architecture delta.
- [x] 1.3 Add the change's own `architecture/deltas/introduce-executable-architecture-contracts.json`.
- [x] 1.4 Implement standard-library semantic validation for cross-object constraints.
- [x] 1.5 Add fail-closed unit/contract tests for canonical success and negative cases.
- [x] 1.6 Wire architecture paths into the existing verification manifest's root-contract, agent-governance, and security dispatch.
- [x] 1.7 Document source-of-truth positioning, agent workflow, exceptions, and ratchet rollout.

## Phase 1：在真實 checkout 完成收口

- [x] 1.8 執行 `openspec validate introduce-executable-architecture-contracts --strict`。
- [x] 1.9 在真實 Windows checkout 執行 canonical `scripts/verify-all` planning 與 affected gates。
- [x] 1.10 執行 GitNexus `detect-changes --scope compare --base-ref main` 並記錄結果。
- [x] 1.11 Independent architecture review confirms the contract preserves current repo boundaries and does not over-claim observed conformance.

### Closeout evidence — 2026-07-30

- 1.8 passed change-specific strict validation; `openspec validate --all --strict` also passed 71 items with 0 failures.
- 1.9 remains open: `verify-all -PlanOnly` selected root contracts, agent governance, and secret/security gates; root contracts passed 181 tests and both secret/security checks passed, but the canonical run failed on pre-existing agent-skill integrity drift outside this change.
- 1.10 remains open: the command ran with the current checkout selected explicitly, but the index was stale and untracked payload files were not mapped; `No changes detected` is advisory, not an accepted gate pass.
- 1.10 invocation follow-up (2026-07-31): the earlier failure mode is now understood. `detect-changes` aborts with `Multiple repositories indexed` unless the checkout is disambiguated, because several worktrees of this repo are indexed under the same label. With `--repo "C:\Repos\active\iot\AI-BIM-governance"` the command completes and reports `Risk level: low`, `Affected processes: 0`. The task stays unchecked: the index still predates the new files, so only Markdown symbols were mapped and the Python modules added by Phase 2 are absent. The result is advisory, not a gate pass.
- 1.11 passed independent review after schema-instance enforcement was added and its missing-required/additional-property counterexamples were proven fail-closed.
- 狀態取代說明：上述 1.9 與 1.10 的「仍開放／保持未勾選」是 2026-07-30
  的歷史結果，已由下方 2026-07-31 的最終重跑證據取代。最終完成條件為
  1.9 的 canonical affected gates 全部通過，以及 1.10 的 fresh index 能映射
  implementation symbols，並完成兩個 feature commits 對各自
  pre-implementation parent 的比較；下方證據已滿足兩項，因此 checklist 與
  lifecycle ledger 同步為 16/26。

### 收口完成證據 — 2026-07-31

- 1.9 已在 Windows 的規定隔離 branch
  `codex/openspec/introduce-executable-architecture-contracts` 與 worktree
  `C:\Repos\active\iot\AI-BIM-governance\.worktrees\introduce-executable-architecture-contracts`
  重新執行。`verify-all -PlanOnly` 選出 root contracts、agent governance、
  secret-pattern scan 與 security exception policy；對應的 affected run 四項皆
  通過：294 個 root tests 通過、agent governance 通過、secret-pattern scan
  通過，security exception policy 回報 `valid` 且例外數為 0。Hosted
  dependency review 與 SAST 維持明確的 `not_configured`，未誤報為通過。
  PR #462 原有的 `fix/executable-architecture-contracts-closeout` 僅作
  byte-identical carrier ref；OpenSpec 修復、驗證與後續提交均以本段規定的
  branch/worktree 為唯一寫入工作面，approval 前須確認兩個 remote refs 指向
  同一 immutable head SHA。
- 1.10 先以現行整合基準建立 fresh exact-path GitNexus index（14,906 nodes、
  31,279 edges、300 flows）；精確 `context` 查詢已映射 Phase 1
  `validate_repository` 與 Phase 2 `check_observed_architecture` 的 callers 與
  contract tests。接著另以 disposable detached worktree 對兩個 feature commit
  建立獨立 fresh index，直接比較其各自的實作前 parent，避免只分析收口文件：
  - Phase 1 `567c29e9779c7e733135873498fff5798cc901e8` 對
    `f1c034f47e4bef3675fc3465604eabd95fb54ae9`：13 files、149 symbols、
    0 affected processes、`Risk level: low`；fresh index 為 14,273 nodes、
    29,834 edges、300 flows。
  - Phase 2 `8f2ff8b4cb840f1258cc36690f8a13f5f9783a9d` 對
    `243d9647190d2dbd84c60de6282e9bb15815c2f5`：15 files、233 symbols、
    4 affected processes、`Risk level: medium`；fresh index 為 14,663 nodes、
    30,793 edges、300 flows。受影響 flows 為 `Main → _is_mapping`、
    `Main → _issue`、`Main → _is_sequence` 與 `Main → To_dict`。
  以上比較均使用 `detect-changes --scope compare --base-ref <parent>`、linked
  worktree 的明確 `GIT_DIR` / `GIT_WORK_TREE`，以及 exact `--repo` path。
  task 原定的 literal `--base-ref main` 亦已在 fresh current index 執行；加入
  收口文件後回報 1 changed file、4 Markdown symbols、0 affected processes、
  `Risk level: low`。FTS 仍不可用，僅停用 full-text search，不影響 graph
  context 或 `detect-changes`。

## Phase 2 — Observed architecture ratchet

- [x] 2.1 Export service/module dependency observations ~~from GitNexus~~ into a deterministic report. **Deviation: GitNexus replaced by a standard-library static scan — see delivery note below.**
- [x] 2.2 Compare desired, intended, and observed dependency edges.
- [x] 2.3 Establish an approved baseline for existing cycles and forbidden edges.
- [x] 2.4 Fail on any new dependency edge not declared by contract + delta.
- [x] 2.5 Fail on any increase in cycle count or baseline violations.

### Phase 2 delivery notes — 2026-07-30

**Declared deviation (2.1).** The task text named GitNexus as the observation
source. GitNexus is not used as a gate input: its CLI has been repeatedly
observed to fail with transport errors and to serve a stale index (recorded in
`docs/plans/NOW.md`, S4-B closeout, "GitNexus: detect_changes 三次 Transport
closed, index stale"), which cannot back a fail-closed CI gate. The observation
is produced instead by a standard-library static scan
(`scripts/lib/observed_architecture.py`), matching the existing architecture
validator's no-production-dependency rule. GitNexus is recorded as
`advisory_only_sources` in `architecture/observed-graph.config.json`. The task
outcome — a deterministic observed dependency report — is unchanged; the source
of the observation is not.

**What the gate does and does not claim.**

- Service-level edges come from two low-false-positive signals only: schemed URL
  literals (`http/https/ws/wss://host:port`) resolved through the contract's own
  port ownership, and compose `depends_on` / env URLs. Runtime-resolved addresses
  are invisible to a static scan, so `web-viewer-sample → bim-streaming-server`
  is permitted by the contract but absent from the observed graph. The ratchet
  therefore blocks *new statically detectable* edges; it does not claim to have
  enumerated every real call.
- CORS / allowed-origin / CSP lines are suppressed, because an inbound
  allowlist is not an outbound dependency. Without this, `KIT_MANAGER_CORS_ORIGINS`
  produced a false `kit-manager-api → bim-review-coordinator` edge and a false
  service-level cycle.
- Cycle detection runs on the service graph plus each service's internal module
  graph. Cross-service module graphs are out of scope.
- `apps/kit-manager-web` reaches coordinator `:8004` but is not a declared
  contract service. It is recorded as `undeclared-node` debt in
  `architecture/observed-baseline.json`, owned by this change and targeted at
  Phase 3. Declaring the node is a desired-architecture change and needs its own
  delta; it must not be resolved by re-baselining.

**Baseline approved on 2026-07-30**: 7 service edges (5 contract-declared,
2 undeclared-node debt) and 3 module-level cycles (streaming Kit extension
entry point, governance `diff_engine`, viewer `App`/`Window`/`StreamOnlyWindow`),
each with an owner, reason, and target phase.

**`ARCH-GRAPH-001` moved from `planned` to `active`.** The "Honest phased
enforcement" requirement in this change's spec delta previously said the invariant
SHALL remain planned; it is modified in the same PR to define when activation is
permitted (an executable gate in canonical verification, an approved baseline with
attributed debt, and documented scope limits). Activating it without that spec
change would have contradicted this change's own normative text.

**Three-layer adversarial review findings fixed before merge.** Independent
reviewers found five ways the gate could report `passed` without actually
enforcing anything. All are fixed and covered by regression tests:

1. A file containing valid-but-non-object JSON (`null`, `[]`, `123`) made the
   loader return zero issues, so `echo null > observed-baseline.json` produced a
   green run. Non-object documents now raise explicit errors, and `RatchetResult`
   carries a `compared` flag so a run that never reached the comparison cannot
   report `passed`.
2. Relative imports in a package without `__init__.py` resolved to `.sibling` and
   were dropped, leaving `kit-manager-api` with an empty module graph and its
   cycle budget unenforceable. Fixed; that service now has 9 module edges.
3. Suppression patterns were matched against the raw line including comments, so
   a trailing `// not a CORS thing` silently deleted a real edge. Suppression now
   runs on comment-stripped code (`tokenize` for Python).
4. A baseline entry short-circuits the contract check, and `status` was never
   verified — mislabelling a forbidden edge as `declared` bypassed everything.
   Declared entries are now checked against the contract.
5. A mistyped or renamed scan root silently scanned nothing. Missing roots now
   fail closed.

Also fixed: the TypeScript scanner treated `</h1>` as a regex literal and
`<code>/api/kit/*</code>` as a block-comment opener, either of which silently
erased every dependency in the rest of a file; delta declarations used a global
`added - removed` difference, so one historical removal permanently vetoed any
later legitimate re-declaration; and unreadable or unparseable files were skipped
without a trace.

A third independent verification round re-tested every fix and found four more:

6. The two `*.schema.json` files were themselves unvalidated, so replacing one
   with `null` disabled all `required` / `enum` / `additionalProperties` checks
   while still reporting `passed`. Corrupt schema files now fail, and the
   baseline's `status` enum, debt attribution, and duplicate-pair checks are
   additionally enforced in Python so a single corrupt file cannot disable them.
7. Emptying a service's `inbound_edge_ports` removed it from the port ownership
   map, making every future call to it invisible instead of flagged — with no
   error or warning. Services must now either declare inbound ports or be marked
   `browser_client`.
8. A `.py` file containing a NUL byte crashed the scan with an uncaught
   `ValueError` (`read_text` accepts NUL, `ast.parse` rejects it) instead of
   producing a structured finding.
9. In a region the scanner declined to strip, the `//` inside `http://` was read
   as a line-comment opener and erased the rest of the line, including any real
   dependency after it. `://` is now never a comment opener.

The same round confirmed by differential testing against two independently
written implementations (2000 random graphs) that the iterative Tarjan SCC
implementation is correct, and confirmed byte-identical repeat runs.

**Known limits, not claimed as solved**: the TypeScript scanner is a heuristic
state machine, not a parser. Its `clean` flag catches structural failures
(unterminated block comment or template) but cannot detect every misread. The
canonical-repository test is a snapshot of today's tree and is not a
mutation-detection net; that role belongs to the constructed negative tests.

**Verification**: `python -m pytest tests -q` — 283 passed on the real Windows
checkout (was 237 before this change's tests, 181 before Phase 1); the canonical
ratchet passes against a baseline generated on Linux, confirming cross-platform
byte parity. `python scripts/dev/export_observed_architecture.py --strict`
PASSED (205 files, 7 edges, 3 cycles, 0 errors, 0 warnings).

## Phase 3 — Language-specific structural contracts

- [x] 3.1 Add TypeScript ~~dependency-cruiser~~ layer rules for UI/application/client/domain boundaries. **Deviation: dependency-cruiser replaced by a standard-library layer checker — see delivery note below.**
- [x] 3.2 Add Python ~~Import Linter~~ layer contracts for API/application/domain/infrastructure layers. **Deviation: import-linter replaced by the same standard-library layer checker — see delivery note below.**
- [x] 3.3 Route the new structural checks through `verification-manifest.json`.

### Phase 3 交付紀錄

**已宣告的偏離（3.1／3.2）。** 任務原文指名 `dependency-cruiser`（npm）與
`import-linter`（pip）作為 enforcement 工具，兩者皆未採用。canonical root-contract
CI job 在 `windows-latest` 上只安裝 `pytest` 與 `jsonschema`，導入 import-linter 必須
修改 `.github/workflows/ci.yml`；`apps/kit-manager-web` 沒有 `package-lock.json`，
無法把 dependency-cruiser 釘在可重現版本；且兩者都不保證本 repo 對 architecture
產物所要求的 Windows／Linux byte-identical 輸出。分層邊界改由
`scripts/lib/layered_architecture.py` 這個純標準函式庫 checker 執行，重用 Phase 2
已經過九項對抗修補的 module graph extractor，並沿用同一套 ratchet／baseline 紀律。
這與已宣告的 2.1 GitNexus 偏離同型：任務**產出**（可執行的
UI/application/client/domain 與 API/application/domain/infrastructure 邊界契約，
在 canonical verification 中 fail closed）不變，**工具**不同。偏離同時以機器可讀形式
記於 `architecture/layer-contract.json` 的 `tooling_deviation`，並由
`tests/test_layered_architecture.py::test_canonical_contract_discloses_the_tooling_deviation`
斷言，因此只能被後續 change **supersede，不得刪除**。日後真的導入這兩個工具仍然可行，
屬 additive。

**落地內容。** `architecture/layer-contract.json` 以有序、first-match-wins 的規則，把
六個 service 共 207 個被掃描的 module 全數指派到層；每個 service 另外宣告自己的語言與
「由哪些層組成」，每個語言宣告窮舉的 allowed 依賴矩陣——某層若沒有 `allowed` 列會直接
報錯，而不是預設為寬鬆。`architecture/layer-baseline.json` grandfather 兩筆真實違規：
`bim-streaming-server` 的 `kit_struct_log → messaging`（logging adapter 經由
`from . import` 連帶把 Kit extension 進入點拉進來），以及 `web-viewer-sample` 的
`lib/structLogBootstrap.ts → config/env.ts`，各自帶 owner、reason 與 target phase，
且 gate 會強制 per-service budget 等於 grandfather 的數量。
`architecture/architecture-contract.json` 把 `ARCH-LAYER-001` 標為 active，本 change 的
delta 以 additive `public_contract_changes` 宣告 layer ratchet，
`scripts/verification-manifest.json` 把兩個新 script 路徑同時納入 `root-contracts`
的 path class 與 target，因此只改 checker 的變更現在會 dispatch 到它自己的測試。

**驗證（Windows governed worktree，Python 3.12.7／pytest 8.2.2／jsonschema 4.25.1）：**

- `python -m pytest tests -q -p no:cacheprovider` — **373 passed**（本 change 之前為 294，新增 79）。
- `python scripts/dev/check_layered_architecture.py --repo-root . --strict` — PASSED；207 個掃描檔、6 個 layered service、2 筆 grandfathered 違規、0 error、0 warning，exit 0。
- `python scripts/dev/export_observed_architecture.py --repo-root . --strict` — PASSED；0 error、0 warning（Phase 2 ratchet 未受影響）。
- `python scripts/dev/validate_architecture_contract.py --repo-root . --strict` — PASSED；0 error、0 warning。
- `npx openspec validate introduce-executable-architecture-contracts --strict` — passed。
- `npx openspec validate --all --strict` — **71 passed, 0 failed**。
- `node scripts/tests/test-openspec-machine-truth.mjs` — 24/24。
- `node scripts/tests/test-verification-plan.mjs` — 22/22；只改 `scripts/lib/layered_architecture.py` 會選中 `root-contracts` target，指令與 CI 相同。
- `git diff --check` — clean。

**跨平台 byte 一致性（實測，非宣稱）。** `check_layered_architecture.py --report-only`
在同一棵樹上於 **Windows 與 Linux** 都產生 MD5 `9e94d7996dee11baff7aa1a38d3627c9`
（24423 bytes）。Phase 2 只以程式紀律加上同 OS 重跑來主張這個性質，這是第一次跨作業系統
實際量測。

**三層交叉對抗驗證（三輪，refute-by-default）。** 第一輪在六個 service 各植入真實的
禁止 import，全部被準確攔下；接著找出五種在真實劣化下仍能讓測試全綠的路徑。修補：
`layer_sets` 同語言重複列或 `services` 同 id 重複現在報錯而非靜默覆蓋
（`layer_contract.duplicate_language`／`duplicate_service`）；每個 service 宣告自己的層集合，
把 service 壓成單層的寬規則會報錯（`layer.service.layer_set_drift`）；`suffix` 規則一律
禁止、`prefix` 值必須以 `/` 或 `.` 收尾，因此新增的頂層 `.tsx` 會觸發
`layer.module.unassigned` 而不是預設成 `ui`；budget 高於 grandfather 數量由 gate 擋下，
而不是靠一條可被刪掉的測試（`layer.budget_slack`）；schema 檔被換成 `{}` 或其他無約束
stub 會被拒絕（`*.schema_vacuous`）。

第二輪確認其中五項成立，並攻破兩項。兩者失敗形狀相同：**gate 在拿 contract 跟自己比對**。
把某 service 宣告的 `layers` 改成與被壓平的規則集合一致，或把 `allowed` 矩陣其中一列放寬，
都能在測試全綠的情況下洗掉一筆真實違規。由於「policy 被改鬆」不是一個對**observed 狀態**
做 ratchet 的機制能偵測的事，修法是加上獨立的 pin：`PINNED_SERVICE_LAYERS`、
`PINNED_ALLOWED_MATRIX`、寫死的 per-service 語言、寫死的 layered service id 集合，以及兩份
schema 檔的關鍵約束鍵，全部以字面值放在 `tests/test_layered_architecture.py`。放寬 contract
因此必須在同一個 diff 裡改測試檔，這正是讓它在 review 中現形的手段。第二輪另外產出
`layer_contract.service_layers_missing`（在 Python 端重複把關，避免被 stub 過的 schema 關掉
drift 檢查）、rule 與 declared layer 改以該 service 自己的語言（而非所有語言的聯集）驗證，
以及 layer contract 與 observed-graph config 之間的 `layer_contract.language_mismatch`。

第三輪為 PR 上三個獨立 reviewer（CodeRabbit、Copilot、Codex connector）提出的意見，全部採納：
baseline 的 `entry_incomplete` 先前以 `str(entry.get(...))` 取值，`str(None)` 是非空字串，
使該守衛對缺欄位／`null` 完全失效，現改為先檢查原始值；同一 `from` 層出現兩列 `allowed`
會被拒絕（`layer_contract.duplicate_allowed_row`）；`--report-only` 在有無法讀取或無法解析的
來源檔時改為 exit 1（局部掃描產出的報告不得被當成 baseline 提交），並在 `--help` 中明寫
`--report-only` 會忽略 `--format` 與 `--strict`；`openspec/lifecycle-ledger.json` 的
`subject_commit` 由已不可達的 `6424a6d…` 改綁到本 change 內含最終 `tasks.md` 的 commit。

**已由測試覆蓋的 fail-closed 行為。** contract／baseline 缺檔或非物件；schema 檔被換成
`null`、`{}`、`{"properties":{}}`、`{"required":[]}` 或 `{"type":"object"}`；`schema_version`
不符；出現未宣告屬性；`allowed` 矩陣少一層或指到未宣告的層；同語言重複列；同 service 重複項；
同一 `from` 重複的 `allowed` 列；rule 指到不屬於該 service 語言或未被該 service 宣告的層；
重複 rule；`suffix` 規則；未錨定的 `prefix`；重複 baseline 項；baseline 缺欄位或欄位為 `null`；
baseline debt 被拿掉（在 Python 端重複把關，corrupt schema 關不掉）；沒有任何 rule 命中的
module；掃不到 module 的 service；observed layer 集合與宣告不符的 service；被掃描但既未 layer
也未 exclude 的 service；沒有理由的 exclusion 或針對未被掃描 service 的 exclusion；budget 缺漏、
有寬鬆額度或指向未 layer 的 service；以及數量不變的違規對調。違規身分是
`(service, from, to)`、不含層名，因此重新貼標籤無法把已 grandfather 的違規變成新違規。
`compared` 在每一條提早返回的路徑上都維持 false，所以沒跑到比對的執行永遠不會回報 `passed`。

**未宣稱解決的已知界線。** 完整清單見 `architecture/README.md`
§「Phase 3 的已知偏離與界線」；其中最關鍵的幾項：

- **放寬 `layer-contract.json` 是 review-enforced，不是 gate-enforced。** ratchet 判的是
  observed 狀態相對於已核准 baseline，不判 policy 有沒有被改鬆。測試檔裡寫死的 pin 是唯一的
  機械防線，它的作用方式是逼放寬動作出現在 diff 裡。
- **Python 絕對 intra-service import 看不到。** `services/kit-manager-api` 裡的
  `from app.x import y` 不產生 edge 也不產生 diagnostic，因為 Phase 2 的 extractor 只解析
  相對 scan root 的 module id；相對寫法會被抓到。目前樹上沒有這種寫法，所以是**現存的洞、
  不是現存的債**；要修得動 Phase 2 的 `_resolve_python_target`，不在本 phase 範圍。
- **大小寫不符的 TypeScript 相對 import 會被靜默丟掉。** canonical runner 是
  `windows-latest`，而 `web-viewer-sample/tsconfig.json` 未開
  `forceConsistentCasingInFileNames`，這種 import 在執行期可用卻對 gate 隱形。
- 本 gate 只判方向，module-level cycle 仍由 `ARCH-GRAPH-001` 持有；同層 edge 一律放行，
  這不等於該設計健康。
- 被 `architecture/observed-graph.config.json` 排除的檔案不會被 layer 化，因此改
  `exclude_file_suffixes` 可以把 module 移出 enforcement。
- `violation_budgets` 目前是需人工同步的交叉檢查，不是獨立防線；warning 不會讓 `status`
  變 failed，只有 `--strict` 與 `test_canonical_repository_layer_ratchet_passes` 把它當紅燈。
- `bim-streaming-server` 與 `kit-manager-api` 只有 `exact` 規則，因此在其中新增任何 Python
  module 都必須同時改 contract。這個成本是刻意的。
- `observed-baseline.json` 持有的 `apps/kit-manager-web` undeclared-node 債務未被本 change 觸動。

## Phase 4 — Executable lifecycle contracts

- [x] 4.1 Define `review-session` state machine.
- [x] 4.2 Define `endpoint-lease` state machine.
- [x] 4.3 Define `stage-binding` state machine.
- [x] 4.4 Add model-based tests for forbidden shortcuts and evidence-gated transitions.

### Phase 4 交付紀錄 — 2026-08-05

**落地內容。** `architecture/lifecycle-contract.json`（＋ Draft-07 schema）以機器可讀形式宣告三個
coordinator 端狀態機的 current runtime truth：states（含 kind 與 declared-only 標記）、observed
transitions（含 trigger、evidence_required、failure_code、effects）、forbidden shortcuts（附
enforced_by）、evidence 宣告、reentry 規則、兩條 cross-machine 規則（stage-binding 需 open
session＋active primary lease；session close 級聯釋放 lease）與 readiness binding（五個
evidence 綁到 provider）。`scripts/lib/lifecycle_contracts.py`（純標準函式庫，重用 Phase 1/3 的
`_load_document`／`validate_schema_instance`）驗證：machine well-formedness（initial 可達性
BFS、terminal 封閉、forbidden pair 無直達邊、同 `(from, trigger)` 唯一目標、evidence／
cross-machine／readiness 引用完整性、duplicate 偵測、declared-only state 不得接線）、**TS union
state 集同步**（`SessionStatus`／`ViewerLeaseStatus`／`StageBindingStatus` 的字面 union 與
contract 雙向相等；非純字面 union 整個 fail closed）、readiness binding 與
`review-session-ready` policy 的 evidence 集雙向相等。`ARCH-LIFECYCLE-001` 因 gate 實際跑在
canonical root-contract dispatch 而標 `active`；delta 以 additive `state_machine_changes`
申報三個 machine（首次機器化宣告，無 runtime 行為變更）。

**Runtime 真相的兩個誠實記錄。** `review-session.failed` 由 union 宣告但零 runtime 寫入路徑
（`sessionStore.setStatus` 存在、零呼叫者），contract 記為 `runtime_write_path: "declared_only"`
且不參與 transition；`created → active` 不存在 runtime 轉移（activation 於建立時由 kit binding
有無決定），contract 把兩者都標 initial 而非虛構轉移。接上任一路徑都屬 behavioral
state-machine change，須申報 delta。

**4.4 model-based tests。** `tests/test_lifecycle_contracts.py`（52 項）從 canonical contract
載入 transition system 後**枚舉全部 simple paths** 斷言性質，而非手寫個案：每條 forbidden pair
無單步邊；`pending → active` 的每條路徑必經 `executing` 且 evidence 聯集恰為
`{attempt-binding-match, runtime-load-outcome}`；每條 forbidden-pair 繞行路徑必經 intermediate
state；terminal 全封閉；全 state 可達或 declared-only；`(from, trigger)` 決定性；lease terminal
不可達 `active`（復活禁止）。Pin 防線與 Phase 3 同型：`PINNED_STATES`／`PINNED_FORBIDDEN`／
`PINNED_EVIDENCE_GATED_TRANSITIONS`／`PINNED_SOURCE_BINDINGS`／`PINNED_READINESS_EVIDENCE`／
schema load-bearing keys 全部寫死在測試檔，放寬 contract 必須連同改測試。負例覆蓋：缺檔／
非物件／vacuous schema（`{}`、`{"type":"object"}` 等四型）／schema_version 錯／terminal 出邊／
forbidden 直達邊矛盾／未宣告 evidence／不可達 state／declared-only 接線或標 initial／
duplicate（machine、state、transition、self-loop）／nondeterministic／unknown owner service／
cross-machine 與 cascade 的 unknown machine･state･trigger･transition／readiness 缺綁･多綁･
unknown policy･unknown provider･machine evidence 不符／source 刪 state･加 state･type 改名･
union 引用他型･檔案缺失／`..` path escape／unused evidence 降 warning 不 fail。另有獨立於
checker 的 `test_runtime_source_unions_match_pinned_states` 直接讀三個 TS 檔比對 pin。

**驗證（Windows governed worktree，Python 3.12.7／pytest 8.2.2／jsonschema 4.25.1）：**

- `python -m pytest tests -q -p no:cacheprovider` — **445 passed, 9 skipped**（本 change 之前
  乾淨樹為 393 passed，新增 52）。
- `python scripts/dev/check_lifecycle_contracts.py --repo-root . --strict` — PASSED；3 machines、
  13 states、15 transitions、0 error、0 warning，exit 0。
- `python scripts/dev/check_layered_architecture.py --repo-root . --strict` — PASSED（Phase 3
  ratchet 未受影響）。
- `python scripts/dev/export_observed_architecture.py --repo-root . --strict` — PASSED（Phase 2
  ratchet 未受影響）。
- `python scripts/dev/validate_architecture_contract.py --repo-root . --strict` — PASSED
  （`ARCH-LIFECYCLE-001` 與 delta 的 `state_machine_changes` 均通過 Phase 1 semantic validator）。
- `node scripts/tests/test-verification-plan.mjs` — 23/23；`root-contracts` path class 與 target
  已含 `scripts/lib/lifecycle_contracts.py` 與 `scripts/dev/check_lifecycle_contracts.py`。
- `node scripts/tests/test-openspec-machine-truth.mjs` — 24/24。
- `npx openspec validate introduce-executable-architecture-contracts --strict` — passed。
- `npx openspec validate --all --strict` — **71 passed, 0 failed**。
- `git diff --check` — clean。

**未宣稱解決的已知界線**（完整清單見 `architecture/README.md` §「Phase 4 的已知偏離與界線」）：
gate 驗 contract 一致性與 state 集同步，**不驗 transition 的執行期行為**（由各 service 測試持
有）；source 掃描只支援純字面 TS union（其他形狀 fail closed）；Kit 側 `loading_state`／
`runtime_state` 與 kit-manager-api 的 KitInstance 生命週期不在本 gate；放寬 contract 屬
review-enforced（pin 逼 diff 現形），非 gate-enforced；cross-machine 規則只驗引用完整性，
不模擬多機器組合時序。

## Phase 5 — Continuous architecture learning

- [ ] 5.1 Classify recurring `$improve-codebase-architecture` findings.
- [ ] 5.2 Promote recurring findings to invariants, validators, or structural tests.
- [ ] 5.3 Publish architecture quality grade and baseline trend without auto-merging repairs.
