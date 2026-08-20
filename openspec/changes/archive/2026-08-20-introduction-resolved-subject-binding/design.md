# Design — introduction-resolved-subject-binding

> 本檔由 openspec-forge 兩階段（Fable/max 起草 → Opus/xhigh 獨立挑戰）產出；挑戰結論 `revise`，coordinator 已吸收全部 7 項 blocking 修訂（§8 對照表）。行號以 2026-08-18 `origin/main`（`fca2efa`）現檔為準，實作時需重新核對。

## 0. Context（已查證的機器真相）

- `scripts/lib/openspec-machine-truth.mjs`：`COMMIT = /^[0-9a-f]{40}$/`；`CHANGE_KEYS` 十鍵經 `assertExactKeys` 逐 row 強制；`subject_commit` 必須過 `COMMIT`；`SOURCE_OBSERVATION_KEYS = ['change_id','subject_commit','changed_paths']` 且 observation.subject_commit 必須等於 row.subject_commit；`sourceObservations === null` 時全部 rows 的 subject 必須等於 trustedSubject；`source_changed_since_subject` 逐 row 由 observation.changed_paths 過 `isOwnedOpenSpecSource` 產生。**strict `validateLedgerShape` 同時套用於 HEAD ledger 與 base 的 previous ledger**（挑戰 B1 證實，直接決定 two-phase 危險窗，見決策 4）。
- `scripts/tests/verify-openspec-machine-truth.mjs`：`assertGitSubject` 要求 `--subject` 恰等於 checked-out HEAD；`resolveRowSubjectWatermark`＝subject 存在且為 HEAD ancestor → 用之；存在但非 ancestor → `subject_not_ancestor` 硬失敗；不存在 → `ledgerIntroductionCommit`：`git log --format=%H -S{subject} HEAD -- openspec/lifecycle-ledger.json`，`MAX_INTRODUCTION_CANDIDATES = 32`，逐 candidate 驗「該 revision ledger 含 {id, subject} 且 parent 不含」，多於一個 introduction → fail closed，introduction 必須是 `--base` 的 ancestor。folded-into-same-squash residual limit 以註解明文。memoization cache key `${id}\n${subject_commit}`，**每 row 恰被呼叫一次**（挑戰 N2）。`MAX_UNIQUE_SUBJECTS = 64`。`assertGitBase` 只要求 40-hex＋本機存在＋HEAD ancestor——**`--base = HEAD` 可通過**（挑戰 B5）。
- `changedPathsSince` 對每個相異 watermark 做一次 `watermark..HEAD` 的**全 repo** diff，並在 owned 過濾**之前**把全部 paths 計入單一共享 rawBudget（10k paths／2MB）——**budget 消耗與相異 watermark 數成正比**（挑戰 B2 證實，決定決策 5 的形狀）。
- `scripts/lib/openspec-repository-lifecycle.mjs`（PR CI 的 openspec gate，no network no git）：`parseLifecycleLedger` 逐 row 只驗 `id` 與 `status`，未知欄位不拒絕；`schema_version` 硬釘 `openspec-lifecycle-ledger/v1`。
- **CI 具現方式（挑戰 B3 證實）**：`agent-governance.yml` 用 plain `actions/checkout`（PR merge ref）執行 **HEAD 腳本**；唯一 base-pinned 具現是 `pr-review-agent.yml`。machine-truth comparator（verify CLI）不在任何 `.github/` workflow 中被呼叫；CI 以 node --test 跑其測試檔。
- **required CI 的真實 ledger 檢查點（2026-08-18 乾淨 clone 實證，规格定稿後追加的關鍵事實）**：`test-openspec-machine-truth.mjs` 的「current ledger keeps reconciled source snapshots clean」test 對**真實 ledger 的全部 rows** 執行 `collectSourceObservations(process.cwd(), ledger)`——**未傳 `baseCommit`** → `ledgerIntroductionCommit` 內 `typeof baseCommit !== 'string'` 直接 throw → **#474 introduction-recovery 在 required CI 中結構性不可用**。實證：`--no-local` 乾淨 clone checkout `6aab355`（ledger 含懸空 `483db79`）跑該 test → `subject_unavailable` fail。任何一列懸空 subject 都會讓其後所有 PR 的 required `agent-governance` 變紅——這（而非 lifecycle gate）就是 treadmill 的 CI 強制點，也解釋了 #562／#564／#567／#580／#587 在 #474 落地後仍然必要。**推論一：sentinel 解析同樣依賴 trusted base——若不先把這個 test 改為 base-aware，第二波寫入 sentinel row 會把 required CI 弄成永紅。base-aware 化是第一波的硬前提（tasks 2.6）。推論二：#589 P1「rebind 慣例廢止」在 P2a 第一波落地前操作上不可執行——squash 後留下懸空 binding 仍必須立即 rebind PR。**
- `scripts/tests/openspec-lifecycle-ledger.schema.json`：`change` definition `required` 十鍵＋`additionalProperties: false`——第三個 strict 驗證面，由 `scripts/tests/reconcile-openspec-ledger.ps1` 載入（該腳本把 `subject_commit` 列 `$notEvaluated`）。
- `scripts/lib/risk-proportional-review.mjs`：`SELF_REFERENTIAL_PATTERNS` 含 `scripts/tests/verify-openspec-machine-truth.mjs` 與 `scripts/lib/openspec-machine-truth.mjs`；rule `self_referential_changes_require_existing_base_verification_and_human_approval`。

