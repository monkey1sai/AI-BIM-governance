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
├── layer-contract.json
├── layer-contract.schema.json
├── layer-baseline.json
├── layer-baseline.schema.json
├── deltas/
│   └── <change-id>.json
└── README.md
```

- `architecture-contract.json`：服務責任、允許依賴、browser access、資料落地、readiness evidence、invariants 與 exception policy。
- `architecture-contract.schema.json`：desired architecture 的結構 schema。
- `architecture-delta.schema.json`：每次變更的 machine-readable delta schema。
- `deltas/<change-id>.json`：新增／刪除 dependency edge、public contract、ownership、state machine 與 exception 的聲明。
- `observed-graph.config.json`：observed 靜態掃描設定（目錄→service 對映、掃描排除、可視為 inbound target 的 port、誤報抑制樣式）。
- `observed-baseline.json`：**已核准的 observed baseline**（grandfathered edge 與 cycle）。ratchet 只放行這裡有的東西，其餘 fail closed；在 GitHub PR 上，candidate baseline 只能相對 PR base 單調縮減，不能新增 grandfathered edge/cycle 或提高 budget。
- `layer-contract.json`：**每個 service 的 module→layer 指派規則與允許的跨層依賴矩陣**（Phase 3）。規則有序、first-match-wins。
- `layer-contract.schema.json`：layer contract 的結構 schema。
- `layer-baseline.json`：**已核准的 layer baseline**（grandfathered 跨層違規＋每 service 零寬鬆的 violation budget）；在 GitHub PR 上同樣只能相對 PR base 單調縮減，不能用 candidate 自己擴張的 baseline 替新違規開脫。
- `layer-baseline.schema.json`：layer baseline 的結構 schema。

## 3. 第一版硬規則

| ID | 規則 | 第一版 enforcement |
|---|---|---|
| `ARCH-DATA-001` | IFC / RVT / DWG / USD / USDC / mapping 大檔留在 customer edge，cloud 只收 metadata | semantic validator |
| `ARCH-HTTP-001` | Browser HTTP API 只進 `bim-review-coordinator:8004` | semantic validator |
| `ARCH-SVC-001` | 每個 capability 只有一個 owner，owner 與 `must_not` 不得衝突 | semantic validator |
| `ARCH-CALL-001` | 新 service edge 必須同時存在於 desired contract 與 change delta | semantic validator |
| `ARCH-GRAPH-001` | 不得新增 dependency cycle | observed-graph ratchet（已 active） |
| `ARCH-LAYER-001` | service 內部 module 只能依賴 layer set 允許的層；新跨層違規一律擋下 | layer-boundary ratchet（已 active） |
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

# layer ratchet（Phase 3）
python scripts/dev/check_layered_architecture.py --repo-root . --strict
python scripts/dev/check_layered_architecture.py --repo-root . --report-only --output artifacts/architecture/layer-report.json
python -m pytest tests/test_layered_architecture.py -q -p no:cacheprovider
```

`--report-only` 產出的 report 是 **可重生的本機產物**（`artifacts/architecture/` 已 gitignore），同一份 source tree 在 Windows 與 Linux 會得到 byte-identical 輸出。入庫的權威是 `observed-baseline.json`。

Canonical dispatch：

```powershell
.\scripts\verify-all.ps1 -PlanOnly -ChangedPath architecture/architecture-contract.json
.\scripts\verify-all.ps1 -ChangedPath architecture/architecture-contract.json
```

`observed-graph.config.json` 的 `compose_files` 是 architecture scanner 的正式輸入，不只是部署設定。`scripts/verification-manifest.json` 必須讓其中每一個 compose path 都觸發 `root-contracts`；新增 compose scanner input 時，routing closure test 也必須同步證明它不會只跑 `docker compose config` 而漏掉 observed/layer architecture checks。

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

`observed-baseline.json` 與 `layer-baseline.json` 是 **grandfathered debt 清單，不是一般 architecture registry**。PR 的信任基準是 GitHub 事件提供的 base commit；base-owned audit checker 只允許 candidate 刪除既有 edge/cycle/layer violation、降低既有 budget，或為新 scope 建立零 budget。新增合法 dependency edge 應透過 desired contract＋architecture delta 表達，不得把它塞進 baseline。這個 base-aware 單調性也避免同一個 PR 一面製造違規、一面 re-baseline 後自行宣稱通過；merge enforcement 仍須由 distinct external GitHub App 將同一結果綁到 PR head。

具體規則（`scripts/lib/observed_architecture.py`）：

