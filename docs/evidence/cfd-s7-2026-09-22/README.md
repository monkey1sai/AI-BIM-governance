# CFD P2 S7 — 181 真站「風環境面板以模型為主體」操作證據（2026-09-22）

契約：`docs/plans/building-energy-cfd-p2-contract.md` S7 列（PR #900，181 部署 `bbb9d76`，deploy tag `deploy-20260922-…-002`）。

## 步驟（真 Chrome，Playwright library API，無 review session）

1. 開 `/ui/#a1`，**不選任何審查 session**，直接展開 3D 工作區的「風環境」。
   - 面板顯示「沒有 review session：可瀏覽與送出風場計算；「顯示疊圖」需要先啟動 3D session。」；模型選擇器可用（disabled=false），列出 21 個 ready 模型（選項文字含專案顯示名稱，截圖已遮罩）。→ `01-no-session-model-picker.png`
2. 在選擇器挑 S4 那筆 16 向 run 所屬的模型（`stream_conv_20260917052406_5e76768a`）。
   - 計算紀錄列出 `cfd_20260922T082409Z_7ad3e4`，狀態 `ready`，16 向結果表與圖例照常顯示；「送出風場計算」可按（submit_enabled=true）；「顯示疊圖」disabled，title＝「顯示疊圖需要 review session 與 3D 畫面」。→ `02-no-session-run-ready-overlay-gated.png`
   - 此 run 由 API 於 S7 之前送出，ledger 無 `origin`，面板不顯示來源 session（如實）。
3. 展開「所有模型的風場計算」：列出 ledger 最近 7 筆（1 筆 `完成 16/16`、6 筆 owner 取消的 queued run），排隊欄皆 `—`（無 queued）。→ `03-all-models-overview.png`

DOM 事實見 `s7-ui-evidence.json`（run id、conversion job id、按鈕狀態、總覽列）。截圖裁掉右側審查面板、遮罩模型名稱；主機以 `<canonical-host>` 取代。

## 結論

關掉／不開 3D session 時，既有 run 仍可從模型選擇器找回並瀏覽結果；疊圖維持需要 session 的閘門。S6 A1 finding 按鈕在本次截圖時尚未部署（#901 未合併），`finding_button_present=false` 屬預期。

## 未做

- 無 session 送出新 run 的真站操作（會佔 181 求解 worker，等 owner 指定參數再做）。
- 排隊位置顯示：181 目前無 queued run，`queue_position` 只在單元／route 測試驗過。
