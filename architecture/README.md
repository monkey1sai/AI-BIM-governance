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
├── deltas/
│   └── <change-id>.json
└── README.md
```

- `architecture-contract.json`：服務責任、允許依賴、browser access、資料落地、readiness evidence、invariants 與 exception policy。
- `architecture-contract.schema.json`：desired architecture 的結構 schema。
- `architecture-delta.schema.json`：每次變更的 machine-readable delta schema。
- `deltas/<change-id>.json`：新增／刪除 dependency edge、public contract、ownership、state machine 與 exception 的聲明。

## 3. 第一版硬規則

| ID | 規則 | 第一版 enforcement |
|---|---|---|
| `ARCH-DATA-001` | IFC / RVT / DWG / USD / USDC / mapping 大檔留在 customer edge，cloud 只收 metadata | semantic validator |
| `ARCH-HTTP-001` | Browser HTTP API 只進 `bim-review-coordinator:8004` | semantic validator |
| `ARCH-SVC-001` | 每個 capability 只有一個 owner，owner 與 `must_not` 不得衝突 | semantic validator |
| `ARCH-CALL-001` | 新 service edge 必須同時存在於 desired contract 與 change delta | semantic validator |
| `ARCH-GRAPH-001` | 不得新增 dependency cycle | Phase 2 observed-graph ratchet |
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
```

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

第一版不要求一次清掉所有歷史結構問題。後續 observed graph gate 採：

```text
existing violations <= recorded baseline
new violations == 0
```

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

以下仍是後續 phase，不應被第一版文件或 PR 誤報為已完成：

- TypeScript `dependency-cruiser` rules。
- Python Import Linter contracts。
- GitNexus observed graph 匯出與 desired-vs-observed diff。
- `review-session`、`endpoint-lease`、`stage-binding` executable state machines。
- PR 自動偵測「實際新增 edge 但 delta 未聲明」。
- architecture quality grade 與定期 architecture garbage collection。
