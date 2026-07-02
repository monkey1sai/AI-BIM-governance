# Spec: minio-watcher-loop 測試 timing flake 修復（triggered_total 競態）

## 背景與需求來源

`bim-review-coordinator/tests/minio-watcher-loop.test.ts` 的「第二輪新增物件 → 觸發一筆 intake」測試間歇性紅燈，多次打斷不相關 PR 的 pr-review-agent verify（同 commit rerun 即綠，flake 實錘）。2026-07-02 治理審計把本修復列為遺留事項，使用者拍板執行；依既定紀律走正式 spec、獨立 PR，不夾帶其他變更。

## 問題陳述（根因）

競態時序：

1. watcher 對 intake stub 發出 `POST`；stub 的 request handler 一收到 body 就 `received.push(...)` —— 此刻測試的 `waitFor(() => received.length === 1)` 已滿足，測試繼續往下跑。
2. 但 `triggered_total` 是 watcher **收到 HTTP 回應並解析成功後**才 `+1`（`src/services/minioWatcher.ts` triggerIntake 成功路徑），回應此時可能還在路上。
3. 測試緊接著同步斷言 `expect(watcher.getStatus().triggered_total).toBe(1)` → 偶爾讀到 0 → 間歇紅。

旁證：緊鄰的「同物件後續輪不再觸發」測試多睡了 300ms 才斷言同一計數器，從未 flake。

## 變更範圍（最小 diff）

- 僅改 `bim-review-coordinator/tests/minio-watcher-loop.test.ts` 一處：把該測試對 `triggered_total` 的同步斷言改為既有 `waitFor` helper 輪詢（`await waitFor(() => watcher!.getStatus().triggered_total === 1)`），並附一行競態說明註解。
- 不改 `src/services/minioWatcher.ts` 任何產品行為：計數語意（成功觸發才 +1、與 error 狀態一致）是既審規約，本次不動。
- 不動其他測試案例。

## 成功標準

- 修改後該測試檔連續多次全綠（本地至少 5 連跑）。
- `npm run verify`（= build + 全測試）通過。
- 斷言強度不降：仍驗證 `triggered_total` 最終恰為 1（waitFor 失敗即測試失敗）。

## 已知風險

- waitFor 上限 3s，理論上極端慢機器仍可能逾時，但視窗遠大於原本 0ms，風險由「常態競態」降為「異常環境」。
