# PR 前 GitNexus detect_changes — scope 外溢門結論

- spec: `docs/superpowers/specs/2026-06-24-spec-page-ds-alignment-fixes-design.md`
- plan: `docs/superpowers/plans/2026-06-24-spec-page-ds-alignment-fixes.md`（Task 4）
- slug: `spec-page-ds-alignment-fixes`
- 執行時間: 2026-06-30
- branch: `worktree-spec-page-ds-alignment-fixes`（linked worktree；不動 main）
- HEAD: `e66a097`（task#4 之後、本 evidence commit 之前）
- 依據: spec §4 line 119「commit 前 `detect_changes(compare base_ref=main)`，確認 blast 限於 `#spec` 頁 + nav render + 新測試，未波及其他頁」
- 排序: impact upstream 安全門已**前移**至編輯前（Task P1 / F0，見 `impact-prescan.md`）；本 Task 只做 PR 前 **scope 外溢確認**，不重跑 impact。

---

## 0. 結論（一句話）

**scope 未外溢 → 門 PASS，放行續 PR。** 本批實際改動的 code 限於 `SpecPage`（`#spec` 頁 lead 字串，F1）與 `EdgeConsole`（nav render 的 `title` 屬性取值，F3），加 `edge-console.css` 的 `.ec-lead` margin token（F2，CSS）與 `console.test.tsx` 新測試（F1/F3 守門）；docs 4 檔。**零後端、零其他頁面**。

---

## 1. Ground truth — 純 git 三點 diff（最權威，非工具推論）

真實 PR 合併目標是 `origin/main`（本機 `main` 已 stale，見 §3）。three-dot `origin/main...HEAD`（以 merge-base `5e59dee` 為基準）= **8 檔**：

| 類別 | 檔案 | 改動 |
|---|---|---|
| code | `web-viewer-sample/src/console/pages.tsx` | 1 行（F1 `SpecPage` lead 字串） |
| code | `web-viewer-sample/src/console/EdgeConsole.tsx` | 1 行（F3 nav `title` → `navText`） |
| code | `web-viewer-sample/src/console/edge-console.css` | 1 行（F2 `.ec-lead` margin token） |
| code | `web-viewer-sample/src/console/console.test.tsx` | +20 行（F1/F3 新測試） |
| docs | `docs/superpowers/specs/2026-06-24-spec-page-ds-alignment-fixes-design.md` | spec |
| docs | `docs/superpowers/plans/2026-06-24-spec-page-ds-alignment-fixes.md` | plan |
| docs | `docs/evidence/spec-page-ds-alignment-fixes/impact-prescan.md` | F0 impact evidence |
| docs | `docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md` | 1 行（F4 現況補記） |

→ code 改動只落在 `web-viewer-sample/src/console/` 4 檔，無 `app.py` / `governanceProxy.ts` / coordinator / 任何後端，亦無其他 console 頁面。對齊 spec §3.1 In scope。

## 2. GitNexus detect_changes（`scope=compare base_ref=main`）

repo / worktree 皆指向 `…\.claude\worktrees\spec-page-ds-alignment-fixes`（linked worktree 須帶 `worktree` 路徑參數）。結果：

```
changed_files: 10   changed_count(含 docs section): 72   affected_count: 2   risk_level: medium
```

- **code symbols（唯二）**：
  - `Function web-viewer-sample/src/console/pages.tsx:SpecPage`
  - `Function web-viewer-sample/src/console/EdgeConsole.tsx:EdgeConsole`
- **affected_processes（唯二）**：
  - `proc_142_specpage`（`SpecPage → T`，intra_community，1 changed step）
  - `proc_197_edgeconsole`（`EdgeConsole → F`，intra_community，1 changed step）
- 其餘 70 個 changed_symbols 全為 `Section:`（docs 標題）—— plan / spec / AGENTS.md / minio-folderview spec 的章節，**無任何額外 code symbol**。
- `risk_level: medium` 由 **docs section 觸碰數量** 撐起，非 code blast；code blast 嚴格限於上述 2 symbol / 2 process，**完全等同 spec §4 預期「限於 `#spec` 頁 + nav render」**。