| 情況 | 結果 |
|---|---|
| observed edge 已在 `observed-baseline.json` | pass（grandfathered） |
| **新** edge 不在 contract `may_call` | `observed.edge.not_allowed`（error） |
| **新** edge 在 contract 但沒有任何 delta 宣告 | `observed.edge.undeclared`（error） |
| **新** edge 同時被 contract 與 delta 宣告 | pass |
| 新 cycle signature 或 cycle 數超出 `cycle_budgets` | `observed.cycle.new` / `observed.cycle.count_increase`（error） |
| 跨層 edge 已在 `layer-baseline.json` | pass（grandfathered） |
| **新**跨層 edge 不在 baseline，或某 service 違規數超出 `violation_budgets` | `layer.violation.new` / `layer.budget_exceeded`（error） |
| module 沒有任何 rule 命中，或某 service 掃不到 module | `layer.module.unassigned` / `layer.service.empty`（error） |
| service 既沒被 layer 也沒被 `excluded_services` 明列 | `layer_contract.service_uncovered`（error） |
| baseline 有但已不再違規，或 rule 不再命中任何 module | `layer.baseline_stale` / `layer.rule.unused`（**warning**） |
| service 實際解析出的 layer 集合與其宣告的 `layers` 不符（broad rule 把整個 service 壓成一層） | `layer.service.layer_set_drift`（error） |
| budget 高於 baseline 內該 service 的違規數 | `layer.budget_slack`（error） |
| `layer_sets` 同一語言重複、`services` 同一 id 重複 | `layer_contract.duplicate_language` / `duplicate_service`（error） |
| 使用 `suffix` 規則，或 `prefix` 值沒有以 `/`、`.` 收尾 | `layer_contract.suffix_rule` / `prefix_unanchored`（error） |
| schema 檔被換成 `{}` 或其他無約束力的 stub | `*.schema_vacuous`（error） |
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

- `review-session`、`endpoint-lease`、`stage-binding` executable state machines（Phase 4）。
- architecture quality grade 與定期 architecture garbage collection（Phase 5）。
- 跨 service 的 module-level layer 比對；目前只在 service 內部判定。
- 動態 import 與執行期才決定的 module 名稱；靜態掃描看不到，因此不宣稱涵蓋。

### Phase 2 的已知偏離與界線（誠實揭露）

- **不用 GitNexus 當 gate 輸入。** change tasks 原文寫「Export … from GitNexus」。GitNexus CLI 在本 repo 已多次觀察到 transport 失敗與 stale index（見 `docs/plans/NOW.md` S4-B closeout），無法支撐 fail-closed 的 CI gate。因此 observed graph 改由**純標準函式庫的靜態掃描**產生，GitNexus 降為 advisory（`observed-graph.config.json` 的 `advisory_only_sources` 已記錄此決定）。任務語意（deterministic observed report）維持，實作來源不同。
- **靜態掃描的偵測面有限。** 目前 service-level edge 只從兩種低誤報訊號取得：帶 scheme 的 URL literal（`http/https/ws/wss://host:port`）與 compose 的 `depends_on` / env URL。**執行期才決定的位址（例如 viewer 由 coordinator 動態取得 streaming 端點）不會出現在 observed graph**，所以 `web-viewer-sample → bim-streaming-server` 雖然被 contract 允許卻不在 baseline。這是「偵測不到」，不是「不存在」；ratchet 只保證**新增**的可靜態偵測 edge 會被擋，不宣稱已窮舉所有實際呼叫。
- **module-level graph 只在 service 內部比對**，不做跨 service module graph，也不做 repo-wide import 掃描。
- **`apps/kit-manager-web` 尚未在 contract 中宣告為 service node。** 它確實會呼叫 coordinator `:8004`，已以 `undeclared-node` debt 記入 baseline，須由後續 delta 正式宣告，不得用 re-baseline 帶過。

### Phase 3 的已知偏離與界線（誠實揭露）