## 1. 決策一：sentinel 形式——選 Option A（`subject_binding` 欄位），棄 Option B（`subject_commit` sentinel 值）

**Option A（採用）**：新增選填欄位 `subject_binding: "introduction"`；`subject_commit` 照舊記 40-hex（reconcile 當下 PR HEAD），角色降級為「binding watermark／識別鍵」，不再承諾存活。

**Option B（否決）**：`subject_commit` 允許 sentinel 值（字面 `"introduction"` 或 all-zeros SHA）。四個獨立軸全部致命：

1. **`-S` needle 崩塌**：#474 演算法以 `-S{subject_commit}` 為搜尋 needle。sentinel 常值讓所有 sentinel rows 共用同一 needle——candidates 立即超過 32 → 永久 fail closed。Option A 保留逐 row 唯一的 40-hex needle。
2. **`COMMIT` regex 破壞**（字面值）或**假 SHA 歧義**（all-zeros）。
3. **`source_observations` 等式契約破壞**：observation.subject_commit 必須是 `COMMIT` 且等於 row.subject_commit；Option A 完全不動這個契約。
4. **watermark 資訊毀滅**：捨棄最後真實 SHA 後，introduction 解析與 drift 基準都失去逐 row 識別。

**Option A 對三個 strict 驗證面的精確影響**：

- `CHANGE_KEYS` exact-keys：演進為「十鍵基本形，或十一鍵含 `subject_binding`」雙形狀；其他未知鍵照舊 fail closed。值域封閉：僅字串 `"introduction"`。
- `openspec-lifecycle-ledger.schema.json`：`change.properties` 增列 `subject_binding: { "const": "introduction" }`；`required` 與 `additionalProperties: false` 不變。
- `COMMIT` regex：零變更。

## 2. 決策二：sentinel row 的有效 subject 解析（determinism 為第一約束）

```
resolve(row) =
  legacy（無 subject_binding）：
    subject ∈ ancestry(HEAD)      → subject           （現行為）
    subject 不存在                 → introduction 解析  （#474 現行救援）
    subject 存在 ∉ ancestry(HEAD) → subject_not_ancestor 硬失敗（現行為，不變）
  sentinel（subject_binding = "introduction"）：
    subject ∈ ancestry(HEAD)      → subject           （self-anchored：in-PR 剛 reconcile）
    否則（不存在 或 存在但 ∉ ancestry(HEAD)）
                                   → introduction 解析（#474 演算法原樣：unique、≤32、
                                     introduction ∈ ancestry(trusted base)；失敗一律 HELD）
```

- **sentinel 與 legacy 的唯一行為差**：exists-but-not-ancestor 分支。sentinel 宣告「記錄的 SHA 只是 watermark 鍵」，此分支改走 introduction 解析——判定只依賴 (HEAD 歷史, trusted base, ledger 內容)，跨 clone deterministic。
- **信任錨點雙重補強（吸收挑戰 B5）**：sentinel 把信任從「subject 可達性」轉移到「introduction ∈ ancestry(trusted base)」，但現行 `assertGitBase` 允許 `--base = HEAD`，攻擊者可在自家 branch 鑄造 binding 後以 `--base=HEAD` 自我背書。補強：checkout 存在 `refs/remotes/origin/main` 時，`assertGitBase` SHALL 額外要求 `--base ∈ ancestry(origin/main)`（含相等）。post-squash 於 main 執行（base=HEAD=main tip ∈ ancestry(origin/main)）與正常 PR 執行（base=PR base ∈ ancestry(origin/main)）皆不受影響；鑄造分支的 branch tip 不在 origin/main 歷史 → 拒絕。無 origin/main ref 的環境（測試 fixture repos）維持現行為並以 fixture 釘住，`--base` 的殘餘信任邊界（caller 誠實）明文寫入 CLI 註解。
- **self-anchored 分支為何必要**：in-PR 剛 reconcile 的 sentinel row，其 binding 的 introduction 是 branch commit，不可能是 trusted base ancestor；無此分支則所有 in-PR run 都 HELD。
- **`ledgerIntroductionCommit` 原樣重用**：needle、candidate 掃描、parent 比對、≤32、unique、base-ancestry 全部不變；失敗照舊 `MachineTruthInputError`＝HELD。
- **drift 計算**：sentinel row 的 `source_changed_since_subject`＝effective subject..HEAD 對 owned paths 的變更。folded-into-same-squash residual limit 原樣保留並以 fixture 固定「預期不紅旗」邊界。

