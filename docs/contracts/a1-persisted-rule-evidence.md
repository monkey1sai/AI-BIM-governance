# A1 規則證據與持久化一致性

文件性質：contract。第七刀後端基礎契約；實作與可執行測試為現況證據。
來源：核准逐刀計畫第七刀、設計文件 §04 rule-runs／§07 A1 閉環。

## 規則內容識別

- `RuleRunResult.rule_content_digest` 為 optional string，隨 summary 保存。
- DSL 使用 `dsl-json-v1:sha256:<hex>`：完整 JSON 可表達定義，字典 key 排序、
  緊湊編碼、UTF-8、不允許 NaN。執行相同的深層快照；呼叫者後續修改原 dict 不改結果。
- IDS 使用 `ids-xml-v1:sha256:<hex>`：僅對原生 `ifctester.ids.Ids` 序列化、
  重新解析後執行快照，對重新序列化的 XML 建立識別。保留 clone 前的原物件。
- 無法快照、自訂物件或舊紀錄：digest 為 `None`／缺值，不由 label 或 version 捏造。
- digest 表示此 profile 下的完整執行定義；不是原始檔案雜湊、語意等價證明、
  runner 版本、來源身份或授權。相同 label/version 但內容不同不可視作相同規則。

## Rule-run 保存

- `queued → running`；`queued|running → succeeded|failed`。
- 第一個**成功提交的終態**勝出。已 succeeded/failed 的 run 不被 mark_running、
  complete_run 或 fail_run 覆寫；不存在的 run 不建立 orphan results。
- succeeded 狀態、summary 與完整 result batch 在同一 SQLite transaction 提交。
  任何 result insert 失敗都 rollback；不得發布尚未保存的 computation。
- 仍允許多個 worker 重複計算；本契約處理終態保存，不提供 worker lease 或排程。
- 所有實際 result（pass/fail/error）保留原 result ID、GUID、rule_code、evidence。
  `GET /api/rule-runs/{id}/results?status=passed` 回查明確 pass，不能用「沒有 fail」
  或 score=100 代替構件及規則的明確 PASS。

## Persisted Excel

- `GET /api/rule-runs/{id}/export?fmt=excel` 僅由 DB succeeded record 重建。
  記憶體 cache 不再發布或提供匯出權威。不存在 404；未成功完成 409。
- 新結果保存 `ifc_type`、`ifc_name`；舊結果沒有欄位值時留白。
- 重建同時保留 rule_content_digest；Excel 維持既有 Failed Elements／Summary 欄位，
  digest 由 run summary API 取得。
- 所有文字欄位在 XLSX 明確寫成字串；即使以 `=` 開頭也不形成公式。數值保持數值。

## Issue revision 與 API 相容性

- `issues.revision` 是非負 integer，新建及舊資料 migration 後初值 0。
- 每次成功 transition 在同交易更新 status、revision+1 並寫 audit event；
  不合法 transition、過期 revision 或 audit insert 失敗都不遞增。
- `POST /api/issues/{id}/transition` 可選 `expected_revision`。
  strict integer ≥0；bool、字串、負數、小數回 422；revision 過期維持既有
  TransitionError 的 400 回應。無該欄位或 null 保留舊 caller 行為。
- Issue 回應新增 revision。現有 manual／rule_result／diff_item 的 resolution/reopen
  行為維持相容；本刀沒有新增整改確認／歷史／授權入口，也不宣稱既有 resolved
  狀態代表經過修正版重檢。第八刀接入可信 evidence 與人工確認後再收緊該流程。
- 來源 GUID、model_version_id、source_type、source_ref 不因 transition 改寫；
  既有 A4 隱藏與權限邊界保持。

## Migration、部署與回滾

- 啟動時 additive migration：rule_results 新增 nullable ifc_type/ifc_name；
  issues 新增 `revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)`。
  先取得 SQLite write lock，再查欄位及新增，重複初始化保持相容。
- 不刪表／欄位、重算舊 evidence 或回填虛構 identity，不新增依賴、env、port、
  Webhook 或排程。使用同一 GOV_DB_PATH；測試只接獨立 temporary DB。
- 部署須停止使用同一 DB 的舊 writer 後再切換版本。舊程式不遵守終態／revision
  保護，不能將 schema 向後相容理解為新舊 writer 混用安全。
- 回滾可 revert 此 PR，保留 DB 與新增欄位，禁止以 drop column/table 回滾。
  舊 binary 可讀寫 additive schema，但回滾期間不再具备新終態／revision 防護。

## 驗證來源

- `governance-service/tests/test_rule_content_identity.py`：真 ifcopenshell／ifctester、
  key order、定義變更、快照不受 caller mutation、IDS reuse／restriction／optional。
- `test_rule_run_terminal_integrity.py`：SQLite 終態競爭、rollback、restart、orphan。
- `test_export_persisted_authority.py`：真 FastAPI／SQLite／XLSX、legacy migration、
  stale cache、保存失敗、明確 PASS、digest、文字公式。
- `test_issue_revision.py`：legacy/concurrent migration、audit rollback、
  並行 revision、API strict validation、既有 resolution/reopen caller。
- 既有 `tests/contracts` 無本次 optional payload 的獨立 schema；以上 API tests
  驗證 additive 相容性。未變更 Coordinator proxy、Viewer、Kit 或 conversion API。
