# Design: Executable Architecture Contracts

## Context

本 repo 已有：

- `docs/plans/` 的目標設計與驗收語意；
- `AGENTS.md` / `docs/agents/` 的服務邊界與 AI Coding governance；
- OpenSpec change control；
- GitNexus code graph；
- `scripts/verification-manifest.json → verify-all` 的 canonical verification dispatcher；
- frontend operability、browser E2E、Kit first-frame / stage / DataChannel evidence gates。

缺少的是一層 machine-readable desired architecture，可讓 CI 判斷一個 change 是否修改了不允許的服務邊界或 readiness 條件。

## Goals

- 把高價值 architecture invariants 變成 deterministic machine contract。
- 對 service ownership、dependency edge、browser boundary、data residency、readiness 與 exceptions fail closed。
- 讓每個 governed change 在實作前聲明 intended delta。
- 接入既有 verification dispatcher，不建立新的驗證孤島。
- 第一版零 production dependency、容易在 Windows / Linux 執行。

## Non-Goals

- 形式化整個產品 domain。
- 自動證明所有 runtime calls 與 source imports。
- 一次清除所有既有 architecture debt。
- 用 schema 取代 human intent、ADR 或 code review。

## Repository Data and Control Flow

This change introduces repository-governance files only:

```text
docs/plans + AGENTS boundaries
→ architecture/architecture-contract.json (desired)
→ architecture/deltas/<change-id>.json (intended)
→ scripts/lib/architecture_contract.py (semantic validation)
→ tests/test_architecture_contract.py
→ existing verification-manifest / verify-all dispatch
```

No runtime customer data is introduced. Product source-of-truth ownership remains unchanged:

- review/session/control metadata: `bim-review-coordinator`;
- IFC→USDC artifacts and Kit/WebRTC runtime: `bim-streaming-server`;
- issues/annotations/BCF: `governance-service`;
- browser interaction/evidence: `web-viewer-sample`;
- Kit process/endpoint lifecycle: `kit-manager-api`;
- company cloud: metadata-only external control plane;
- customer-edge IFC worker: external IFC producer.

## Decision 1: JSON is canonical; Markdown remains explanatory

第一版使用 JSON 而非 YAML：

- Python standard library 可原生解析；
- 不新增 PyYAML 或 CUE runtime dependency；
- JSON Schema 與 Git diff 工具成熟；
- 可由後續 UI、graph exporter、policy engine 直接消費。

`architecture/README.md` 解釋 why / workflow；JSON 表達 what must be true。

## Decision 2: Schema + semantic validator

JSON Schema 處理 shape；`scripts/lib/architecture_contract.py` 處理：

- cross-service ownership uniqueness；
- call target reference integrity；
- allowed dependency edge；
- exact browser HTTP entrypoint；
- data residency deny-list；
- Kit/browser evidence conjunction；
- delta lane sufficiency；
- exception expiry and maximum duration；
- approval consistency。

Validator 僅用 Python standard library，避免 root contract gate 因 package environment 不一致而失效。

## Decision 3: Desired / Intended / Observed are separate

```text
desired   = architecture-contract.json
intended  = architecture/deltas/<change-id>.json
observed  = implementation + tests + deterministic static dependency scan
```

第一版驗證 desired 與 intended。Observed graph diff 於 Phase 2 落地。

**Phase 2 更正（2026-07-30）：** 原文把 GitNexus 列為 observed 來源。實測 GitNexus CLI 在本 repo 有 transport 失敗與 stale index（`docs/plans/NOW.md` S4-B closeout 已記錄），不能當 fail-closed gate 的輸入，因此 observed 改由 `scripts/lib/observed_architecture.py` 的純標準函式庫靜態掃描產生，GitNexus 降為 advisory。靜態掃描看不到 runtime 才解析的位址，所以 observed graph 是 **lower bound**，只用來擋新增 edge／cycle，不宣稱窮舉。

## Decision 4: Reuse canonical root-contract gate

不新增獨立 `verify-architecture.ps1` 入口。`verification-manifest.json` 將：

