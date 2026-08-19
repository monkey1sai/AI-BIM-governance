# Tasks — introduction-resolved-subject-binding

> 落地順序硬約束：**two-phase landing**（design 決策 4）。第 1–5 節為第一波實作 PR（schema 支援＋語義＋測試＋治理登記），ledger 資料面零 sentinel 使用；第 6 節為第二波（首次資料使用與 #589 驗收）。第一波觸及 `SELF_REFERENTIAL_PATTERNS` 清單內腳本 → **human_critical**，需使用者 UI 簽核地板。2026-08-19 owner 明示排程 → 已 thaw，第一波於同 PR 實作。

## 1. Schema surface（Spec: openspec-lifecycle-ledger-schema）
- [x] 1.1 執行 `gitnexus impact validateLedgerShape -d upstream -r AI-BIM-governance` 與 `gitnexus impact resolveRowSubjectWatermark -d upstream -r AI-BIM-governance`，回報 blast radius；HIGH/CRITICAL 先停下警示（2026-08-19 實跑：GitNexus LadybugDB index 不存在 → UNKNOWN，依 repo 慣例記錄為 unavailable 而非 pass；兩個 symbol 的呼叫面已由人工全讀確認侷限於 verify CLI 與其測試檔，均在本 PR scope 內）
- [x] 1.2 `scripts/lib/openspec-machine-truth.mjs`：`CHANGE_KEYS` 演進為雙形狀（選填 `subject_binding`，值域封閉 `"introduction"`；其他未知鍵照舊 fail closed；非法值 `schema_invalid`）（R1）
- [x] 1.3 `scripts/tests/openspec-lifecycle-ledger.schema.json`：`change.properties` 增列 `subject_binding: { "const": "introduction" }`；`required` 與 `additionalProperties: false` 不變（R1）
- [x] 1.4 確認 `scripts/lib/openspec-repository-lifecycle.mjs` 零語義變更即可接受 sentinel row，並在 gate 測試套件新增回歸測試釘住 `parseLifecycleLedger` 的寬容解析與 v1 版本硬釘（R4）
- [x] 1.5 `scripts/tests/openspec-machine-truth-report.schema.json`：error enum 增列 `subject_binding_required`（定案命名，見 design 決策三）
- [x] 1.6 （可選，openQuestions #2 相關）PR CI gate 增加 `subject_binding` shape-only 靜態驗證——**決定不採納**（記入實作 PR body）：gate 維持「只驗 id+status」的最小語義面，避免在另一個 required-check mechanism 檔上擴大本 PR blast radius；值域驗證已由兩個 strict 驗證面（lib exact-keys＋JSON Schema）承擔

## 2. 有效 subject 解析（Spec: openspec-machine-truth-subject-resolution）
- [x] 2.1 `scripts/tests/verify-openspec-machine-truth.mjs`：`resolveRowSubjectWatermark` 增加 sentinel 分支——subject ∈ ancestry(HEAD) → 自身；否則（不存在或 exists-not-ancestor）→ `ledgerIntroductionCommit` 原樣解析；legacy 三分支逐字不動（R1/R3）
- [x] 2.2 確認 ambiguity、>32 candidates、not-found、introduction 非 trusted-base ancestor 四種失敗對 sentinel row 均維持 `MachineTruthInputError` 硬失敗（HELD；R2）
- [x] 2.3 `assertGitBase` 補強：checkout 存在 `refs/remotes/origin/main` 時，`--base` 必須 ∈ ancestry(origin/main)（含相等）；無該 ref 維持現行為；trust envelope 註解明文（R6；design 決策二／挑戰 B5）
- [x] 2.4 容量調整（owner 已裁決，2026-08-18）：`MAX_UNIQUE_SUBJECTS: 64 → 500`；`changedPathsSince` 的 rawBudget 記帳點移到 `isOwnedOpenSpecSource` 過濾之後（rawBudget 常數本身不變）；註解記明 git 子程序上界推導（R7；design 決策五）
- [x] 2.5 保留並補強 folded-into-same-squash residual limit 的程式註解，指向本 change 規格（R5）
- [x] 2.6 **（第二波硬前提）** 把 required CI 的真實 ledger 檢查（`test-openspec-machine-truth.mjs`「current ledger keeps reconciled source snapshots clean」）改為 base-aware：`collectSourceObservations` 呼叫 SHALL 供給 trusted base（derivation fail-closed 順序：CI 環境由 workflow 傳入 `pull_request.base.sha`；本機優先 `refs/remotes/origin/main`；皆無時的行為實作時定案並以 fixture 釘住），使 legacy introduction-recovery 與 sentinel 解析都能在 required CI 內運作；未完成本 task 前 SHALL NOT 寫入任何 sentinel row（design §0 required-CI 檢查點事實）。實作定案：derivation＝env `OPENSPEC_TRUSTED_BASE_SHA`（40-hex 驗證，違規 fail-closed）→ `refs/remotes/origin/main`（CI checkout fetch-depth:0 必有，免動 workflow 檔）→ HEAD（origin-less clone 的退化錨，僅接受 HEAD 可達的 introduction）