## 3. 決策三：reconcile ratchet（吸收挑戰 B4——封死 drift laundering）

- **新 row**（base 無此 id）：新 binding 必須 (i) 帶 `subject_binding: "introduction"`，或 (ii) `subject_commit ∈ ancestry(trusted base)`。(ii) 只可能把 watermark 錨在更舊的落地歷史 → 只會**多報** drift，方向安全。
- **被改寫的 row**（base 有此 id 且 subject_commit 不同）：必須 (i) 帶 sentinel，或 (ii) 新值**恰等於「舊（base）binding 的 resolved introduction commit」**——即 P2b normalization 的精確機器定義，由同一演算法解析驗證。挑戰 B4 證實草案的「任意 base ancestor」版本允許把 watermark 前移到 base tip、無聲洗掉該 row 全部累積 drift；恰等式把 (ii) 收斂到「保 watermark 的正規化」，laundering 不可行。
- 違反 → CLI 硬錯誤 **`subject_binding_required`**（定案命名，含 report schema enum 對齊；不再標「建議」）。
- **放置層**：ancestry／introduction 判定需要 git → ratchet 落在 verify CLI，不動 lib 輸入契約。
- **與 in-PR reconcile 契約的相容**：reconcile 時寫 `subject_commit = PR HEAD`（滿足 subject==HEAD 與等式契約）＋ `subject_binding: "introduction"`（滿足 ratchet）。PR HEAD 非 base ancestor 也非 introduction → ratchet 恰好強制 sentinel。
- **並存性**：未觸碰 rows 免疫；previous ledger 為 null（bootstrap-era）不套用。
- **強制面（吸收挑戰 B7）**：ratchet 只在 machine-truth comparator 的執行面生效（agent evidence 迴圈、post-merge fixpoint、手動 CLI）；required PR CI 不跑 comparator，維持 no-git 邊界是明示 non-goal。PR CI 可選擇性加 shape-only 靜態驗證（`subject_binding` 值域），不承擔 ratchet 語義。

## 4. 決策四：`schema_version` 維持 v1、two-phase landing（吸收挑戰 B1／B3）

- **不 bump 版本**：正確理由（B3 修正後）＝(a) additive 選填欄位風險嚴格較低；(b) `openspec-repository-lifecycle.mjs` 硬釘 v1，bump 迫使同 PR 觸碰 PR CI gate（另一 mechanism surface）而零收益。草案原引的「base-pinned gate 會 deadlock」不成立——agent-governance 用 merge-ref checkout 執行 HEAD 腳本，唯一 base-pinned 具現是 pr-review-agent.yml。
- **Two-phase 與危險窗（B1 修正後的精確模型）**：
  - 第一波（code）：雙形狀 schema＋解析＋ratchet＋測試落 main；ledger 資料面零 sentinel。任何驗證面（新舊腳本）看到的 ledger 都是舊形狀 → 必綠。
  - 第二波（data）：第一波落 main 後的 reconcile 才寫入 sentinel row。
  - **危險窗**：strict `validateLedgerShape` 也驗 **base 的 previous ledger**。第一筆 sentinel 落 main 後，「腳本舊、trusted base 新」的執行組合會 `schema_invalid`。CI 免疫（merge-ref 帶入新腳本；node --test 只跑 fixtures）；受影響面＝未 rebase 的長壽本機分支上的 agent evidence run。操作閘（tasks 6.2）：首個 sentinel 寫入前盤點 open PRs、通知 rebase，並在第一波 merge 與第二波之間保留至少一個工作日。
- 本規格 PR 自身的 lifecycle row 用 **legacy 10-key 形狀**（sentinel 欄位在第一波前尚不存在於任何驗證面）；squash 後其 subject 懸空屬 P1 已裁決的正常狀態，並成為第二波 sentinel 升級（或 introduction-recovery）的 dogfood。

