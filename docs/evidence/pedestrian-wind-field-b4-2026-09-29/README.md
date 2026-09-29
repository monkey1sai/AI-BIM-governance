# Pedestrian Wind Field bullet 4 — 181 真站操作證據（2026-09-29）

- **ADR：** `docs/architecture/pedestrian-wind-field-adr.md` §5 bullet 4（#972；bullet 1–3 = #973／#974／#975）。
- **受測部署：** canonical Linux 主機跑 `38a9151`（deploy tag `deploy-20260929-…-006`，由 `scripts/dev/rebuild-test-deploy.ps1 -Build` 從 freshly fetched `origin/main` 部署；三道 CFD run guard 均為「no CFD run in progress」）。
- **操作方式：** 依規則只用 Claude in Chrome MCP 操作 owner 的 Chrome，逐步截圖放在對話中；API 事實以頁面內 `fetch` 讀回。本目錄沒有 PNG（Chrome MCP 截圖不落地）；DOM 與 API 事實在 `b4-run-evidence.json`。
- **遮罩：** 主機寫 `<canonical-host>`；`model_version_id` 與 session id 以佔位取代；不寫專案顯示名稱。

## 步驟與結果

1. **3D session：** `/ui#a1` → 選模型 → 「開啟所選審查」選 MinIO 自動建立的審查（primary binding 帶 `model_version_id`）→ 「啟動 A1 3D Session」→ 收到第一幀（「已收到畫面，載入模型與審查相符」）。
2. **送出 run：** 風環境面板 → 預設組「快速預覽」→ 只勾 0° → 估算「1 向、約 1.70 M 格、約 15 分鐘」→ 送出。run `cfd_20260929T103308Z_504a43`（fast_preview、origin 帶 session）：10:33:08Z 送出、10:33:33Z 進入 solving、10:50:51Z 觀察到 ready（482 步收斂、1.69 M 格）。
3. **圖例與統計（bullet 1／3）：** result 的 direction 帶 `legend`（U 0–5 m/s；p −21.46…13.16 m²/s² kinematic_pressure）與 `U_mean 1.85`／`U_p95 2.06`；面板顯示「圖例來自 0° 疊圖層」、兩條色階、方向列「均 1.85 · p95 2.06 m/s」。同一面板上，部署前完成的舊 run 顯示「此 result 未附疊圖圖例…」（如實，不再用常數）。
4. **超標區塊（bullet 1／2／3）：** 門檻 3.4 → 「查超標區塊」→ coordinator 透傳 `cfd-exceedance/v1`：面積加權統計、4 個區塊（峰值 3.84／3.70／3.65／3.54 m/s，面積 36.3／15.4／33.8／43.9 m²），每區 3 個歸屬構件，開放地面 0。
5. **Finding：** 「超標方向轉 A1 issue」→ **201**，「新開 5 筆 issue；超標 1／1 向；歸屬構件 5 個」，逐向結果列出 5 個構件各自的 issue id；再按一次 → **200**，`created_count` 0，每列 `已存在`。ledger `findings` 5 筆均 `issue_kind: issue`、帶 `ifc_guid`／`ifc_type`／`directions: [0]`／`zone_area_m2`。
6. **Governance：** `GET /api/governance/issues?kind=issue&model_version_id=…` 列出這 5 筆（open、medium、`ifc_guid` 對應、`usd_prim_path` 為本 run 的行人面 prim、description 逐行含歸屬規則、逐風向區塊、validation_level、purpose、run／conversion id、opened_by、送出參數）。
7. **Issues／BCF 頁：** Issue Center 表格最前 5 列即為本次 issue（kind issue · medium · open · guid · 標題）。
8. **BCF 匯出：** `GET /api/governance/bcf/export?model_version_id=…` 回 9,775 bytes 的 bcfzip，10 個 `markup.bcf`，其中 5 個 topic 的 `<Title>`／`<Comment>` 含本 run 的 5 個 guid（TopicType Issue、TopicStatus Open、Priority medium）。在頁面內以 `DecompressionStream` 解壓驗證，未下載檔案。

## 真站才看得到的三個問題（VERIFIED）

1. **歸屬全是 `IfcSlab`、距離 0.00 m。** 行人面在 1.5 m，樓板／地坪的 z 範圍與行人帶 [地面, +3 m] 相交，且區塊落在樓板 footprint 內，XY 距離為 0，於是每個區塊的 3 個名額都被樓板佔滿，牆、門、柱等垂直構件永遠排不進來。ADR 的幾何規則在這個模型上不產生有審查意義的歸屬——需要 owner 裁決規則調整（見 PR 後續建議）。
2. **標題「N 個風向」計數錯誤。** `cfdElementFindingIssuePayload` 用 zone hit 數當風向數：同一風向的兩個區塊寫成「2 個風向」、四個區塊寫成「4 個風向」（本 run 只有 0° 一向）。description 逐風向也重複列同一風向。修正：以 distinct direction 計數並依風向合併區塊行。
3. **CFD issue 無法 3D highlight。** A1 的「載入既有規則問題」只收 `source_type === "rule_result"` 的 issue；本次 issue 的 `source_type` 為 `manual`，「在模型中顯示問題」保持 disabled；Issue Center 列只有狀態 transition。ADR bullet 4 預期的「3D highlight 落在構件」在現行產品沒有入口。

## 未做

- 沒有下載 BCF 檔到磁碟（規則：下載需明確授權；改在頁面內解壓驗證）。
- 本次開的 5 筆 issue 保留在 181 governance（open），未 transition 或刪除。
- 多風向聚合（同一構件跨風向一張 issue）只在 coordinator 測試驗證；本 run 單向。
