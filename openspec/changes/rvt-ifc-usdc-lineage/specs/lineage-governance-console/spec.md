## ADDED Requirements

### Requirement: Lineage console SHALL 提供五個可追溯 surfaces

Browser console SHALL 經 coordinator-only API 呈現 Version Overview、Artifacts、Alignment、Attempts 與 Audit。Alignment SHALL 提供 KPI、CSV-only/IFC-only/USDC-unmapped/invalid filters、mapping table 與 detail；Attempts SHALL 顯示 admission、attempt、publication 與 diagnostics；Audit SHALL 顯示 promote/rollback/release transitions。UI SHALL NOT 自行推導或成為 domain authority。

#### Scenario: Operator 檢視版本 lineage

- **WHEN**具 `bundle.read` 與 `alignment.read` 的 operator 開啟 governed version
- **THEN** UI SHALL 顯示 source bundle、active result、三種 ratios、numerator/denominator、diff counts 與 current warning state
- **AND**資料 SHALL 來自 coordinator/streaming authority responses

#### Scenario: Backend capability 尚未接通

- **WHEN**某 lineage action 或 data source 尚未實作
- **THEN** UI SHALL 顯示 `NOT_BUILT`／unavailable 與誠實 provenance
- **AND** MUST NOT 模擬 production success

### Requirement: Lineage actions SHALL 由外部 capability decision 授權

Edge SHALL 驗證 external control-plane 提供的 capability decision，至少區分 `bundle.read`、`bundle.publish`、`artifact.download`、`alignment.read`、`conversion.trigger`、`conversion.prioritize`、`conversion.cancel`、`conversion.retry`、`runtime.release`、`runtime.force_release`、`result.compare`、`result.promote`、`result.rollback`。Repo MUST NOT 建立平行 RBAC authority；所有 destructive/high-impact actions SHALL 具 intent/confirm/audit。任何protected read、download、compare或mutation decision缺失、過期、簽章/issuer驗證失敗或control-plane不可達時 MUST fail closed；audit只保存decision provenance、subject、expiry與correlation，不保存token secret。本 capability不提供retention mutation UI；若未來需要，MUST 另定具名 capability，不得以generic admin代替。

#### Scenario: Unauthorized promotion

- **WHEN**使用者沒有 `result.promote` 卻要求切換 active result
- **THEN** API SHALL 拒絕且 UI SHALL 不顯示成功
- **AND** active pointer SHALL 不變

#### Scenario: Protected action authorization decision unavailable

- **WHEN** read、download、compare或mutation capability decision缺失、過期、驗證失敗或暫時無法取得
- **THEN** API SHALL 拒絕protected action，UI SHALL 顯示 `authorization_unavailable`
- **AND**系統 MUST NOT 樂觀執行或把cached stale decision當成功
- **AND** audit/log SHALL 不保存credential或token secret

#### Scenario: Authorized force release

- **WHEN**使用者具 `runtime.force_release`，且 runtime contract 的 reason/confirmation/evidence 全部成立
- **THEN** UI MAY 送出 force-release intent
- **AND** SHALL 顯示 audited result

### Requirement: Artifact/report download SHALL 使用短效個別 presigned URL

具 `artifact.download` 的使用者 SHALL 可下載 individual artifact 與 CSV/JSON alignment reports。URL SHALL 短效、不可出現在 log/callback，且 artifact transport SHALL 支援 HTTP Range/resume。系統 MUST NOT 為大型 RVT/IFC/USDC bundle 即時建立 ZIP。

#### Scenario: Download large USDC

- **WHEN**授權使用者要求下載 active USDC
- **THEN** coordinator SHALL 回傳短效 presigned ref/redirect
- **AND** client SHALL 可使用 Range/resume
- **AND** response/log SHALL 不洩漏 MinIO credentials

### Requirement: 所有 lineage design gate SHALL 以 docs/plans HTML 為 authority

Lineage console 的 UX、IA、visual/state authority SHALL 僅來自 Git-tracked `docs/plans/*.html`。Manifest、goldens、route inventory 與 semantic cases SHALL 是由 HTML 可重現的 derived evidence；外部 absolute path、production CSS 或 capture script hard-code MUST NOT 成為平行 authority。

#### Scenario: HTML 尚無 lineage screen

- **WHEN** `docs/plans/*.html` 尚未定義 Alignment/Attempts/Audit 的 approved screen/state
- **THEN** design gate SHALL 標 `reference_missing` 或 `partial_reference_missing`
- **AND** full design completion SHALL 為 `no`

#### Scenario: HTML 與 derived manifest drift

- **WHEN** tracked HTML hash/contract 已改變但 manifest/goldens 尚未重建
- **THEN** design gate SHALL fail closed
- **AND**不得以舊 golden 宣稱符合新 design authority
