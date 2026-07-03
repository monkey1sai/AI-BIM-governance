# Spec：AGENTS.md 補齊雙圖譜衝突處置的通用規則與 codebase-memory 已知盲點

## 問題

`AGENTS.md` §3 現有規則只寫「GitNexus 與 codebase-memory-mcp 兩者查無結果或有疑義時以 GitNexus 為準」，但這條「衝突時要人工核對」的安全網，實際上只落在 `spec-to-done` 的 `SKILL.md`（PR #239 導入的雙圖譜 advisory 機制）內部，一般互動對話 session 的規則文字裡沒有這句話——`AGENTS.md` 對一般 session 只講「修改 code symbol 前的 `impact` 與 commit 前的 `detect_changes` 仍只由 GitNexus 判定」，沒有講兩圖譜結果對不上時該怎麼辦。

2026-07-03 互動對話中做 GitNexus vs codebase-memory-mcp 的精準度/token 成本比較，拿真實 symbol `deriveIntakeFromKey` 對兩邊下同一個「誰呼叫它」的查詢並用 `query_graph` cypher + 讀原始碼核對，發現：

- GitNexus 十天前記錄過的假陰漏報（`impact upstream` 回 `impactedCount:0`）已在今天 reanalyze 後修好，實測回正確的 7 個 caller。
- 同一次測試在 codebase-memory-mcp 側找到新的假陽性：`bim-review-coordinator/src/services/streamingConversionClient.ts` 的 `pollConversionResult` 方法內有一個區域閉包變數 `const tick = async () => {...}`（純本地 polling loop，見該檔 L252），跟 `minioWatcher.ts` 模組層級、真正被 `triggerIntake` 呼叫鏈用到的 `tick` 函式同名但無關；codebase-memory 的圖譜把兩者誤併成同一節點，`trace_path(direction=inbound)` 因此多回了兩筆不存在的 caller（`streamingConversionClient.ts` / `pollConversionResult`）。用 `query_graph` 直接查真實邊列表可確認：兩者之間唯一的真實關聯是 `deriveIntakeFromKey CALLS sanitizeArtifactIdPart`（方向相反、對象也不同）。

這個具體案例過去沒有寫進任何治理文件，一般 session 若信任 codebase-memory 對常見命名符號（`tick`/`run`/`init`/`handle` 這類）的呼叫鏈結果，有再次踩雷的風險。

## 設計

在 `AGENTS.md` §3 既有段落中插入一句，範圍限定為文字敘述，不改變任何 gate 邏輯本身：

1. 明文「衝突時以 GitNexus 為準」的處置規則對**所有 session**（含一般互動對話）通用，不限 `spec-to-done` 自動化管線；兩圖譜對同一 symbol 給出不同答案時，MUST 用 grep/Read 核對原始碼再下結論，不得逕自採信單邊「exact」標籤。
2. 記錄 2026-07-03 實測到的兩個具體案例（GitNexus 假陰已修好 / codebase-memory 對同名符號誤併的假陽性），作為未來判斷「何時該懷疑哪一邊」的具體依據。

不改動 `impact`/`detect_changes` 的 gate 判定歸屬（仍只由 GitNexus 判定，§4 不動）；不新增任何自動化檢查腳本；不影響 `spec-to-done` 既有的 SKILL.md 雙圖譜 advisory 段落（範圍不重疊，各自獨立）。

## 治理護欄

- 純文件敘述變更，`AGENTS.md` 行數維持 208 行（未超過 §2 記載的 ≤250 硬預算）。
- 不修改 `.github/workflows/*.yml`、`.claude/workflows/`、任何 hook 或 skill 程式碼。
- 不改變 GitNexus `impact`/`detect_changes` 作為唯一 gate 權威的既有設計（本次實測反而驗證了這個設計的必要性——兩邊都會出錯，方向不同，單一權威 + 手動覆核比二選一更穩）。

## 驗證

- `git diff --cached --check` 通過（無 trailing whitespace）。
- GitNexus `detect_changes({scope:"compare", base_ref:"main"})` → `risk_level: low`, `affected_count: 0`；僅 `AGENTS.md`/`CLAUDE.md` 內自動維護的 `GitNexus — Code Intelligence` Section 節點顯示 `touched`（索引自身的行號位移雜訊，經 `git diff main -- CLAUDE.md` 確認實際無差異，非本次編輯內容）。
- 無程式碼行為變更，不需要 pytest / npm test。

## Impact

純文件敘述變更，無程式碼 symbol 受影響，blast radius：NONE。

## 已知限制

- 這條規則目前仍是「MUST 人工核對」的敘述性要求，沒有自動化腳本強制檢查兩圖譜結果是否一致；如果未來想更嚴格，可以考慮寫一支對照 script 在 CI 或 pre-commit 跑,但目前判斷純文件提醒已足夠涵蓋一般互動 session 的落差,暫不做額外自動化。
- `codebase-memory-mcp` 這個同名符號誤併的根因（是否為全域名稱解析、未依 lexical scope 消歧）未深入除錯,本次只記錄現象與具體案例,不改動 `codebase-memory-mcp` 本身（非本 repo 擁有的外部工具）。