## 3. Reconcile ratchet（Spec: openspec-machine-truth-reconcile-ratchet）
- [x] 3.1 verify CLI 新增 ratchet：以 `previousLedgerAtBase` 比對 base→head——新 row＝sentinel 或 subject ∈ ancestry(trusted base)；被改寫 row＝sentinel 或新值恰等於舊 binding 的 resolved introduction commit；違反丟 `subject_binding_required`；previous ledger 為 null 不套用（R1/R2/R4）
- [x] 3.2 確認三項既有 subject 等式契約（`assertGitSubject`、null-observations 等式、observation==row 等式）在 sentinel row 上原樣生效，不加任何豁免（R5）

## 4. 回歸測試與 fixtures
- [x] 4.1 `scripts/tests/test-openspec-machine-truth.mjs`：schema 雙形狀（合法 sentinel、非法值、未知鍵、legacy 不變）單元測試
- [x] 4.2 `scripts/tests/test-openspec-machine-truth-cli.mjs`：sentinel 一次 squash-merge 後解析為 squash commit、零 rebind（#589 驗收情境）
- [x] 4.3 同檔：sentinel 的 ambiguity（rebind-away-and-back）與 >32 candidates fail closed
- [x] 4.4 同檔：stale-base ancestry——candidate-minted sentinel binding 被拒絕；`--base=HEAD` 於含 origin/main ref 的 repo 被 `assertGitBase` 補強拒絕；無 origin/main ref 的 fixture 行為釘住（挑戰 B5）
- [x] 4.5 同檔：folded edits residual limit fixture（同 squash 落地的 owned edit 不紅旗，固定預期行為）
- [x] 4.6 同檔：sentinel row 的 `source_changed_since_subject`——introduction 後編輯精準紅旗；in-PR self-anchored drift；P2b 恰等式 normalization 通過、任意 base-ancestor rewrite 被擋（挑戰 B4）；legacy 式 rebind-to-PR-HEAD 被擋
- [x] 4.7 同檔：determinism——subject 存在但非 HEAD ancestor（本機殘留 branch）與完全不存在兩種 clone 狀態，sentinel row 解析結果一致
- [x] 4.8 同檔：容量常數調整後，>64 相異 watermark 不再機械性失敗（依 2.4 定案的常數）
- [x] 4.9 `pwsh scripts/tests/test-openspec-ledger-reconciliation.ps1`：sentinel row 過 JSON Schema、`subject_commit` 維持 `$notEvaluated` 行為不變
- [x] 4.10 全套基線與變更後同指令重跑：`node scripts/tests/test-openspec-machine-truth.mjs`、`node scripts/tests/test-openspec-machine-truth-cli.mjs`、`pwsh scripts/tests/test-openspec-ledger-reconciliation.ps1`、agent-governance 檢查（先跑 baseline 再改）

## 5. 治理義務（mechanism surface；缺一不可合併）
- [x] 5.1 於 `scripts/self-referential-bootstrap-ledger.json` 依 `docs/agents/self-referential-bootstrap.md` §2 登記實作 PR：`stack_kind=self_referential_bootstrap`、具體理由（machine-truth comparator 只在 agent 端 evidence 迴圈執行，base 機制無法對變更後的解析語義取證）、`verification_contract` 凍結第 4 節指令；entry claim paths ⊆ 該 PR changed paths（含 `docs/evidence/**` bootstrap evidence）
- [x] 5.2 確認 `scripts/lib/risk-proportional-review.mjs` 分類實作 PR 為 SELF_REFERENTIAL/human_critical；PR body 依規則填 evidence 表；counted 票依現行治理（human_critical 地板需使用者 UI 簽核）
- [x] 5.3 依 openQuestions #3 核對清單——**決定本 PR 不補入**：兩個 schema 檔是機制的輸入資料而非裁決者本體，其變更必然伴隨消費端（已列清單的 lib/CLI/reconciler）同 PR 變更而觸發地板；依 §2.1 升級規則，僅當未來有 gate 把 schema 檔作為獨立機器消費輸入時才須補列（該接線 PR 屆時同 PR 補）
- [ ] 5.4 merge 後 fixpoint：以合併後 main 上的正規機制重跑 4.10 全套並把結果 commit 回 bootstrap ledger（`fixpoint` 欄位）
- [x] 5.5 對照 `docs/agents/agent-governance-policy.md`，如 rebind 慣例在治理文件有殘留敘述，同 PR 更新（2026-08-19 全文 grep `docs/agents/*.md`：零殘留，無需變更）

## 6. 第二波：首次資料使用與 #589 驗收
- [ ] 6.1 本 change 自身 row 由 legacy 升級為 sentinel（或確認 introduction-recovery 已覆蓋而無需升級），並同步 NOW.md 投影狀態
- [ ] 6.2 **危險窗操作閘（挑戰 B1）**：首個 sentinel row 寫入前，盤點 `gh pr list` open PRs 與長壽本機分支，通知 rebase；第一波 merge 與第二波之間保留至少一個工作日
- [ ] 6.3 第一波 merge 後的下一次真實 reconcile 寫入第一筆（或首批）sentinel rows；squash-merge 後於 main 實跑 verify CLI，取得「零 follow-up rebind PR」與 drift 正確性實證，evidence refs 記入 ledger row
- [ ] 6.4 commit 前依 Lane 政策執行 `gitnexus detect-changes --scope compare --base-ref main` 確認只影響預期 symbols
