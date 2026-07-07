# Spec-2：A2 版本差異收尾（assignee 消費端）

> 日期：2026-07-07 · 狀態：使用者已核可設計
> 前置依賴：**Spec-1 §2**（assignee 後端）先落地。
> A2 主體已建成（GlobalId 多級 diff、選版器、從 diff 建 Issue；DS 對齊 PR #242）。本 spec 只補「轉 Issue 可指派」（開發軌跡 A2 DoD 最後一項）。

## §1 範圍

1. **建 Issue 帶指派**：VersionDiffPage 的「從 diff 建 Issue」流程加 optional assignee 欄位（自由文字），走 `POST /api/governance/issues/from-diff/:diffId` 的 optional `assignee`（Spec-1 §2.2）。
2. **顯示指派**：diff 相關 issue 清單／連結顯示 assignee（無值顯「未指派」）。
3. 證據型更新（模式 3）：建立成功→重抓→才更新畫面。

## §2 明確不做（誠實鐵律紅線）

- `apply-overlay` 維持後端誠實 **501 · p15**，前端不得接真 overlay。
- **A2 頁不得出現成本影響塊**（成本屬 A6/A9 範疇，README §4 鐵律）。
- 不自寫 diff（鐵律 #9：對齊 ifcdiff 語意）；不動 diff_engine 既有行為。
- `change_type` enum（`added/removed/moved/geometry_changed/property_changed`）逐字 echo 不自創。
- 3D onion-skin 屬 M4 之後，不做；未來沿用 IX-3D-05 指令族（`source:"a2"`），掛鉤已登記於 Spec-0 §2.2。

## §3 驗收（DoD）

1. E2E（Playwright/gstack）：選 base/target→Run Diff→挑一筆變更建 Issue（帶 assignee）→issue 顯示指派→截圖落 `artifacts/e2e/`（PNG `git add -f`）。
2. `npx tsc --noEmit`＋`npm test` 綠；`#a2` 頁面無成本影響塊（截圖佐證）。
3. GitNexus：改 symbol 前 `impact`、commit 前 `detect_changes`。
