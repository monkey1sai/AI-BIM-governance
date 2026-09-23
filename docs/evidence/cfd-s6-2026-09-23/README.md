# CFD P2 S6 A1 finding — 181 真站操作證據（2026-09-23）

契約：`docs/plans/building-energy-cfd-p2-contract.md` S6 A1 finding 列（PR #901）。181 部署 `f2905ba`（deploy tag `deploy-20260923-…-001`）。

## 步驟（真 Chrome，Playwright library API）

1. `/ui/#a1` → 進階 → 選既有審查 session（S4 用的同一個，primary binding 帶 `model_version_id`）→ 展開「風環境」→ 選 S4 的 16 向 run `cfd_20260922T082409Z_7ad3e4`（`ready`）。
2. 門檻填 `4.4` m/s → 按「超標方向轉 A1 issue」。
   - coordinator 回 **201**，`created_count` 2；16 向中 135°（4.48 m/s）與 157.5°（4.42 m/s）超標，其餘 14 向 `below_threshold`。
   - 面板：「新開 2 筆 issue；超標 2／16 向；門檻 4.4 m/s（screening）」，ledger findings 清單兩列。→ `01-findings-opened.png`
3. 同門檻再按一次：回 **200**，`created_count` 0，兩向 `idempotent_replay: true`（`s6-ui-evidence.json` 的 `finding_calls` 縮寫為 `replay`）、issue id 不變。→ `02-findings-replay.png`
4. 讀回：`GET /api/cfd/runs/{run}` 的 `ledger.findings` 兩筆（annotation、medium、`validation_level: screening`、`opened_by: coordinator-browser`）；coordinator proxy `GET /api/governance/issues?kind=annotation` 由 0 筆變 2 筆（`governance-counts.json`：governance 列表無分頁，annotation 回應為完整清單，只有本 run 的兩筆；0 是第一次按之前同一查詢的結果），兩筆 `usd_prim_path` 為本 run 的行人面 prim、`ifc_guid` 為 null。
5. Issues／BCF 頁：按「載入 issues」後表格列出這兩筆（`s6-issues-tab.json`，只保留 CFD 列）。

`governance-annotation-135deg.json` 是其中一筆的完整 governance 記錄：description 逐行寫 `validation_level=screening`、`purpose=design_comparison_only`、「不是法規或認證依據」、run／conversion id、風向（相對 project north；真北未知）、峰值與門檻、洩漏率、assumptions、limitations、疊圖 prim。此 run 在 S7 之前送出、ledger 無 `origin`，所以沒有「送出參數」那行（如實）。

## 隱私

截圖裁掉右側審查面板並遮罩模型選擇器；`model_version_id` 以 `<model_version_id>` 取代；Issues／BCF 頁其他 rule-run issue（`governance-counts.json`：`kind=issue` 142 筆）帶真實 IFC GlobalId，未入檔也未截圖。

## 觀察（非本 PR 範圍）

- Issues／BCF 頁不會自動載入既有 issue，要按「載入 issues」；且只顯示前 30 筆。CFD annotation 目前因為最新而在前 30 筆內。
- `opened_by` 為 `coordinator-browser`：本次呼叫沒有帶使用者身分，走固定主體（與 run 建立的 `requested_by_principal` 同規則）。
- result 的 limitations 仍含 streaming 固定句「Coarse proof-of-concept mesh; no grid-convergence study.」，比 S5b／S6 前置的實際結論保守。

## 未做

- 並發請求與 governance 逾時／部分失敗的真站重現（只在 coordinator route 測試）。
- 本次開的兩筆 annotation 保留在 181 governance（status open），未 transition 或刪除。
