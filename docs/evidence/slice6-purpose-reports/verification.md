# 第六刀用途報表驗證紀錄

日期：2026-09-12。Baseline：`e423eee7f6d096f3c00aedddee31506ffcaa0dad`（第五刀 PR #824 已合併）。
本紀錄保留初次 synthetic contract 驗證，末段補記 owner 後續授權的主管本機預覽。
兩者均不代表正式 SSO／來源 ACL、Kit 或完整設計基準驗收。

## 來源與驗證用途

使用第五刀留下的許良宇圖書館 immutable ledger，驗證歷史資料不被重算、三種輸出指向同一份保存紀錄、
中文字與完整構件資料可下載，以及失敗／取消後可重試。

- IFC：`東勢區許良宇紀念圖書館_root_建築_24e598ab-be3d-4dbb-a1aa-60b0ba610618.ifc`。
- IFC SHA256：`8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce`。
- readyModelId：`mw_library_validation`；modelVersionId：`24e598ab-be3d-4dbb-a1aa-60b0ba610618`。
- recordId：`validation_5b88d0db0366f3b7519d94a62971b7abb4a9d5074cf39413d94b868cfd35a2dd`。
- 原 ledger SHA256：`c7783c229768b02c6ce3db4eb7cd33840f5069fb40274a9aac1241bd89ba50fe`，驗證前後相等。
- 期望可渲染 6816、已映射 6770、缺失 46、排除 1181。view／locate／distance 是 `not_usable`，IFC rules 是 `not_validated`。

這是隔離測試 tenant/project，沒有正式 MinIO enrollment、來源 ACL 或操作者身份授權。沒有重新啟動轉換、Kit 或修改 ledger。

## 真 HTTP 與檔案解析

使用本 worktree build 的 `createCoordinatorApp`，綁定 loopback，讀取真實 ledger 副本。
`validationReportAccess` 由 fixture 注入明確標示 synthetic 的 operator 決策；所有服務狀態檔另放 fixture root。
fixture kind=`report_contract_fixture`，`productionAuthorizationVerified=false`，不是 `isolated_branch_stack`。

實際 GET JSON／CSV／PDF，獨立 CSV parser 及 PDF.js 解析結果：

| 項目 | 觀察 |
|---|---|
| PDF | 328 頁、677143 bytes、產生與下載約 19.7 秒 |
| PDF 附件 | `validation-record.json` 等於 HTTP JSON |
| CSV | RFC4180 解碼後各欄位等於 HTTP JSON |
| 構件 | 6770 映射、46 缺失、1181 排除 GUID 全數出現在 PDF 文字 |
| PDF SHA256 | `696c4315f2a0a8ab5568f7eb486643c9f115cee0d15c2653d703b04b1789ce5b` |
| CSV SHA256 | `bc3c3ec335a0f031827cf3c7cd809f508ca3a0671b4e1717b2cd3495917bd9cd` |

本機證據 root：`C:\Users\IOT\.codex\visualizations\2026\09\11\01a09022-90ea-7c22-9493-69ff3d325012`。
完整輸出在 `slice6-library-http-attempt02/{evidence.json,library-report.json,library-report.csv,library-report.pdf}`。
重現 driver 是該 root 的 `slice6-library-report-check.mjs`，參數依序為 worktree、第五刀 ledger 目錄、新輸出目錄、fixture API base。
不把 IFC、USDC 或完整 PDF 放入 Git。

## Codex App in-app browser

`/ui/#purpose-reports` 使用真 Coordinator HTTP。操作模型／歷史 selector、展開來源與構件摘要、下載 CSV／PDF、取消 PDF、重試 PDF。
歷史兩筆同時間紀錄各有序號；另一筆保存紀錄顯示四用途 `not_validated`，不套用目前 policy。
取消後顯示「已取消下載。」；重試完成顯示「已交給瀏覽器下載」。此文字不宣稱檔案已存到使用者磁碟。

- 1440×900 及 1920×1080：兩欄卡片、長中文檔名換行、內容沒有水平溢出。
- final screenshots：`report-1440-final.png`、`report-1920-final.png`。
- 不提供 access adapter 的獨立 fixture：真 HTTP 503，畫面顯示來源授權無法使用；「重試模型清單」後仍安全拒絕，見 `report-unconfigured.png`。
- 兩個已使用 fixture process 都已關閉；browser viewport override 已 reset。