- **未採用 `dependency-cruiser` 與 `import-linter`。** change tasks 3.1／3.2 原文指名這兩個第三方工具。三個理由使它們在本 repo 不適合當 fail-closed gate：canonical root-contract CI job 在 windows-latest 上只安裝 `pytest` 與 `jsonschema`，採用 import-linter 必須改 `.github/workflows/ci.yml`；`apps/kit-manager-web` 目前沒有 `package-lock.json`，無法把 dependency-cruiser 釘在可重現版本；兩者都不保證本 repo 對 architecture 產物所要求的 Windows／Linux byte-identical 輸出。因此改由 `scripts/lib/layered_architecture.py` 這個純標準函式庫 checker 執行，**重用 Phase 2 已經過 9 輪對抗修補的 module graph extractor**，並沿用同一套 ratchet／baseline 紀律。這與 Phase 2 的 GitNexus 偏離同型：任務**產出**（可執行的 UI/application/client/domain 與 API/application/domain/infrastructure 邊界契約）不變，**工具**不同。偏離同時以機器可讀形式記在 `architecture/layer-contract.json` 的 `tooling_deviation`，並由 `tests/test_layered_architecture.py` 斷言，**只能被後續 change supersede，不得刪除**。日後要真的導入這兩個工具仍然可行，屬 additive。
- **只判方向，不判環。** module-level cycle 仍由 `ARCH-GRAPH-001` 與 `observed-baseline.json` 持有。同層 edge 在本 gate 一律放行，這不等於該設計健康。
- **只看 service 內部、且只看靜態可解析的 import。** 不做跨 service module graph，不涵蓋動態 import 或執行期才決定的 module 名稱。這是「偵測不到」，不是「不存在」。
- **掃描面沿用 Phase 2 的 `observed-graph.config.json`。** 被該設定排除的 tests、fixtures、harness、generated、dist 不會被 layer 化，因此也不受本 gate 約束。
- **layer 指派是人工判斷，不是自動推導。** `layer-contract.json` 的規則有序、first-match-wins。baseline 身分是 `(service, from, to)`，不含 layer 名稱，因此重新貼標籤**不會**把已 grandfather 的違規變成「新違規」——但也**不會**阻止有人用一條 `exact` 規則把某個 module 換層，讓違規從 observed 集合裡整個消失。這一點在下一條說明。
- **放寬 contract 本身，gate 不會抓。** 這是本 gate 最重要的界線：ratchet 只判「observed 是否超出已核准 baseline」，它**不判 policy 有沒有被改鬆**。改 `layer-contract.json` 的 `allowed` 矩陣、改某個 module 的 layer、或把 service 移進 `excluded_services`，對 gate 而言都是合法輸入。防線是 `tests/test_layered_architecture.py` 裡 `PINNED_SERVICE_LAYERS`／`PINNED_ALLOWED_MATRIX` 與 `test_canonical_layer_contract_covers_every_scanned_service` 這幾組**寫死的 pin**：放寬 policy 必須連同改測試，才會在 review diff 裡看得見。換句話說，這一層是 **review-enforced，不是 gate-enforced**，`AGENTS.md` §「Builder 不得為了讓自身程式通過而自行放寬 contract」在此照舊適用。
- **Python 絕對 intra-service import 看不到。** Phase 2 的 extractor 只把 import 解析成「相對 scan root 的 module id」。`services/kit-manager-api` 的 scan root 是 `app/`，所以生產環境真實可用的 `from app.kit_gateway import ...` 解析不到任何 module，**不產生 edge 也不產生 diagnostic**。同一條依賴寫成 `from .kit_gateway import ...` 會被正確抓到。目前樹上沒有這種寫法，所以這是**現存的洞，不是現存的債**；修它要動 Phase 2 的 `_resolve_python_target`，不在本 phase 範圍。
- **大小寫不符的 TypeScript 相對 import 會被靜默丟掉。** `import ... from "../StreamConfig.js"`（實際檔案 `streamConfig.ts`）解析不到，無 edge 無 diagnostic。canonical CI runner 是 windows-latest（不分大小寫檔案系統），而 `web-viewer-sample/tsconfig.json` 沒有開 `forceConsistentCasingInFileNames`，因此這種 import 在執行期可用卻對 gate 隱形。
- **`violation_budgets` 是交叉檢查，不是獨立防線。** 修補後 budget 必須等於 baseline 內該 service 的違規數（`layer.budget_slack`），而任何未 baseline 的違規本來就會觸發 `layer.violation.new`，所以 `layer.budget_exceeded` 已無法獨立成立。保留它是為了讓「某 service 目前欠多少債」在 baseline 檔裡一眼可見，代價是要手動同步。
- **warning 不會讓 `status` 變 failed。** 與 Phase 2 相同：`layer.baseline_stale`、`layer.rule.unused`、`layer.budget_unknown_service` 都是 warning，CLI 不加 `--strict` 時 exit 0。真正把 warning 當紅燈的是 `tests/test_layered_architecture.py::test_canonical_repository_layer_ratchet_passes` 的 `warning_count == 0` 斷言，那才是 CI 的 oracle。
- **`bim-streaming-server` 與 `kit-manager-api` 只有 `exact` 規則。** 因為 suffix 規則已被禁止、這兩個 service 也沒有可用的 anchored prefix，所以在它們裡面**新增任何 Python module 都必須同時改 contract**，否則 `layer.module.unassigned` 會紅。這是刻意的成本。
- **`apps/kit-manager-web` 的 undeclared-node debt 未被解決。** 本 gate 只約束它內部的分層；contract node 宣告仍是 `observed-baseline.json` 持有的既有債務。
