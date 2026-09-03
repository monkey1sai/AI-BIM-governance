## 1. 規格與契約基線

- [x] 1.1 以 strict validation 固定 proposal、design、delta spec 與可追蹤 task ledger
- [x] 1.2 新增 Fabric binding machine schema，明定 admission unbounded、單一 binding writer 與 non-authorizing 語意

## 2. Binding 與 scope 驗證

- [x] 2.1 先以 deterministic tests 鎖定 canonical binding digest、唯一 state path 與 exact Fabric tuple
- [x] 2.2 實作 pure binding validator，重用 Fabric parser、lease parser 與 scope predicate
- [x] 2.3 補齊 scope containment、tuple drift、legacy isolation 與 writer-count non-blocking negative tests

## 3. spec-to-done durable state 整合

- [x] 3.1 升級 spec-to-done machine contract/schema 至 v2，保留 standalone state 相容性
- [x] 3.2 先以 state-validator tests 鎖定 managed checkpoint identity、binding packet 與 unique state path
- [x] 3.3 整合 shared state validator，驗證 Fabric binding identity、actual Git identity 與 audit-chain 不變性
- [x] 3.4 讓 managed HELD 保留 lease／要求 SUSPECT，並拒絕 local NEW_RUN 與未授權 RESUMED

## 4. 程序權威與 adapter parity

- [x] 4.1 更新 Claude spec-to-done 程序權威，將 Fabric binding、scope、state 與 HELD/resume gate 寫入 P0–P7
- [x] 4.2 同步 Codex adapter 與 Parallel Delivery Fabric operator 文件，不建立第二套執行引擎

## 5. 驗證與收斂

- [x] 5.1 執行 affected Node/Python tests、agent contract/governance checks 與 OpenSpec strict validation
  - Binding 10/10、state/schema 69 passed + 2 skipped、Fabric regression 90/90、ship contract 5/5、OpenSpec 77/77 與 self-referential bootstrap 通過。repo-wide agent-governance 仍在未被本 change 修改的 body/title-only CI concurrency assertion 失敗；固定 base 對應 workflow 與 assertion byte scope 未變，列為 inherited base failure，不宣稱該總 gate 通過。
- [x] 5.2 執行 GitNexus detect-changes、確認 tracked scope，並在 closeout 前檢查 Fabric 母分支 drift
  - Exact-commit index 對 tracked mapped scope 回報 LOW（10 files／20 symbols／0 processes）；branch rename 後 incremental reindex 因 GitNexus 1.6.9 `Failed calling LOWER: Invalid UTF-8` 失敗，dotfile／untracked 新檔以 direct references 與 deterministic tests 補證，不宣稱完整 GitNexus pass。fresh fetch 後 local/remote Fabric 母分支仍為 `9e2bd84`；母 worktree 有未提交且與 operator doc 重疊的隔離變更，後續整合須顯式解衝突。
- [ ] 5.3 登錄 OpenSpec lifecycle ledger 與 NOW current projection，將 task/evidence snapshot 綁定已提交的 implementation subject
