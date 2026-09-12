# 第七刀 A1 持久化一致性實測

文件性質：verification evidence。日期：2026-09-12。
本紀錄為本 PR 候選程式的後端驗證；最終 commit 的重跑結果另附 PR body。

## 來源與用途

使用 owner 指定的東勢區許良宇紀念圖書館 IFC：
`東勢區許良宇紀念圖書館_root_建築_24e598ab-be3d-4dbb-a1aa-60b0ba610618.ifc`。
SHA-256：
`8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce`。
model_version_id：`24e598ab-be3d-4dbb-a1aa-60b0ba610618`。

驗證用途是確認真 IFC 規則結果保存後能可靠查詢及匯出、舊 computation 不覆寫結果，
且 Issue 維持來源綁定與 revision。使用 repo `default-governance.yaml` v1.0；
此規則集是既有檢核範例，沒有將得分當成完整合規或整改確認。

## 實際結果

| 指標 | 觀察值 |
|---|---|
| rule-run ID（初測） | rr_1c9936afcfe0 |
| 規則結果總數 | 7059 |
| PASS / FAIL / error | 6991 / 68 / 0 |
| 分數 / distinct GUID | 99.0 / 6616 |
| 門 FireRating / 構件 Name / 牆空間指派評估數 | 68 / 6616 / 375 |
| 規則定義 digest | dsl-json-v1:sha256:ba6797c91152617f8ef9f3e77ce425d9c7f0bd683abc857805cb2411c96c49af |
| failed results → Issue | 68；model_version_id 綁定正確 |
| Issue transition | expected_revision=0 成功，revision=1；再次以 0 請求回 400 |
| 持久化終態 | 遲到 complete/fail/mark_running 均不改 summary、原 result ID 或結果 |
| 重開 DB／重新載入 app | 明確 PASS 查詢及 run summary 相同 |
| Excel | Failed Elements 全 68 筆欄位與 DB 相同；重開後所有 sheet cell 相同 |
| 原始 IFC | 執行前後 SHA-256 相同 |

真實 API 透過 FastAPI TestClient 執行 POST rule-runs、GET run/results/export、
POST from-rule-run、GET issue、POST transition；不是 mock engine/store。
SQLite、ifcopenshell 與 openpyxl 均為實際實作。未提供 mapping，usd_prim_path 保持 null。

## 可執行回歸

`C:\Program Files\Python312\python.exe -m pytest governance-service/tests -q`：
345 passed、5 skipped。基準為 297 passed、5 skipped；新增 48 個案例。
跳過測試不計通過，個別原因保留在 pytest `-rs` log。

- 新增 regression：終態重複／競爭、complete/fail 競爭、result insert 失敗整筆 rollback。
- 舊 result schema 及 Issue schema 重複／並行初始化；旧欄位和來源保留。
- 明確 PASS、digest、顯示欄位的 reopen round-trip，非成功 run 拒絕 cache 匯出。
- 真 IDS restriction/optional/reuse 及 DSL caller mutation；不支持的定義無虛構 digest。
- revision 競爭、audit 故障 rollback、strict API 值與省略 revision 舊 caller。
- 實际 XLSX 重新解析，`=` 開頭來源文字保持 string、沒有 formula cell。

PR review 後同步 `web-viewer-sample/src/generated/governance-api.ts` 的
`TransitionBody.expected_revision?: number | null`。使用既有
`generate-api-types.mjs` 對 base 與本刀來源各自生成；相同 openapi-typescript 7.13.0
的唯一 base-to-head 差異就是這兩行，因此只選取該生成差異，未納入既有 A4／Kit
型別漂移。`npm run verify` 通過 typecheck、build、1636 tests 與 23 structured-log tests。

## 風險與限制

GitNexus 1.6.9 已在本 worktree/base `5439f728f29bf72736e41ea56c5b98afa7d881d8`
完成 index-only；IDS run_ids impact HIGH（run_ids_file、IDS evidence script、app._execute），
其餘主要保存、revision、匯出入口 LOW。以真 IDS tests 與獨立 migration/風險 review 補強。
本 PR 的 detect-changes 與最終 exact-head review 以 PR body 為準。

本刀是 backend foundation。未執行瀏覽器／Kit／GPU／部署驗證；沒有新增前端操作流程。
TestClient 不代表正式 HTTP 部署、公司身份授權或完整 A1 使用者閉環。
第八刀再接整改確認／歷史／trusted authorizer；本刀仍允許既有 rule-result resolution caller，
因此一般 resolved 狀態不能當成修正版 PASS 證據。不可混用新舊 writer 寫同一 DB。

本機完整 DB、XLSX 與初測 JSON 保留於本 session 的
`slice7-library-initial/` visualization artifact；IFC 和 DB／大型產物未加入 Git。
