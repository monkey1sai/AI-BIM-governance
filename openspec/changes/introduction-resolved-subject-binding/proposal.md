# introduction-resolved-subject-binding

> **Status: deferred 2026-08-18**（使用者裁決 spec-first：規格先行落地，實作另案排程）。不計入 active WIP。
>
> **重啟條件**：owner 明示排程 P2a 第一波實作（本 change tasks §1–§5），或任何 machine-truth consumer 因懸空 subject 實際 fail-closed 而需要提前落地時 thaw。thaw 前本 change 只是規格正本，不得據以修改任何 mechanism surface。

## Why（為什麼）

`openspec/lifecycle-ledger.json` 的每個 row 以 `subject_commit`（40-hex 小寫 SHA）綁定「本 row 最後一次對齊 sources 的 commit」。repo 的 merge 策略是 squash-merge：PR HEAD 在 merge 後被丟棄，row 記錄的 branch SHA 懸空，於是歷史上每次 merge 後都跟著一支 follow-up rebind PR（#562／#564／#567／#580／#587）——post-squash rebind treadmill（issue #589）。

Owner 已裁決（#589 comment，2026-08-18；本 change 不重新辯論）：

- **P1 已採納**：post-squash rebind 慣例廢止；#474（commit `afa5c73`）落地的 introduction-recovery（`resolveRowSubjectWatermark` + `ledgerIntroductionCommit`，`scripts/tests/verify-openspec-machine-truth.mjs`）是 canonical 語義——subject 不存在時，以 `git log -S{subject_commit}` 找出「把 {id, subject_commit} binding 引進 HEAD 歷史的唯一 introduction commit」，並要求該 commit 是 trusted base 的 ancestor。
- **P2b（opportunistic normalization）為過渡**；本 change 是 **P2a 終態**：讓 row 可以「宣告」introduction-resolved binding，把 #474 的救援語義升級為一等公民，從機制上根治 treadmill。

## What Changes（改什麼）

1. **Schema 演進（spec: openspec-lifecycle-ledger-schema）**：row 新增選填欄位 `subject_binding`，唯一合法值 `"introduction"`；缺席＝legacy commit binding，語義完全不變。`subject_commit` 維持 40-hex（sentinel row 記錄 reconcile 當下的 PR HEAD，作為 binding watermark／`-S` 搜尋鍵）。`schema_version` 維持 `openspec-lifecycle-ledger/v1`（additive）。三個 strict 驗證面同步：`scripts/lib/openspec-machine-truth.mjs`（`CHANGE_KEYS` exact-keys）、`scripts/tests/openspec-lifecycle-ledger.schema.json`（`additionalProperties: false`）；`scripts/lib/openspec-repository-lifecycle.mjs`（PR CI gate）經查證只驗 row 的 `id`+`status`，無需語義變更，但要加回歸測試釘住這個寬容性，並可選擇性地加入 `subject_binding` 的 shape-only 靜態驗證（見 tasks 1.6）。
2. **有效 subject 解析（spec: openspec-machine-truth-subject-resolution）**：sentinel row 的有效 subject＝(a) `subject_commit` 是 HEAD ancestor 時取其自身（in-PR self-anchored）；(b) 否則一律以 #474 演算法解析 introduction commit。任何歧義／解析失敗 fail closed（HELD），不得 round down。folded-into-same-squash 的 source edits 殘留限制照舊明文保留。另補強 `--base` 信任錨：checkout 存在 `refs/remotes/origin/main` 時，`--base` 必須是其 ancestor（封死 caller 以 `--base=HEAD` 自我背書的鑄造路徑）。
3. **Reconcile ratchet（spec: openspec-machine-truth-reconcile-ratchet）**：相對 trusted base 的 previous ledger，「新 row」與「`subject_commit` 被改寫的 row」必須：新 row＝帶 sentinel 或綁 trusted-base ancestor；被改寫的 row＝帶 sentinel 或新值**恰等於舊 binding 的 resolved introduction commit**（P2b normalization 的精確定義；任意 base ancestor 不合法，防止把 watermark 前移到 base tip 洗掉累積 drift）。違反＝硬錯誤 `subject_binding_required`。
4. **容量對齊**：`MAX_UNIQUE_SUBJECTS`（現 64）與全域 rawBudget（10k paths／2MB）在 sentinel 終態下同屬一個容量決策——per-watermark 的 `changedPathsSince` 對**全 repo diff** 收 budget，消耗與相異 watermark 數成正比。兩常數（含是否把 budget 記帳移到 owned-path 過濾之後）合併為單一 owner 簽核項（openQuestions #1），規格只鎖結果：ledger 成長到 row cap 不得機械性觸發 budget 失敗。
5. **回歸測試與 fixtures**：ambiguity（rebind-away-and-back）、>32 candidates、stale-base ancestry、`--base` origin-main 錨、folded edits residual limit、sentinel row 的 `source_changed_since_subject`、P2b 精確 normalization、legacy row 行為不變、determinism、budget。

## 落地順序（two-phase，危險窗明示）

