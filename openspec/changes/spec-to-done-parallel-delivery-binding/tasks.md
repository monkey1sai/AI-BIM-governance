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
  - Fabric + binding + runtime readiness Node tests 326/326、autonomous review policy focused tests 18/18、Python schema/state tests 86 passed + 2 skipped、OpenSpec strict 77/77 通過。OpenSpec lifecycle 對帳為 current=10、archived=119；self-referential bootstrap 與 repo-wide agent-governance 皆通過。sandbox principal 曾因無法建立使用者 Temp 目錄產生 fixture setup errors，同一條 pytest 在已驗證主機擁有者環境重跑後完整通過；未變更 ACL 或測試。
- [x] 5.2 執行 GitNexus detect-changes、確認 tracked scope，並在 closeout 前檢查 Fabric 母分支 drift
  - GitNexus 1.6.9 曾在 exact worktree 對 fresh `origin/main` 的 compare 回報 CRITICAL（100 files／1,679 symbols／82 flows），使用者已明確接受該單一 PR 治理 blast radius。fresh fetch 後 `origin/main=a0ab706`，目前 branch 已吸收最新 Fabric 母分支 `a024a13`；closeout 尚須在最終 committed HEAD 重新索引並確認 exact tuple。
- [x] 5.3 登錄 OpenSpec lifecycle ledger 與 NOW current projection，將 task/evidence snapshot 綁定已提交的 implementation subject