- 把 `architecture/**` 歸入 tracked repository；
- 讓 architecture / validator changes dispatch `root-contracts`；
- 讓 architecture changes 同時 dispatch agent-governance 與 secret-pattern scan。

Root pytest 會執行 `tests/test_architecture_contract.py`，而該測試會 validate canonical repository contract。

## Decision 5: Architecture ratchet, not big-bang cleanup

第一版不掃描並強迫修復所有 source graph violations。後續 observed graph gate 以 baseline 方式 rollout：

```text
new violations = 0
existing violations must not increase
baseline can only decrease
```

如此可避免架構治理 change 變成無界限的大型重構。

## Decision 6: Builder cannot silently weaken the contract

新增 edge 若未在 desired contract 中，不得只靠 delta 放行。流程必須是：

1. 提出 desired contract change；
2. 說明 why / impact；
3. 取得必要 approval；
4. 再實作 source edge。

Exceptions 不等於永久 allow-list；必須有 ADR、owner 與 expiry，過期直接 fail。

## Contract Model

### Service ownership

每個 service 宣告：

- `owns`；
- `must_not`；
- `may_call`；
- ports and role。

同一 capability 不得由兩個 internal services 擁有。

### Browser access

- HTTP API：`bim-review-coordinator:8004` only。
- Viewer dev assets：`web-viewer-sample:5173`。
- Realtime：browser 可直接使用 streaming WebRTC / DataChannel channels，但不得把 internal streaming/governance/kit-manager HTTP API 當 public API。

### Readiness

`review-session-ready` 使用 `operator=all`，至少包含：

- Kit-side：`kit-process-alive`、`opened-stage-result`；
- Browser-side：`datachannel-ready`、`first-frame-at`、`stage-matched`。

只看到 process alive、endpoint reserved 或 stage open requested，均不得標成 ready。

### Delta

Delta 聲明：

- affected services / surfaces；
- added / removed dependency edges；
- public contract changes；
- data ownership changes；
- state-machine changes；
- exceptions；
- approval status。

Breaking contract、ownership transfer 或 exception 必須 explicit approval。

## Risks and Mitigations

### Risk: Contract drifts from code

Mitigation：Phase 2 已導入 deterministic static observed graph 與 baseline ratchet（`architecture/observed-baseline.json`）；contract 仍明確標成 desired architecture，而非 observed truth。已知殘餘：static scan 偵測不到 runtime 才解析的位址。

### Risk: Agents modify contract to make a bad implementation pass

Mitigation：contract changes本身屬 governed architecture change；PR 必須顯示 delta、review 與必要 approval。

### Risk: Too many false positives block brownfield work

Mitigation：第一版只鎖定十條高價值 invariants；module-level no-cycle / layer rules採 baseline ratchet rollout。

### Risk: Parallel verification pipelines diverge

Mitigation：只接入 `verification-manifest.json` 與 root pytest，不新增 canonical operator entrypoint。

## Rollout

1. Phase 1：desired contract、delta、semantic validator、pytest、manifest dispatch。
2. Phase 2（2026-07-30 完成）：deterministic static desired-vs-observed graph report + no-new-edge / no-new-cycle ratchet。GitNexus 改列 advisory，理由見上。
3. Phase 3（2026-08-03 完成）：~~TypeScript dependency-cruiser + Python Import Linter~~ → 純標準函式庫的 layer boundary ratchet（`scripts/lib/layered_architecture.py`）。**Phase 3 更正：** 原文指名的兩個第三方工具未採用——canonical root-contract CI job 只裝 `pytest`／`jsonschema`，`apps/kit-manager-web` 沒有 lockfile 可釘版本，且兩者都不保證本 repo 要求的 Windows／Linux byte-identical 輸出。改為重用 Phase 2 已對抗硬化的 module graph extractor，沿用同一套 baseline ratchet。任務產出（可執行的分層邊界契約）不變，工具不同；偏離記於 `architecture/layer-contract.json` 的 `tooling_deviation` 並由測試斷言，只能 supersede 不能刪除。
4. Phase 4：review-session / endpoint-lease / stage-binding executable state machines。
5. Phase 5：將 recurring `$improve-codebase-architecture` findings 編譯成 permanent rules 與 quality grade。
