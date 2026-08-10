# executable-architecture-contracts Specification

## Purpose

把最高價值的架構鐵律變成 machine-readable contract 與 fail-closed 驗證:desired 架構(服務責任、依賴邊、browser 邊界、資料落地、readiness evidence)、每個 governed change 的 intended delta、以及 observed 狀態的 ratchet(graph/layer/lifecycle/learning),全部接入既有 canonical verification dispatch,不建立第二條驗證管線。由 change `introduce-executable-architecture-contracts`(2026-08-10 archived)落地。

## Requirements

### Requirement: Desired architecture contract

Repository SHALL 在 `architecture/architecture-contract.json` 維護 machine-readable 的 desired architecture contract。

該 contract SHALL 識別 internal services、external systems、owned capabilities、forbidden responsibilities、allowed service calls、browser access boundaries、data residency policy、runtime readiness evidence、architecture invariants、delta policy 與 exception policy。

#### Scenario: Agent plans a governed service-boundary change

- **GIVEN** 某個 Lane G 或 Lane S change 可能改動 service boundary
- **WHEN** agent 準備該 change
- **THEN** 它 SHALL 先讀 desired architecture contract
- **AND** 它 SHALL NOT 只憑敘述性文件推論權限
- **AND** 任何新的 dependency edge SHALL 在被接受前同時存在於 desired contract 與該 change 的 delta。

### Requirement: Runtime truth hierarchy

Architecture contract SHALL 保持 repository 的 runtime truth hierarchy。

#### Scenario: Documentation describes target behavior that code does not implement

- **GIVEN** `docs/plans` 描述了某個目標能力
- **AND** 實作或可執行測試無法證明該能力存在
- **WHEN** agent 回報狀態
- **THEN** 它 SHALL 回報 implementation gap
- **AND** 它 SHALL NOT 用 architecture contract 或敘述性 spec 宣稱 runtime 已完成。

### Requirement: Unique capability ownership

每個宣告的 architectural capability SHALL 至多有一個 internal owning service。

Service SHALL NOT 把同一個 capability 同時列在 `owns` 與 `must_not`。

#### Scenario: Two services claim review-session ownership

- **GIVEN** `bim-review-coordinator` owns `review-session`
- **WHEN** 另一個 internal service 也宣告擁有 `review-session`
- **THEN** semantic validation SHALL fail
- **AND** 失敗訊息 SHALL 指出兩個 owner 與重複的 capability。

### Requirement: Browser access boundary

唯一的 public browser HTTP API entrypoint SHALL 是 `bim-review-coordinator` 的 port `8004`。

`bim-streaming-server`、`governance-service`、`kit-manager-api` SHALL NOT 被宣告為 browser 直連的 public HTTP API。

Browser MAY 使用宣告的 WebRTC 與 DataChannel channels 直連 `bim-streaming-server`。

#### Scenario: Viewer attempts to bypass coordinator

- **WHEN** architecture contract 或 delta 宣告 browser 直連 governance 或 streaming internal API
- **THEN** validation SHALL fail。

### Requirement: Customer-edge artifact residency

大型 BIM source 與 derived artifacts SHALL 維持 customer-edge authoritative。

External company cloud control plane SHALL 只接收 metadata,SHALL NOT 接收 IFC、RVT、DWG、USD、USDC、element mapping 或 entity index artifacts。

#### Scenario: Cloud data policy permits USDC upload

- **WHEN** architecture contract 把 USDC 從 cloud deny-list 移除,或把大型 artifacts 標成可傳雲
- **THEN** validation SHALL fail。

### Requirement: Evidence-gated review readiness

Review session SHALL NOT 在缺少任何必要 Kit-side 或 browser-side evidence 時被視為 ready。

必要 evidence SHALL 至少包含:

- `kit-process-alive`;
- `opened-stage-result`;
- `datachannel-ready`;
- `first-frame-at`;
- `stage-matched`。

#### Scenario: Kit process exists but browser has no first frame

- **GIVEN** Kit process evidence 存在
- **AND** `first-frame-at` 不存在
- **WHEN** 評估 readiness
- **THEN** 該 session SHALL NOT 為 ready。

### Requirement: Architecture delta

Governed architecture change SHALL 附帶 `architecture/deltas/<change-id>.json`。

Delta SHALL 宣告 affected services 與 surfaces、dependency edges、public contract changes、data ownership changes、state-machine changes、exceptions 與 approval state。

#### Scenario: Lane B carries architecture-affecting changes

