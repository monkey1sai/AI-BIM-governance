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
- [x] 5.2 確認 `scripts/lib/risk-proportional-review.mjs` 分類實作 PR 為 SELF_REFERENTIAL/human_critical；PR body 依規則填 evidence 表；counted 票依現行治理（human_critical 地板需使用者 UI 簽核）（#620 實績：counted 票由 `monkey1sai-blip` 於 2026-08-19T03:12:45Z APPROVED，squash `ab67877` 於 2026-08-19T03:14:09Z merged）
- [x] 5.3 依 openQuestions #3 核對清單——**決定本 PR 不補入**：兩個 schema 檔是機制的輸入資料而非裁決者本體，其變更必然伴隨消費端（已列清單的 lib/CLI/reconciler）同 PR 變更而觸發地板；依 §2.1 升級規則，僅當未來有 gate 把 schema 檔作為獨立機器消費輸入時才須補列（該接線 PR 屆時同 PR 補）
- [x] 5.4 merge 後 fixpoint：以合併後 main 上的正規機制重跑 4.10 全套並把結果 commit 回 bootstrap ledger（`fixpoint` 欄位）（2026-08-19 由 PR #629 落地，squash `75bcd5a`、merged 2026-08-19T03:41:59Z：`scripts/self-referential-bootstrap-ledger.json` 的本 entry 轉 `status: closed`，寫入 `fixpoint.mechanism_commit=ab6787778d98094f6d34992ab3024aacd841e6bf`（＝#620 squash）與 `fixpoint.reverified_at=2026-08-19T03:55:00Z`；`docs/evidence/introduction-resolved-subject-binding/fixpoint/attestation.json` 記 contract `4846c3f1…` 四指令全 exit 0，`summary.md` 記 object-clean clone 重放環境。已知失真：`reverified_at` 是手填值，晚於記錄它的 squash commit 約 13 分鐘；實質證據以 attestation 為準，本 PR 不改 bootstrap ledger）
- [x] 5.5 對照 `docs/agents/agent-governance-policy.md`，如 rebind 慣例在治理文件有殘留敘述，同 PR 更新（2026-08-19 全文 grep `docs/agents/*.md`：零殘留，無需變更；#636 後續於同檔新增正面慣例敘述「Lifecycle-ledger subject binding」）

## 6. 第二波：首次資料使用與 #589 驗收
- [x] 6.1 本 change 自身 row 由 legacy 升級為 sentinel（或確認 introduction-recovery 已覆蓋而無需升級），並同步 NOW.md 投影狀態（2026-08-19 取「確認覆蓋、不升級」分支：#629 fixpoint 在 object-clean clone 重放時，本 row 當時的懸空 subject `51adda76…` 由變更後的 base-aware required check 經 introduction-recovery 解析回 landed squash 並回綠，見 `docs/evidence/introduction-resolved-subject-binding/fixpoint/summary.md`；其後 #630 的 branch commit `db7b671`（merge `a2f01b9`）把本 row `subject_commit` 正規化為 `ab67877`，正是 ratchet 允許的唯一改寫形狀——恰等於舊 binding 的 resolved introduction。row 維持 `active`，`docs/plans/NOW.md` 的 `scope: current` 投影已載本 row 為 active，本波無 status 變動故投影零變更。殘留揭露：依 #636 最小範圍，本 PR 不改任何 row 的 `subject_commit`／`subject_binding`，因此本次 tasks.md 編輯之後、下一次擁有本 row 的 reconcile 之前，full verify CLI 會對本 row 回報 `source_changed_since_subject`；required CI 的 real-ledger 檢查只覆蓋 `RECONCILED_SOURCE_IDS` 四個 id，不含本 row，故不影響 gate）
- [x] 6.2 **危險窗操作閘（挑戰 B1）**：首個 sentinel row 寫入前，盤點 `gh pr list` open PRs 與長壽本機分支，通知 rebase；第一波 merge 與第二波之間保留至少一個工作日——**已繞過、未造成事故（2026-08-19 如實記錄）**：wave-1 squash `ab67877` 於 2026-08-19T03:14:09Z merged；首個 sentinel 宣告於 #621 的 branch commit `f652681`（2026-08-19T03:25:09Z，+11 分鐘），並隨 #621 merge commit `4a4bff5` 於 2026-08-19T04:18:13Z 進 main（+64 分鐘），兩個時點都遠短於一個工作日；repo 內亦查無 open PR 盤點或 rebase 通知紀錄。事後未觀察到災情：其後 #630（`a2f01b9`）、#638（`d0b7675`）的 sentinel row 寫入與改寫，以及本 PR 的 baseline 重跑（machine-truth 四件組全綠）均未出現相關失敗。2026-08-20 owner 追認：接受危險窗已繞過為終態 residual，不回補盤點／等待工作日；checkbox 改勾為 terminal disposition，本 change 得依 `openspec/AGENTS.md`「全部 checkbox 結案」契約 archive
- [x] 6.3 第一波 merge 後的下一次真實 reconcile 寫入第一筆（或首批）sentinel rows；squash-merge 後於 main 實跑 verify CLI，取得「零 follow-up rebind PR」與 drift 正確性實證，evidence refs 記入 ledger row（2026-08-19：首批兩筆已寫入——`isolated-branch-stack-browser-e2e`（#621 branch commit `f652681`，merge `4a4bff5`）、`a4-console-convergence`（#630 branch commit `57a0822`，merge `a2f01b9`）；#638（merge `d0b7675`）再以 sentinel 豁免把 a4 row 的 `subject_commit` 改寫為 `9e8ee5f`，同形狀改寫若發生在 legacy row 會被 ratchet 以 `subject_binding_required` 擋下。零 rebind 與 drift 正確性的 verify 實證由 #629 fixpoint 提供：object-clean clone 於 squash commit `ab67877` 重放，兩筆懸空 legacy subject 皆經 introduction-recovery 自癒回綠、零 follow-up rebind PR。已知殘留（#636 明列 out of scope）：兩筆 sentinel row 都以 merge commit 進場（`4a4bff5`／`a2f01b9` 皆 2 parents），sentinel 的 introduction-recovery 尚未被一次 squash 壓測；該 verify 實證也未回寫進那兩筆 row 的 `evidence_refs`（本 issue 不改他人 row）。兩者留待下一個 squash-merge 的 sentinel row 自然取得，不另行安排實驗）
- [x] 6.4 commit 前依 Lane 政策執行 `gitnexus detect-changes --scope compare --base-ref main` 確認只影響預期 symbols（2026-08-19 本波記帳 PR 實跑：`npx gitnexus@1.6.9 detect-changes --scope compare --base-ref main` 在本 worktree 回 `RegistryAmbiguousTargetError`——registry 有四筆同名 `AI-BIM-governance` 條目、本 worktree 未建 index，加 `-r` 指定 label 或絕對路徑均無法解析；本回合未取得 re-index 授權，依 repo 慣例與 task 1.1 相同處置記為 unavailable/UNKNOWN 而非 pass。替代證據：本 PR changed paths 全為 `openspec/**` 與 `docs/agents/**` 的 `.md`／`.json`，`Test-PrReviewNeedsGitNexus` 對此組路徑回 false，無 code symbol 進入 blast radius）
