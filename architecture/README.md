# Executable Architecture Contracts

本目錄把 `docs/plans/` 的目標架構與 `AGENTS.md` / `docs/agents/` 的服務邊界，抽成可由 CI 驗證的 machine contract。它不是另一份會取代程式碼的架構說明，也不宣稱尚未完成的 runtime 已經存在。

## 1. Source of truth 定位

Runtime / product truth 仍遵循 repo 既有優先序：

```text
1. implementation
2. executable tests and contracts
3. docs/plans target behavior and acceptance semantics
4. AGENTS.md and docs/agents boundaries
5. generated or historical artifacts
```

因此：

- `architecture-contract.json` 定義 **允許形成的 desired architecture**。
- `architecture/deltas/*.json` 定義每次 governed change 的 **intended delta**。
- 程式碼、測試、GitNexus 與後續 dependency analyzers 描述 **observed architecture**。
- 若 desired 與 observed 不一致，必須標記 implementation gap；不得修改 contract 來替不良實作開脫。

## 2. 檔案

```text
architecture/
├── architecture-contract.json
├── architecture-contract.schema.json
├── architecture-delta.schema.json
├── observed-graph.config.json
├── observed-graph.config.schema.json
├── observed-baseline.json
├── observed-baseline.schema.json
├── deltas/
│   └── <change-id>.json
└── README.md
```

- `architecture-contract.json`：服務責任、允許依賴、browser access、資料落地、readiness evidence、invariants 與 exception policy。
- `architecture-contract.schema.json`：desired architecture 的結構 schema。
- `architecture-delta.schema.json`：每次變更的 machine-readable delta schema。
- `deltas/<change-id>.json`：新增／刪除 dependency edge、public contract、ownership、state machine 與 exception 的聲明。
- `observed-graph.config.json`：observed 靜態掃描設定（目錄→service 對映、掃描排除、可視為 inbound target 的 port、誤報抑制樣式）。
- `observed-baseline.json`：**已核准的 observed baseline**（grandfathered edge 與 cycle）。ratchet 只放行這裡有的東西，其餘 fail closed。

## 3. 第一版硬規則

| ID | 規則 | 第一版 enforcement |
|---|---|---|
| `ARCH-DATA-001` | IFC / RVT / DWG / USD / USDC / mapping 大檔留在 customer edge，cloud 只收 metadata | semantic validator |
| `ARCH-HTTP-001` | Browser HTTP API 只進 `bim-review-coordinator:8004` | semantic validator |
| `ARCH-SVC-001` | 每個 capability 只有一個 owner，owner 與 `must_not` 不得衝突 | semantic validator |
| `ARCH-CALL-001` | 新 service edge 必須同時存在於 desired contract 與 change delta | semantic validator |
| `ARCH-GRAPH-001` | 不得新增 dependency cycle | observed-graph ratchet（已 active） |
| `ARCH-READY-001` | `ready` 必須同時有 Kit-side 與 browser-side evidence，包括 first frame 與 stage match | semantic validator + existing runtime evidence |
| `ARCH-UI-001` | user-facing capability 必須前端可操作並有 browser E2E evidence | delegated to existing frontend operability gates |
| `ARCH-DELTA-001` | Lane G / S 架構變更必須提交 architecture delta | delta schema + semantic validator |
| `ARCH-EXC-001` | 例外必須有 owner、ADR、理由與 expiry，過期 fail closed | semantic validator |
| `ARCH-TRUTH-001` | docs/plans 不能單獨用來宣稱 runtime 已完成 | semantic validator + agent governance |

## 4. Agent 工作流

Lane G / S 或任何會改變服務邊界、public contract、ownership、state machine 的工作，先建立：

```text
architecture/deltas/<change-id>.json
```

順序：

```text
human intent / docs-plans
→ desired architecture contract
→ architecture delta
→ implementation
→ observed graph / tests / runtime evidence
→ architecture review
```

Builder 不得為了讓自身程式通過而自行放寬 contract。若真的需要例外，必須填入：

```text
invariant_id
owner
reason
adr
created_on
expires_on
```

含 breaking contract、ownership change 或 exception 的 delta，必須顯式核准。

## 5. 驗證

Targeted validation：

```powershell
python scripts/dev/validate_architecture_contract.py --repo-root . --strict
python -m pytest tests/test_architecture_contract.py -q -p no:cacheprovider

# observed ratchet（Phase 2）
python scripts/dev/export_observed_architecture.py --repo-root . --strict
python scripts/dev/export_observed_architecture.py --repo-root . --report-only --output artifacts/architecture/observed-dependencies.json
python -m pytest tests/test_observed_architecture.py -q -p no:cacheprovider
```

