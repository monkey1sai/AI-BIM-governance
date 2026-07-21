# 變更：governance-throughput-budget——WIP 上限＋治理稅預算＋canon 批次化＋收斂行動清單

> **Status: adopted 2026-07-21**（使用者口令「採用建議 / A / 全做」；OQ-1 保留 A4+migrate-console、lineage deferred；OQ-2 首月 40%→次月 30%；OQ-3 本 change archive 出場）。原「供審非自動採納」語態自此升格為已採納政策來源。

> **供審，非自動採納。** 本 change 為治理提案（仿 #360「供審;不掛 auto-merge」慣例）：全文一律為「提案」語態，PR 不掛 auto-merge，須使用者逐條裁決採納後規則才生效；未經採納前，本文件不構成任何已生效規則，亦不得被引用為既定政策。
> **Owning folder：** `openspec/`（本 change 本體＋兩個未動工 change 的 deferred-proposed 註記）。不動任何程式碼、不動 AGENTS.md／CLAUDE.md 正文（canon 修訂依本提案 R3 批次化程序另走提案）、不動 `.env`、不動 `openspec/changes/archive/`。
> **與分支收斂設計 spec（#352）的關係：** `docs/superpowers/specs/2026-07-16-branch-convergence-design.md` 已裁決「本地分支＋worktree 收斂」與防再發散 3 條規則（PR merge 後刪分支、`claude/<隨機名>` 存活期限、每週 prune 盤點）。本 change **不重複建制該層**，只補其未覆蓋的上游兩層：**openspec active change 的 WIP 流量**與**治理類 commit 的產能佔比**。兩者互補：#352 管 git 分支存量，本提案管 change 在飛數與治理稅。快照非免驗依據的原則（#352 §4）本提案照抄沿用。

## Why

（數據為 2026-07-21 於本 worktree 對 origin/main@b9c88bf 實測；統計指令見 spec delta 各 Validation 欄）

- **治理稅近半**：近 60 天 origin/main 共 355 個 commit，其中 docs 111 ＋ chore 42 ＝ 153（**43.1%**）；rolling 14 天 87 個中 41 個（**47.1%**）。近半產能花在治理／文件維護而非功能交付。
- **WIP 過寬**：`openspec/changes/` 現有 **9 個 active change 同時在飛**（不含 archive），其中 3 個完全未動工（`a4-semantic-search-model-qa` 0/64、`align-frontend-design-system-reference` 0/23、`minio-folderview-and-baseline-disclosure` 0/7）、1 個僅起步（`rvt-ifc-usdc-lineage` 1/48，僅 8.1 contract-only）；同時 4 個已完成或僅剩收尾（`c-m4-runtime-command-bridge` 主 tasks 7/7、`viewer-embed-a1-highlight` 6/7、`minio-trigger-lifecycle-backend` 5/6、`minio-watch-key-structure` 4/5）卻未 close-out／archive。
- **失效後果（已實際發生）**：in-flight change 彼此對撞產生調和稅——`doc-first-canon-v2` 與 `align-frontend-design-system-reference` 在 `documentation-source-of-truth` 同一條 requirement 對撞，需 PF-1／PF-2／PF-3 三道前置調和，#363 已為此耗掉一整輪 PR 產能。WIP 越寬，這類 N² 碰撞與 rebase 成本越高；未動工 change 掛著不 defer，也持續佔用每次 `NoSuccessorWhilePredecessorOpen` 檢查與心智盤點成本。

## What Changes

1. **新 capability `governance-throughput-budget`**（specs delta，ADDED 4 條 requirement，每條含 trigger／action／validation 與 git 統計指令）：
   - **R1 WIP 上限**：active openspec change（不含 `archive/` 與帶 deferred 標記者）同時 ≤ 2。
   - **R2 治理稅預算**：rolling 14 天 docs＋chore commit 佔比目標 ≤ 30%；超標當週只收功能 PR（安全／誠實修正豁免）。
   - **R3 canon 修訂批次化**：正本／AGENTS 參照鏈修訂累積雙週一批處理，不逐條開 PR（緊急安全／誠實修正豁免）。
   - **R4 一次性收斂行動清單**：9 個 active change 的逐一處置提案（archive／close-out／deferred／留待裁決），含實核勾選現況表與 close-out 條件。
2. **對兩個未動工 change 的 proposal.md 頂部加 `Status: deferred-proposed` 註記**（`minio-folderview-and-baseline-disclosure`、`align-frontend-design-system-reference`）：只加註記區塊，不刪不改原內容；deferred 是否成立隨本 change 一併由使用者裁決。
3. **不含**：任何規則的自動 enforcement（hook／CI gate）——採納後若要機器化，另立 change。

## Impact

- **Affected specs**：`governance-throughput-budget`（新 capability，ADDED；與任何 active change 的 capability 無交集，無 NoSuccessorWhilePredecessorOpen 衝突）。
- **Affected docs**：`openspec/changes/minio-folderview-and-baseline-disclosure/proposal.md`、`openspec/changes/align-frontend-design-system-reference/proposal.md`（僅頂部各加一個註記區塊）。
- **不變更**：任何程式碼與後端凍結面、public API、event、DB schema、MinIO layout、Kit／WebRTC protocol、AGENTS.md／CLAUDE.md 正文、docs/plans 手寫正本、其他 active change 的 tasks／specs 內容、`openspec/changes/archive/`。
- **Non-goals**：不執行 #352 的分支／worktree 刪除（該 spec 明文「執行需另行授權」）；不裁決各 deferred change 的最終去留（重啟或放棄由使用者屆時裁決）；不定義產品行為——本 capability 為 repo 治理程序，非 runtime 行為契約。
- userFacing: false（純治理文件；無 UI、無 runtime 影響）。P4 browser evidence 不適用。

## Open Questions（不逕自定案，留使用者終裁）

- **OQ-1 收斂後仍餘 3 個大型 active**：R4 全部執行後，`a4-semantic-search-model-qa`（0/64）、`rvt-ifc-usdc-lineage`（1/48）、`migrate-console-to-hifi-design`（tasks 0/35 未勾，但 main #357 已落 1/2 product code）仍為 active，超出 R1 上限 1 個。保留哪 ≤2 個由使用者裁決；本提案僅陳述建議傾向（migrate-console 已有 main 落地量能宜優先收尾；a4 與 rvt 擇一 defer），不逕自定案。
- **OQ-2 30% 目標值**：現值 43–47%，30% 是一步到位還是漸進（如先 40% 再 30%）由使用者裁決；量測指令不受目標值影響。
- **OQ-3 自指悖論**：本 change 自身是第 10 個 active change。提案的自洽處置：採納即執行 R4 收斂並於 merge 後儘速 archive 本 change（tasks §4）；若使用者否決本提案，本 change 撤回、兩個 deferred-proposed 註記一併撤下。
