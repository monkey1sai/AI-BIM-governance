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

未提供 adapter 且未明確啟用下述本機預覽時，所有報表 API 回 503；拒絕或過期決策回 403，authority timeout 為 5 秒。
空來源決策可讀空清單。既有但越權與不存在的 detail 均回 404。
先授權再碰 ledger，清單過濾後才計算 total/pagination；PDF 完成後重查決策是否過期。
不接受 local-dev、viewer lease、internal service token、自述角色或測試 carrier 作正式 grant。

### 主管預設驗證權限（暫行）

2026-09-12 owner 授權以主管預設權限完成第六刀本機驗證，正式 SSO／來源 ACL 介接延期。
實際 `index.ts → createCoordinatorApp` 由 `VALIDATION_REPORT_SUPERVISOR_PREVIEW=true`
啟用；預設 `false`，只接受精確的 `true/false`。不是請求參數，也不是全域 user auth role。

| 項目 | 暫行政策 |
|---|---|
| principal | `local_supervisor_preview`，表示本機程序存取能力，未驗證真人主管或公司登入身份 |
| 允許操作 | GET 授權模型清單、保存的歷史紀錄、JSON、CSV、PDF |
| 固定來源 | tenant=`tenant_library_validation`；project=`project_library_validation`；readyModel=`mw_library_validation` |
| 固定版本 | `24e598ab-be3d-4dbb-a1aa-60b0ba610618` |
| IFC SHA-256 | `8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce` |
| 不授權 | 其他來源、模型修改、轉換、刪除、Session／Kit 操作、權限管理 |
| 決策期限 | 每次請求最多 5 分鐘，下載回傳前仍檢查期限 |
| 撤回 | 設回 false 後重啟服務，或停止該預覽程序；沒有設定熱更新，不刪 ledger |

啟用於 `NODE_ENV=production` 或 HOST 非 `127.0.0.1/::1` 時拒絕啟動。
與正式 `validationReportAccess` 同時設定也拒絕啟動；正式 adapter 錯誤或拒絕時不 fallback。
每次 GET 另查真正 listener 綁定位址、socket 的 local/remote address 與 local port；
Host 必須唯一且為該 port 的 `127.0.0.1`、`localhost` 或 `[::1]`。
存在 Origin 時須唯一且精確同源；拒絕 null、跨站、重複 headers、Forwarded／X-Forwarded-*。
Sec-Fetch-Site 存在時僅接受 same-origin／none。允許未帶 Origin／fetch metadata 的直接本機 CLI。
不支援代理或 LAN；CORS 不作授權判斷，`X-Role`／internal token 不增加權限。

固定來源五欄全部比對，不從 ledger 掃描擴充 grant。清單多回可選欄位
`accessMode=local-supervisor-preview`，UI 據此顯示暫行範圍與身份限制；
正式 adapter 回應不新增此標籤。三格式保存 DTO 不因此改寫。
正式 adapter 預設不接受 `local_supervisor_preview` actor，只有已開啟的報表專用 composition 可接受。

同機其他使用者／程序或同源 XSS 仍可讀此固定來源，是此暫行方案的已揭露限制。
正式身份／來源 authority 的 wire contract、deployment adapter、LAN／正式租戶驗收留待後續；
本機驗證結果不宣稱正式 SSO 或 Kit／WebRTC 已完成。

本機操作：以隔離 ledger 副本設定 `CONVERSION_LEDGER_STORE_PATH`，使用上列旗標與 loopback HOST
啟動 Coordinator，並讓 `CONSOLE_DIST_DIR` 指向 Viewer `npm run build:ui` 的 dist-ui。
瀏覽同一 Coordinator origin 的 `/ui/#purpose-reports`，確認主管暫行提示、模型版本與歷史紀錄，
再下載 CSV／PDF。停用預覽並重啟後，同一路徑應顯示授權服務無法使用，不再回傳清單。

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