`--report-only` 產出的 report 是 **可重生的本機產物**（`artifacts/architecture/` 已 gitignore），同一份 source tree 在 Windows 與 Linux 會得到 byte-identical 輸出。入庫的權威是 `observed-baseline.json`。

Canonical dispatch：

```powershell
.\scripts\verify-all.ps1 -PlanOnly -ChangedPath architecture/architecture-contract.json
.\scripts\verify-all.ps1 -ChangedPath architecture/architecture-contract.json
```

OpenSpec：

```powershell
openspec validate introduce-executable-architecture-contracts --strict
openspec validate --all --strict
```

## 6. Ratchet 原則

第一版不要求一次清掉所有歷史結構問題。observed graph gate 採：

```text
existing violations <= recorded baseline
new violations == 0
```

具體規則（`scripts/lib/observed_architecture.py`）：

| 情況 | 結果 |
|---|---|
| observed edge 已在 `observed-baseline.json` | pass（grandfathered） |
| **新** edge 不在 contract `may_call` | `observed.edge.not_allowed`（error） |
| **新** edge 在 contract 但沒有任何 delta 宣告 | `observed.edge.undeclared`（error） |
| **新** edge 同時被 contract 與 delta 宣告 | pass |
| 新 cycle signature 或 cycle 數超出 `cycle_budgets` | `observed.cycle.new` / `observed.cycle.count_increase`（error） |
| baseline 有但已不再 observed | `*.baseline_stale`（**warning**，提示收緊 baseline） |
| config/baseline/contract/schema 不是 JSON object、scan root 不存在、非 browser client 卻沒有 `inbound_edge_ports`、baseline 把不被 contract 允許的 edge 標成 `declared`、baseline status 非法或 `(from,to)` 重複、來源檔讀不到或解析失敗 | error（fail closed；「沒比對到」不得等於 pass） |

Baseline 身分只比對 `(from, to)` 與 cycle 成員集合，**不含 file:line**，所以行號漂移不會弄破 ratchet；evidence 只供解釋。cycle 同時比對 **signature 與數量**，因此「刪一個環又加一個環、總數不變」仍會 fail。

warning 本身不是 error，但 canonical 測試 `tests/test_observed_architecture.py::test_canonical_repository_observed_ratchet_passes` 對真 repo 斷言 `warning_count == 0`，所以 baseline 一旦 stale，**CI 仍會紅**，用意是逼你把 baseline 收緊而不是放著爛。CLI 的 `--strict` 行為與此一致。

每次 `$improve-codebase-architecture` 或 architecture review 發現 recurring issue 時，處理順序是：

```text
finding
→ root-cause classification
→ invariant / rule
→ validator or structural test
→ targeted repair
→ baseline reduction
```

## 7. 尚未宣稱完成的能力

以下仍是後續 phase，不應被目前文件或 PR 誤報為已完成：

- TypeScript `dependency-cruiser` rules（Phase 3）。
- Python Import Linter contracts（Phase 3）。
- `review-session`、`endpoint-lease`、`stage-binding` executable state machines（Phase 4）。
- architecture quality grade 與定期 architecture garbage collection（Phase 5）。

### Phase 2 的已知偏離與界線（誠實揭露）

- **不用 GitNexus 當 gate 輸入。** change tasks 原文寫「Export … from GitNexus」。GitNexus CLI 在本 repo 已多次觀察到 transport 失敗與 stale index（見 `docs/plans/NOW.md` S4-B closeout），無法支撐 fail-closed 的 CI gate。因此 observed graph 改由**純標準函式庫的靜態掃描**產生，GitNexus 降為 advisory（`observed-graph.config.json` 的 `advisory_only_sources` 已記錄此決定）。任務語意（deterministic observed report）維持，實作來源不同。
- **靜態掃描的偵測面有限。** 目前 service-level edge 只從兩種低誤報訊號取得：帶 scheme 的 URL literal（`http/https/ws/wss://host:port`）與 compose 的 `depends_on` / env URL。**執行期才決定的位址（例如 viewer 由 coordinator 動態取得 streaming 端點）不會出現在 observed graph**，所以 `web-viewer-sample → bim-streaming-server` 雖然被 contract 允許卻不在 baseline。這是「偵測不到」，不是「不存在」；ratchet 只保證**新增**的可靜態偵測 edge 會被擋，不宣稱已窮舉所有實際呼叫。
- **module-level graph 只在 service 內部比對**，不做跨 service module graph，也不做 repo-wide import 掃描。
- **`apps/kit-manager-web` 尚未在 contract 中宣告為 service node。** 它確實會呼叫 coordinator `:8004`，已以 `undeclared-node` debt 記入 baseline，須由後續 delta 正式宣告，不得用 re-baseline 帶過。
