# Tasks — a2-version-diff-selector

對應 plan：`docs/superpowers/plans/2026-06-11-a2-version-diff-selector.md`；spec：`docs/superpowers/specs/2026-06-11-a2-version-diff-selector-design.md`。

- [x] Task 0+1：file_library 三層版本目錄掃描 + pytest（兩層回歸鎖 + 三層案例 + 第四層忽略 + 混排排序）（commit `70fe58f`）
- [x] Task 2：VersionDiffPage 雙組三層選擇器 + model_version_id 帶出/清空（commits `da9dbea` + 4 fix；updater 純函數修復 `9e5cdc3`）
- [x] Task 3：前端 vitest（選擇器/帶出/graceful degrade/手動覆寫清綁定 + guard/防污染斷言補強 `7fc2a97`）
- [x] Task 4：Playwright E2E（真 diff 非全零 + 松風庵三層）+ tracked 證據（commit `5f77f62`）
- [x] Task 5：全套回歸 + E2E spec 終態信號重構 + final re-run 證據入庫（commits `931914b`、`bd3845a`、`54dbede`、`d8a5c70`）