- **第一波（code）**：schema 支援＋解析＋ratchet＋測試落 main；ledger 資料面零 sentinel row。
- **第二波（data）**：第一波落 main 之後的 reconcile 才開始寫 sentinel row。
- **危險窗（挑戰 B1 確認）**：strict `validateLedgerShape` 同時驗 HEAD 與 **BASE** ledger。第一筆 sentinel row 落 main 後，任何「腳本還是舊版、trusted base 已指向新 main」的本機 checkout 跑 machine-truth comparator 會 `schema_invalid` 硬失敗。CI 不受影響（merge-ref checkout 會帶入 main 的新腳本；node --test 只跑 fixtures）；受影響面是未 rebase 的長壽本機分支。第二波開始前必須執行 tasks 6.2 的操作閘（盤點 open PRs／通知 rebase）。

## Impact（影響）

- 受影響檔案（第一波實作 PR）：`scripts/lib/openspec-machine-truth.mjs`、`scripts/tests/verify-openspec-machine-truth.mjs`、`scripts/tests/openspec-lifecycle-ledger.schema.json`、`scripts/tests/openspec-machine-truth-report.schema.json`（error enum 增列 `subject_binding_required`）、`scripts/tests/test-openspec-machine-truth.mjs`、`scripts/tests/test-openspec-machine-truth-cli.mjs`＋fixtures、`scripts/self-referential-bootstrap-ledger.json`（bootstrap 登記）、對應 `docs/evidence/**` bootstrap evidence。
- 本規格 PR 的檔案：`openspec/changes/introduction-resolved-subject-binding/**`、`openspec/lifecycle-ledger.json`（新增本 change 自身 row，legacy 10-key 形狀——sentinel 欄位在第一波落地前尚不存在）、`docs/plans/NOW.md`（投影新增 deferred row）。
- **風險等級：實作 PR 為 human_critical（mechanism surface）**。`scripts/lib/openspec-machine-truth.mjs` 與 `scripts/tests/verify-openspec-machine-truth.mjs` 皆在 `scripts/lib/risk-proportional-review.mjs` 的 `SELF_REFERENTIAL_PATTERNS`，適用 `self_referential_changes_require_existing_base_verification_and_human_approval`；實作 PR 必須依 `docs/agents/self-referential-bootstrap.md` §2 登記 bootstrap ledger（entry claim ⊆ changed paths）並於 merge 後 fixpoint 重驗。
- **不受影響**：PR CI（agent-governance）的 openspec gate 維持 no-git 邊界；`source_observations` 的 exact keys 與「observation.subject_commit == row.subject_commit」契約；`reconcile-openspec-ledger.ps1` 的評估邏輯（`subject_commit` 本在 `$notEvaluated`）。

## 強制面誠實界定（挑戰 B7 吸收）

ratchet 與 sentinel 語義由 **machine-truth comparator 的一切執行面**強制：agent 端 evidence 迴圈（spec-to-done／std-evidence）、post-merge fixpoint 重驗、以及任何手動 CLI 執行。**required PR CI 不強制 ratchet**——PR CI 的 openspec gate 維持 no-git 邊界是明示 non-goal；PR CI 對 sentinel 欄位至多做 shape-only 靜態驗證（tasks 1.6，可選）。因此「reconcile 之後永不寫入會懸空且無宣告的 branch SHA」的保證範圍＝所有經 comparator 把關的 reconcile 路徑；不經 comparator 的手寫 ledger 編輯由 review 與 post-merge fixpoint 兜底。

## 驗收條件（承接 #589，強制面已誠實化）

1. 第一個 sentinel row 經一次 squash-merge 後，於 main checkout 實跑 machine-truth comparator：該 row 解析為 squash commit，**零 follow-up rebind PR**。
2. introduction commit 之後對該 change owned sources 的編輯，恰好紅旗該 row（`source_changed_since_subject`）。
3. 回歸測試全綠：`node scripts/tests/test-openspec-machine-truth.mjs`、`node scripts/tests/test-openspec-machine-truth-cli.mjs`、`pwsh scripts/tests/test-openspec-ledger-reconciliation.ps1`、agent-governance 檢查。

## Non-goals（不做）

- 不強制一次性遷移既有 rows；P2b normalization 不設落日，永久並存。
- 不引入跨執行的持久化解析快取。
- 不讓 PR CI gate 開始驗 subject 存活或 ratchet 語義（維持 no-git 邊界）。
- 不改變 legacy（無 `subject_binding`）rows 的任何現行為，包含 exists-but-not-ancestor 的 `subject_not_ancestor` 硬失敗。

## Open Questions（owner 裁決項）

1. **容量常數聯合裁決**：`MAX_UNIQUE_SUBJECTS` 上修幅度（草案：對齊 row cap 500）＋全域 rawBudget 是否隨之調整＋是否把 budget 記帳移到 owned-path 過濾之後（消除與 repo churn 的比例關係）。三者同屬一個決策，須一起簽核。
2. **ratchet 違規呈現層級**：預設 CLI 硬錯誤 `subject_binding_required`（HELD 停機）；替代案為 mismatch row（agent 於 evidence 迴圈看紅旗自行修復）。
3. `scripts/tests/openspec-lifecycle-ledger.schema.json`、`openspec-machine-truth-report.schema.json` 與新增 fixtures 是否應納入 `SELF_REFERENTIAL_PATTERNS` 或 `scripts/verification-manifest.json`（實作時依 self-referential-bootstrap §2.1 升級規則核對清單全文）。
4. **終態收斂範圍**：是否另立 follow-up change 把 archived rows 全面收斂為 sentinel（本 change 不涵蓋）。
5. `reconcile-openspec-ledger.ps1` 報表是否新增 `subject_binding` 可觀測欄位（純加值，若加需同步其 report schema）。
