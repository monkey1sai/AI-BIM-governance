# Tasks — conversion-artifact-id-sanitize

對應 plan：`docs/superpowers/plans/2026-06-11-conversion-artifact-id-sanitize.md`；spec：`docs/superpowers/specs/2026-06-11-conversion-artifact-id-sanitize-design.md`；issue：#205。

- [x] Task 0：`sanitizeArtifactIdPart` 純函式 + 回歸鎖/確定性/防碰撞測試（commit `937395b`）
- [x] Task 1：dispatch 接線（artifact_id）+ 中文 id 整合回歸（commit `e4258c0`）
- [x] Task 2：前端 `IfcReadyListItem.dispatch_error` 型別（commit `2bab95d`）
- [x] Task 3：`#/conv` dispatch_error 明細顯示 + vitest（commit `101cdc0`）
- [x] Task 4：Playwright E2E（中文 id dispatched + 必失敗 job 明細可見）+ tracked 證據（commit `763f069`）
- [x] Fix 1（對抗複驗 r1）：`model_version_id` sanitize + stub 對齊真 API 五欄（commit `ed6937f`）
- [x] Fix 2（對抗複驗 r2）：`event_id` fallback sanitize、`correlationIndex` 雙鍵對帳修復、stub 補齊 `_safe_optional_id` 欄位面、E2E 檔頭 skip 限制揭露、證據入庫、逐欄回歸鎖（commit `67518f5`）