> 註：`base_ref=main` 比較面被本機 stale `main`（merge-base `a8fbcb4`）多帶進 `#256`（minio-folderview spec）/ `#258` / AGENTS.md 等**已合併純文件** PR 的 docs section，故 changed section 數偏多；但這些是 docs、不產生 code symbol，**不影響 code-scope 結論**。

## 3. 為何不採 `base_ref=origin/main` 的 CRITICAL 結果（two-dot 分支落後 artifact）

另跑 `base_ref=origin/main` 回 `changed_files: 38 / affected_count: 19 / risk_level: critical`，列入 `bim-review-coordinator/src/app.ts`、`web-viewer-sample/src/App.tsx`、`AppStream.tsx`、`Forms.tsx`、`StreamOnlyWindow.tsx`、`governance-service/README.md`、`A1GovernanceWorkbenchPage` / `IssuesRuleCenterPage` / `RuntimePage` 等。

**這是 two-dot tip-to-tip 比較 + 分支落後 `origin/main` 的 artifact，不是本批外溢**，證據：

- 本機 `main`=`f6de50e`、`origin/main`=`a123718`；本分支 base（與 `origin/main` 的 merge-base）= `5e59dee`，`origin/main` 在其後又合併多個 PR（coordinator / viewer / governance README 等），本分支**未帶**這些較新 commit。
- `git diff --name-only origin/main HEAD`（two-dot）= **55 檔**，含上述 coordinator/App/AppStream/Forms/governance README。
- `git diff --name-only 5e59dee...HEAD`（本分支真實改動）**grep 不到**任一上述檔 → 證明它們**不是本批改的**，是 `origin/main` 比本分支 base 多出的較新提交，被 two-dot 反向呈現。
- three-dot `origin/main...HEAD`（正確 PR 語意）= **8 檔**（§1），與 two-dot 55 檔差距即 `origin/main` 領先本分支的 47 檔。

→ CRITICAL/38 檔屬 **分支落後**訊號（PR 前可 rebase `origin/main` 收掉），**非 code symbol 外溢**，不翻 scope 門。

## 4. 為何 `edge-console.css` / `console.test.tsx` 未現為 changed_symbol（benign）

- `edge-console.css`：CSS selector（`.ec-lead`）非 GitNexus 索引的 code symbol，改 margin token 不產生 symbol-level 命中。
- `console.test.tsx`：detect_changes 預設排除測試檔；且 worktree 索引 lastCommit=`9a8151a`、落後 HEAD 6 commit，早於本批測試新增，新測試符號尚未入索引。
- 兩檔皆已由 §1 git ground truth 涵蓋、在 spec §3.1 In scope 內，**缺於 symbol 視圖屬預期、非遺漏**。

## 5. impact 前置安全門回顧（非重跑）

編輯前已於 Task P1 / F0 對兩個待改 code symbol 跑 upstream impact，皆 **LOW（epistemic exact）** 放行（`SpecPage` impactedCount=2：`renderBody`/`EdgeConsole`；`EdgeConsole` impactedCount=0）。詳見 `docs/evidence/spec-page-ds-alignment-fixes/impact-prescan.md`。本 Task 不重跑 impact，僅複述結論。

## 6. 判定

| 視角 | 結果 | scope 外溢？ |
|---|---|---|
| git three-dot `origin/main...HEAD` | 8 檔（code 4 全在 `src/console/`） | 否 |
| GitNexus `base_ref=main` code symbols | `SpecPage` + `EdgeConsole`（+2 process） | 否 |
| GitNexus `base_ref=origin/main` CRITICAL | two-dot 分支落後 artifact（§3） | 否（非本批） |

**scope 外溢門 = PASS。** code blast 嚴格限於 `SpecPage`（`#spec`）+ `EdgeConsole`（nav render）+ `.ec-lead` CSS token + 新測試 + docs，未波及任何其他頁面或後端。放行進入 PR。
