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
  - Fabric + binding + autonomous policy Node tests 327/327、trust-root Python tests 43/43、state/schema Python tests 70 passed + 2 skipped、static policy Node/Python tests 317/317 + 17/17、OpenSpec strict 77/77、OpenSpec lifecycle tests 46/46 通過；self-referential bootstrap、skill manifest check（35 skills／0 writes）與 repo-wide agent-governance 皆通過。sandbox principal 曾因 Git owner identity 不同而拒絕 nested Git，同一條測試在已驗證主機擁有者環境重跑後完整通過；未變更 ACL、owner 或 `safe.directory`。
- [ ] 5.2 執行 GitNexus detect-changes、確認 tracked scope，並在 closeout 前檢查 Fabric 母分支 drift
  - 使用者已明確接受候選變更的 GitNexus CRITICAL（100 files／2,810 symbols／107 flows）及單一 PR 推進；目前 P5 修補仍未形成最終 committed HEAD，closeout 必須重新索引 final HEAD、重跑 detect-changes、確認 exact tuple 未超出已接受範圍，並 fresh fetch 驗證 `origin/main` 與 Fabric 母分支 `a024a13` 無未整合 drift。
- [x] 5.3 登錄 OpenSpec lifecycle ledger 與 NOW current projection，將 task/evidence snapshot 綁定已提交的 implementation subject