- **GIVEN** 某 delta 含有 dependency edge、public contract change、ownership change、state-machine change 或 exception
- **WHEN** 其 lane 為 `F` 或 `B`
- **THEN** validation SHALL fail
- **AND** 該 change SHALL 升級為 Lane G 或 Lane S。

### Requirement: Time-bounded architecture exceptions

Architecture exception SHALL 含 invariant ID、owner、reason、ADR、creation date 與 expiration date。

Exception SHALL NOT 超過 90 天,過期後 SHALL fail validation。

Breaking contract changes、ownership transfers 與 architecture exceptions SHALL 在接受前取得 explicit approved status。

#### Scenario: Exception expires

- **GIVEN** exception 的 expiration date 早於 validation date
- **WHEN** semantic validation 執行
- **THEN** validation SHALL fail closed。

### Requirement: Canonical verification dispatch

Architecture contract、delta、validator 與 architecture-test 變更 SHALL 經由 repository 既有的 verification manifest 路由。

本 change SHALL NOT 建立第二條 canonical deploy 或 verification entrypoint。

#### Scenario: Architecture-only change is planned

- **GIVEN** `architecture/architecture-contract.json` 變更
- **WHEN** `scripts/verify-all` 計算 affected targets
- **THEN** root contracts SHALL 被選中
- **AND** agent-governance 與 secret-pattern scanning SHALL 維持適用。

### Requirement: Honest phased enforcement

Repository SHALL 區分 active、delegated 與 planned 的 architecture enforcement。

Invariant SHALL 只在其可執行 gate 於 canonical verification 中運行時標為 `active`。沒有這種 gate 的 invariant SHALL 維持 `planned`,且任何報告 SHALL NOT 宣稱該 gate 未實際建立的 conformance。

#### Scenario: Invariant has no executable gate yet

- **WHEN** 某 invariant 尚無接入 canonical verification 的可執行 gate
- **THEN** 該 invariant SHALL 維持標為 planned
- **AND** 報告 SHALL NOT 宣稱其 conformance 已建立。

#### Scenario: No-cycle observed-graph gate becomes executable

- **GIVEN** observed-architecture ratchet 在 canonical root-contract gate 中運行
- **WHEN** `ARCH-GRAPH-001` 標為 active
- **THEN** repository SHALL 持有經核准的 observed baseline,記錄每個 grandfathered cycle 及其 owner、reason 與 target phase
- **AND** 該 gate SHALL 對任何新的 cycle signature 或超出核准 cycle budget 的增量 fail closed
- **AND** enforcement scope SHALL 被文件化,包括 static scan 無法觀察 runtime-resolved dependencies,因此 observed graph 是 lower bound,SHALL NOT 被報告為完整的 source-graph conformance。

#### Scenario: Layer boundary gate becomes executable

- **GIVEN** layer boundary ratchet 在 canonical root-contract gate 中運行
- **WHEN** `ARCH-LAYER-001` 標為 active
- **THEN** observed-graph configuration 掃描的每個 service SHALL 要嘛被 layer assignment rules 覆蓋、要嘛附理由明確排除,且每個被掃描的 module SHALL 解析到恰好一個宣告的 layer
- **AND** repository SHALL 持有經核准的 layer baseline,記錄每筆 grandfathered cross-layer violation 及其 owner、reason 與 target phase,並以不留寬鬆額度的 per-service budgets 約束
- **AND** 該 gate SHALL 對未 baseline 的 violation、超出 budget 的 service、以及無 rule 可分類的 module fail closed
- **AND** baseline identity SHALL 排除 layer 名稱,使重新貼標籤無法把 grandfathered violation 變成新 violation,也無法把新 violation 洗白為既有
- **AND** 因為對 observed 狀態的 ratchet 無法偵測被放寬的 policy,per-service layer sets、allowed layer matrix、per-service languages、layered service id 集合、以及 schema 檔的 load-bearing constraints SHALL 獨立 pin 在測試套件中,使放寬 contract 必須出現在同一個 diff 的可見編輯
- **AND** 文件 SHALL 明白陳述這個 policy 層是 review-enforced 而非 gate-enforced,且 SHALL NOT 宣稱重新貼標籤無法把 violation 移出 observed 集合
- **AND** enforcement scope SHALL 被文件化,包括該 gate 只判方向不判 cycle、只判 intra-service 靜態可解析的 imports,且 SHALL NOT 被報告為完整的 structural conformance
- **AND** 當原始任務指名的第三方工具未被採用時,該替代 SHALL 以 machine-readable 形式與 contract 一同記錄,SHALL NOT 被刪除、只能被 supersede。