## 檢查與限制

- Coordinator full suite：120 files／2081 tests；Viewer full suite：116 files／1634 tests，當輪通過。
- 最後 DTO／UI 調整後 targeted：Coordinator 38 tests、Viewer 29 tests；Coordinator build、Viewer typecheck/build、affected ESLint 通過。
- 全 Viewer lint 因既有 warnings 與 `--max-warnings 0` 失敗；未擴大修改無關檔案。
- 既有 design reference validator 通過 13 screens／26 golden files；本 route 無 approved pixel reference，`full=no`。
- 正式 SSO／來源 authority wire contract 與 deployment adapter 尚缺。預設所有報表 API 503；此 Draft 不可當成正式授權已完成。
- PDF 60 秒為合作式 deadline，不是同步字型作業的硬中斷。字型固定路徑、單一 renderer、頁數／bytes／input 限制均有 regression tests。
- 沒有部署、正式 isolated branch stack、Kit first frame／Stage／DataChannel／ACK 證據；本刀不宣稱真 3D 驗收。

PR preflight／遠端 CI／exact-head review 以後續 PR 的當輪結果為準，不由此文件推論通過。

## Owner 授權後：主管預設權限驗證

2026-09-12 12:45–12:51 UTC，owner 接受暫行主管權限，正式身份／來源 ACL 介接延期。
本輪使用新 `localSupervisorReportAccess` 實作及 app 啟動接線，沒有注入 synthetic grant。
權限固定許良宇來源五元組、唯讀、預設關閉、僅 non-production loopback；詳 API 契約。

- 啟用程序 `run_20260912_124553_2b45d6`，loopback `64953`，fixture kind 仍為
  `report_contract_fixture`，`accessMode=local-supervisor-preview`，正式身份驗證 false。
- 由真 HTTP 重新下載上述同一 record：PDF 328 頁／677143 bytes／19.89 秒；
  全部 6770／46／1181 GUID、CSV 解碼及 PDF JSON 附件相等。輸出與 ledger SHA256 均與上表相同。
  證據在本機 root 的 `slice6-supervisor-exports-01/evidence.json`。
- Codex App in-app browser 選模型／歷史，觀察「主管預設驗證權限 · 僅本機」、
  固定版本與「未驗證公司登入身份」，CSV／PDF 均顯示已交給瀏覽器下載。
  1440×900、1920×1080 main scrollWidth 沒有超過 clientWidth。
- `report-supervisor-1440.png`、`report-supervisor-1920.png` 是本輪新畫面；
  語意快照在本機 `slice6-supervisor-preview-01/browser-dom.txt`。
- 停止預覽程序後，確認原 port 無 listener，再於同一網址以 false 重啟：
  `run_20260912_125013_120abd`。原頁 reload 與「重試模型清單」都顯示授權服務無法使用，
  無模型清單與主管提示，見 `report-supervisor-disabled.png`。驗證後程序已停止、viewport 已 reset。
- 新權限測試 30 項通過，包含真 HTTP listener、production／wildcard／remote socket、
  DNS rebinding Host、跨站／重複 Origin、proxy headers、fetch metadata、HEAD、
  default-off、formal adapter 混用拒絕與 formal port 拒絕 preview actor。
  合併原報表／PDF／config tests 共 105 項；Viewer 報表 31 項，build／typecheck／affected lint 通過。
- GitNexus 1.6.9 本 worktree reindex 失敗 `Failed calling LOWER: Invalid UTF-8`；
  index 仍 stale，保持 UNKNOWN。獨立安全 reviewer 先授予限定 unavailable-gate sign-off，
  再審具體 source/diff/tests，未發現未解 P1/P2，接受此 HIGH 本機權限邊界交付人類審查。
  此 review 不代替 counted human approval。

本次驗證用途是證明暫行讀取權限、固定來源隔離、停用拒絕與保存報表一致性。
本機程序／同源 XSS 可讀此固定來源的限制已揭露；正式 SSO、LAN、正式租戶及新頁 approved
reference 仍為後续範圍，設計 `full=no`。合併以新 HEAD required checks 與合格人類審核為準。
