## 1. Design reference

- [x] 1.1 建立 source-hash manifest、13 個 screen/state 與兩 viewport golden baselines
- [x] 1.2 建立 origin verify 與 explicit rebaseline capture tool
- [x] 1.3 建立 primitive→semantic→component token projection 契約

## 2. Machine gates

- [x] 2.1 建立 visual result validator 與 regression tests
- [x] 2.2 將 PR body、merge hook、local preflight 與 CI 接到 base/head manifest scope；semantic/pixel result 只由 CI producer 輸出
- [x] 2.3 在契約與 PR machine fields 保留 functional/runtime E2E 為獨立 required evidence，不讓 visual gate取代
- [ ] 2.4 建立 branch-protected functional/runtime producer＋validator（Kit path 含 first-frame/stage/DataChannel ack）；目前只有 PR body結構檢查
- [ ] 2.5 取得 approved state variants並實作 11 個 exact Playwright semantic cases；完成前 frontend product job維持 fail closed
- [ ] 2.6 將 `design-semantic-visual` 加入 main branch-protection required contexts，並把 manifest `semantic_contract.enforcement_status` 更新為 configured（已取得使用者授權；待 workflow landed 且 machine gate 可執行後啟用，避免 expected-context deadlock）
- [ ] 2.7 對 workflow／gate-infrastructure／reference-only rebaseline 建立可滿足的獨立 owner approval／CODEOWNERS review＋dismiss stale，或落地可信 base-branch gate（遠端 solo-maintainer machine path 已保留 Require PR／strict 11 checks／admin enforcement／無 bypass並設 approval=0／CODEOWNER review=false，merge deadlock 已解除；但獨立 review authority 尚缺）
- [ ] 2.8 pin 並 machine-verify resolved npm dependency snapshot、Windows runner image與font fingerprints；完成前 `full_completion_allowed=false`

## 3. Source-of-truth convergence

- [x] 3.1 就地更新 docs/plans 七核心檔與 agent/workflow 入口
- [x] 3.2 建立 OpenSpec capability deltas，將 legacy prototype 降為 companion
- [x] 3.3 執行 `npx openspec validate align-frontend-design-system-reference --strict` 與 targeted machine tests
- [ ] 3.4 PR merge 後 archive change，讓 canonical capability specs 落地
