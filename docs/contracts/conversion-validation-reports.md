# 用途驗證報表 API 與投影

第六刀承接 `conversion-validation-record/v1`。GET 只讀 immutable ledger snapshot，
不以目前 policy 重算歷史用途、不觸發轉換、Session 或 Kit。

## HTTP

| Endpoint | 結果 |
|---|---|
| `GET /api/conversion/validation-models?offset=0&limit=100` | 授權來源的模型清單 `{items,total,nextOffset}` |
| `GET /api/conversion/records/:readyModelId/validations?offset=0&limit=50` | 授權歷史紀錄，由驗證時間降序排列 |
| `GET /api/conversion/records/:readyModelId/validations/:recordId?format=json` | 同一 snapshot 的 JSON、`csv` 或 `pdf` |

`readyModelId` 是 URL-encoded opaque identity，含 Unicode、冒號或斜線時仍按完整值比對，
不拿它拼接檔案路徑。record ID 採原有 safe-ID。拒絕重複／未知 query、負 offset 與超過 100 的 limit。
JSON/PDF/CSV 共同回 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`。
PDF/CSV 固定安全 record filename，不使用來源檔名作 HTTP header。

## 權限邊界

`CoordinatorAppOptions.validationReportAccess` 是 server-owned deployment port，
不是 SSO wire protocol，也不是可以由 HTTP 請求設定的權限表。
adapter 必須先驗證真實 operator，向來源 authority 取得當次請求的讀取決策，
綁定 method/path/format/record selector，並回傳目前有效的來源範圍。
內部結果含 `subject`、`actorKind=operator`、`expiresAt` 及最多 1000 筆
`tenantId/projectId/modelVersionId/readyModelId/sourceSha256`。五個來源欄位逐字匹配。
原始 credential 不進入 record、報表、log 或回覆。

未提供 adapter 時所有報表 API 回 503；拒絕或過期決策回 403，authority timeout 為 5 秒。
空來源決策可讀空清單。既有但越權與不存在的 detail 均回 404。
先授權再碰 ledger，清單過濾後才計算 total/pagination；PDF 完成後重查決策是否過期。
不接受 local-dev、viewer lease、internal service token、自述角色或測試 carrier 作正式 grant。

目前 factory 仍只有 `local-dev/pending_oq5`，lineage deployment adapter 也未配置。
**正式身份／來源 authority 的 wire contract 與 deployment adapter 尚待外部介面確認。**
本刀提供的 test DI 只能驗證契約與拒絕行為，不能證明正式操作者可存取。

## 三格式一致性

JSON 使用顯式欄位投影：source/hash、模型／作業／驗證版本、時間、inventory、完整 GUID→prim paths、
保存的 purposes/checks/evaluations。另以白名單顯示 class 分母、單位、世界邊界比對與核准範圍摘要。
省略 producer 的重複 raw evidence、expectedElements 與完整 approvedScopes requiredGuids，
它們仍原封保存在 ledger。來源名稱只顯示 basename；可顯示文字有防止內部 URL／host path／credential 洩漏的檢查。

CSV 是含 UTF-8 BOM 的 RFC4180 long-form：`record_id,section,item_id,field,value`，
value 是 JSON scalar/object/array，保留 null、數字與巢狀資料；cell 防公式注入。
PDF 第一頁顯示四用途結論、版本／時間、構件數；附頁保留完整構件資料，
內嵌 `validation-record.json` 與線上 JSON／解碼後 CSV 相等。
固定附帶 Noto Sans CJK TC 字型；不從 caller path 或網路載入字型。缺 glyph 時拒絕，避免漏字。

Renderer 同時一份；上限 800 萬字元單位、20 萬 nodes、600 頁、16 MiB，
60 秒合作式時間檢查並定期讓出 event loop；不是可強制終止同步字型作業的 hard deadline。
中止連線／取消下載於下一個檢查點停止產生，不發送半份 PDF。
超限／忙碌／缺字型回固定 503，UI 保留報表供重試。

## UI

`/ui/#purpose-reports`；模型流程 `#pipeline` 的「用途驗證報表」連結。
使用授權模型目錄，支援更多模型／更多歷史、loading/empty/denied/error/retry、
展開構件明細、下載 PDF/CSV 與取消。切換來源或紀錄後丟棄遲到回覆；
下載成功只表示交給瀏覽器，不聲稱已存入使用者磁碟。

新 route 沒有 approved pixel reference，設計完成度為 `reference_missing`、full=no。
既有 canonical design manifest／baseline 保留；API/browser 語意證據不替代像素驗收。
