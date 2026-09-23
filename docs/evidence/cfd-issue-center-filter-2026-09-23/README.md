# Issue Center 篩選 — 181 真資料瀏覽器驗證（2026-09-23，合併前）

對應程式：`web-viewer-sample/src/console/pages.tsx`（`IssuesRuleCenterPage`）與 `web-viewer-sample/src/console/issueFilter.ts`。

## 為什麼改

S6 A1 finding 把 CFD 超門檻風向開成 governance annotation（不綁 ifc_guid）。181 上這兩筆和 142 筆 rule-run issue 放在一起；Issue Center 原本要先按「載入 issues」才列出任何東西，而且只顯示前 30 筆，annotation 一多就會被擠出畫面。

## 驗證方式（`tools/issues_filter_verify.mjs`）

- 本分支 `npm run build:ui`（比照部署，`VITE_COORDINATOR_API_BASE` 設為 coordinator 對外 URL）。
- 真 Chrome 開 181 的 `/ui/#issues`；`/ui/` 下的文件與靜態檔由 Playwright routing 改以本分支建置結果回應（3 個檔），API 仍打 181 coordinator（真資料、只有 GET）。
- 因為文件由 Playwright 回應，Chrome 無法把頁面歸在內網位址空間，會以 Private Network Access 規則擋掉頁面對內網 coordinator 的同源 API 呼叫；**這次驗證的 Chrome 關掉 PNA 檢查**。部署版頁面直接由內網 coordinator 提供，不受影響。

## 結果（`issues-filter-verify.json`）

| 步驟 | 畫面 |
|---|---|
| 進頁（不按任何按鈕） | 自動 `GET /api/governance/issues` 一次，回 200；「顯示 30／符合 144／共 144 筆」，前 30 列中有 2 列是 CFD（governance 依建立時間新到舊，這兩筆最新） |
| 篩選「CFD 風環境」 | 「顯示 2／符合 2／共 144 筆」，兩列皆 `annotation`：157.5°（4.42 m/s）、135°（4.48 m/s）→ `issue-center-cfd-filter.png` |
| 篩選「正式 issue」 | 「顯示 30／符合 142／共 144 筆」 |
| 篩選「標註」 | 「顯示 2／符合 2／共 144 筆」 |

截圖只截 Issue Center 面板、且只在 CFD 篩選下截，避免拍到帶真實 IFC GlobalId 的 rule-run 列。

## 未做

- 部署後的真站再驗（合併部署後同一腳本不需 routing 即可重跑）。
- 面板本身欄寬很窄，表格最右的 resolve 按鈕被裁切，為既有版面，本次未動。
