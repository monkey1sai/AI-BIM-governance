# Tasks — minio-watch-key-structure

對應 plan `docs/superpowers/plans/2026-06-22-minio-watch-key-structure.md`（含 ultracode 審查修訂段）。

- [x] 1. `deriveIntakeFromKey` 改 ≥3 段規則（第一段=專案、倒數二=種類、末=版本、中間動態層忽略、拒收空段與純點段 `.`/`..`）+ `DeriveOk` 加 `projectDisplayName`/`category`；`project_id` 重用 `sanitizeArtifactIdPart`。整檔覆寫 `minio-watcher-derive.test.ts`（含中文→`mv_<hash8>`、同名確定性、英數原樣、路徑穿越拒收）。
- [x] 2. intake payload 帶 `model_category`/`project_display_name`；`ifcReadyPayloadSchema` + `ExternalIfcReadyEvent` 加兩個 optional 欄位（`.passthrough()` 相容），並作為非權威 display hints 落 coordinator local shadow store，不成為 project/model metadata authority。
- [x] 3. 測試 fixture 遷移多層：`minio-watcher-loop`（所有 2 段 key→3 段、翻轉 4 段 malformed fixture 為真正 <3 段、body 斷言新欄位）、`minio-watch-intake-integration`（baseline/push 多層）、`web-viewer-sample/e2e/minio-watch-auto-intake`（baseline/auto 多層 + 註解）。
- [x] 4. 全量回歸：`bim-review-coordinator` `npm run build` 乾淨 + `npm test` 431/431 綠。
- [ ] 5. P7 部署區 browser E2E：重建測試部署後，對真 `bim-control` 上傳一個唯一命名的多層新 key，觀察 watcher 觸發、自動建立 job，並在現行 `#/pipeline` 模型資料與轉檔生產線完整顯示原始 key、專案原名與種類；截圖及不含機密值的 API 摘要落 `docs/evidence/minio-watch-auto-intake/`。不以 fake S3、skipped test、舊 `#/conv` 或 legacy `#/minio` 截圖代替。