## 5. 決策五：容量——`MAX_UNIQUE_SUBJECTS` 與 rawBudget 記帳點（吸收挑戰 B2／N1／N6；owner 已裁決）

草案原論證（「每 watermark 至多一次 diff、全域 rawBudget 與 diff 次數無關」）**事實反轉**：`changedPathsSince` 對每個相異 watermark 各做一次全 repo diff，並在 owned 過濾前把全部 paths 計入同一共享 budget——**budget 消耗 ∝ 相異 watermark 數 × repo churn**。今天 64 上限撐住是因 bulk normalization 把 ~112/121 rows 收斂到共用 subject；sentinel 終態每 change 一個獨立 watermark，兩個常數會一起到期。

**Owner 裁決（2026-08-18）**：

- `MAX_UNIQUE_SUBJECTS`：64 → **500**（對齊 ledger row cap）。
- rawBudget 記帳點：由「`changedPathsSince` 對全 repo diff 立即計入 `consumeRawObservationPaths`」**移到 owned-path 過濾之後**——即先以 `isOwnedOpenSpecSource` 過濾出屬於該 change 的 paths，budget 只對過濾後的集合計數。此舉把消耗與「相異 watermark 數 × repo 全域 churn」的比例關係，收斂為「相異 watermark 數 × 各自 owned churn」——後者是規格意圖真正要衡量的量，且不受不相關目錄的無關編輯影響。
- rawBudget 常數本身（10,000 paths／2MB）**不變**——記帳點修正後，同一常數對應的有效上限已顯著寬鬆，暫不需要額外調大；若實作時以 500-row／owned-only 情境重新量測發現不足，於同一 PR 內另行提案調整並附量測依據。
- git 子程序數上界：每懸空 row ≤ 1 cat-file ＋ 1 log -S ＋ 32×2 show；由 rows cap、candidates cap 與逐呼叫 15s timeout 界住；實作時在註解記明上界推導（N1）。

## 6. 決策六：快取（吸收挑戰 N2）

`resolveRowSubjectWatermark` 每 row 恰被呼叫一次，既有 memoization（key `${id}\n${subject_commit}`）是正確性護欄而非效能特性；規格不再宣稱「同 run 重複解析命中快取」場景。跨執行持久快取明確 out of scope；未來引入須另立 change 並規定 revalidation。

## 7. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 改壞 mechanism surface（兩支 SELF_REFERENTIAL 腳本） | human_critical＋bootstrap ledger 登記＋merge 後 fixpoint（tasks §5）；two-phase 使任何 base 裁決面對相容資料 |
| B1 危險窗：舊腳本×新 base ledger `schema_invalid` | 第二波操作閘（tasks 6.2）＋波間隔離期 |
| ratchet 被用於 drift laundering | 決策三恰等式（B4）＋回歸測試 |
| `--base=HEAD` 自我背書鑄造 binding | 決策二 origin/main ancestry 錨（B5）＋fixture |
| sentinel 擴散造成 budget 爆表 | 決策五聯合容量裁決（B2）＋回歸測試 |
| folded-squash 殘留限制被誤「修復」 | 規格明文＋fixture 固定預期行為 |

## 8. 挑戰處置對照（openspec-forge 第二階段，recommendation=revise）

| # | 挑戰要點 | 處置 |
|---|---|---|
| B1 | previous（base）ledger 也吃 strict 驗證，舊碼×新資料硬失敗 | 決策 4 危險窗模型＋tasks 6.2 操作閘 |
| B2 | rawBudget 消耗 ∝ watermark 數，草案論證反轉 | 決策 5 改寫；常數合併單一裁決 |
| B3 | 「base-pinned gate deadlock」前提錯誤 | 決策 4 理由更正（merge-ref 執行 HEAD 腳本） |
| B4 | ratchet (ii)「任意 base ancestor」允許 drift laundering | 決策 3 改寫：rewrite 必須恰等於舊 binding 的 introduction |
| B5 | sentinel 信任塌縮到 caller 供給的 `--base` | 決策 2 origin/main ancestry 錨＋trust envelope 明文 |
| B6 | Impact 清單與 tasks 矛盾（NOW.md／change dir／bootstrap ledger／evidence 缺列） | proposal Impact 補齊 |
| B7 | ratchet 不在 required CI，中心主張不可驗證 | proposal「強制面誠實界定」章＋驗收條件改寫＋PR CI shape-only 選項 |
| N1–N6 | 子程序上界、memoization 空洞、report schema、WIP、錯誤碼 TBD、常數拆裂 | 決策 5／6 改寫；`subject_binding_required` 定案；本 change 以 deferred 開案（WIP 5/6 不變）；report schema 入 Impact 與 tasks |
