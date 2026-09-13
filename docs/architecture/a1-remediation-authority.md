# A1 整改確認、重開與來源權限

第八刀將原始規則 Issue、修訂模型的完整 PASS、人工確認、歷史與重開串成可操作流程。Governance 保存檢核與 Issue；Coordinator 取得逐次權限並代理；Viewer 只提交操作內容。Workspace 觀看狀態不因讀取整改紀錄而切换。

## 對外與內部契約

Coordinator 提供 `/api/governance/issues/{issueId}/confirm-remediation`、`/remediation-history`、`/reopen-remediation`，分別代理至 Governance `/api/issues/{issue_id}/...` 同名尾段。POST 必須是 JSON 並帶 `X-A1-Intent: confirm` 或 `reopen`；body 不接受 actor、role 或 PASS。確認需要 `expected_revision`、`revised_model_version_id`、`revised_run_id`、`revised_result_id`、`idempotency_key`，可帶最多 4000 字的 note。重開需要 expected_revision，可帶 note。

`RemediationAccess` 是部署組裝時注入的可信介面；實作方須認證當次 operator，向外部權限權威解析指定 operation/Issue 的 tenant、project、GUID、rule、原版及修正版 model/run/source SHA，以及穩定的 correspondence_ref。現有公司 SSO/source ACL 尚未接入；未注入時回 503。機器 intake token、第六刀的主管唯讀報告 preview、browser 自報角色均不授予整改寫入。

Coordinator 以 `A1_REMEDIATION_INTERNAL_KEY` 簽署最長 20 秒的 HMAC grant，綁 operation、Issue、exact body SHA、principal 與精確 cases；Governance 最長接受 30 秒、驗證 expiry 與 body 後才進交易。key 至少 32 bytes，兩服務經 server-only 通道供裝，不能出現在 Viewer、PR 或 log。外部 adapter 的 correspondence_ref 必須代表固定來源對應，不得每次隨機產生。

## 保存與拒絕條件

每個 rule-run 對來源作暫存副本、hash 並解析同一份 bytes，將 `source_sha256` 存進首次提交的 immutable summary。Coordinator 的 tenant_id 來自 server-owned intake job。確認在 `BEGIN IMMEDIATE` 內核對雙方 persisted tenant/project/model/run/SHA、GUID、規則定義 digest、完整結果計數、原始 FAIL、修訂群組全部 PASS。原 Issue 的模型與來源不改寫。

確認表、Issue status/revision、audit 同一交易提交；寫入失敗或過期全部回滾。`UNIQUE(issue_id,idempotency_key)`、`UNIQUE(issue_id,correspondence_ref)`、`UNIQUE(issue_id,revised_run_id)` 防重複或重用證據。相同命令及相同操作者可在重新授權後回放原確認；若已重開，receipt 顯示目前 reopened，不將歷史誤報為目前 resolved。重開亦需逐次授權、revision CAS 與同交易 audit。

一般 transition 不再允許 rule_result 直接 resolved/reopened；manual、diff_item 原流程不變。歷史 reader 用 SQLite read-only/query_only，核對當次 cases 與保存的 source_identity，回傳目前 Issue、original_run_id 與分頁確認。缺 SHA/tenant 的 legacy run 需重新檢核，不能推定具有完整證據。

503 authorization unavailable 代表未取得權限；503 persistence unavailable 代表後端已回滾。若 Coordinator 等不到上游結果則回 `remediation_outcome_unknown`，Viewer 保留原命令及 idempotency key，只允許明確重試原確認。不能把斷線當成未提交。

## 許良宇圖書館本地驗證

`A1_REMEDIATION_LOCAL_VALIDATION=false` 為預設。獨立啟用需 non-production、loopback HOST、loopback Viewer origin、absolute `A1_REMEDIATION_LOCAL_POLICY_PATH` 及獨立內部 key。實際 listener/socket 也必須 loopback；拒絕 Forwarded、錯誤 Host/Origin、跨站及缺 Origin 的 POST。此 actor 是 `local-library-validation` / `local_validation`，不能宣稱公司主管身分；畫面與 audit 均標示本地驗證。

Owner 在 HTTP 之外建立下列 registry，每次操作重新讀取，expiry 不超過 24 小時。每個 case 單獨列 operations，可只准 history。不要把 IFC bytes、key、registry 或 SQLite 加入 Git。驗證前由實際兩次檢核與原始檔 SHA 填入所有欄位；不可用 browser 送來的 ID 自動建立授權。

```json
{
  "version": 1,
  "expires_at_ms": 0,
  "cases": [{
    "issue_id": "replace-with-observed-issue",
    "tenant_id": "tenant_library_validation",
    "project_id": "project_library_validation",
    "ifc_guid": "replace-with-observed-guid",
    "rule_code": "DOOR-FIRERATING-REQUIRED",
    "original": {
      "model_version_id": "24e598ab-be3d-4dbb-a1aa-60b0ba610618",
      "run_id": "replace-with-original-run",
      "source_sha256": "8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce"
    },
    "revised": { "model_version_id": "replace-with-revised-version", "run_id": "replace-with-revised-run", "source_sha256": "replace-with-64-hex-digest" },
    "operations": ["history", "confirm", "reopen"]
  }]
}
```

上例 expiry=0 故不可直接使用。Local adapter 限上述原版 library tuple；correspondence_ref 由 case identity 的穩定 SHA 產生，registry 改寫也不能讓同一 run 再次消費。刪除 case、移除 operation、到期或關閉模式即停止取得新 grant；已簽發 grant 最多存活 20 秒。

驗證用途：從原檔建立保留 GUID 的隔離修訂副本，只補入門的 FireRating 驗證值，證明「屬性必填」檢核可從 FAIL 變為 PASS，並驗證人工確認、歷史、重開、重複／無權操作。驗證值不代表該門已具真實防火認證，也不修改原設計檔或正式 Issue。隔離 seed 的 IFC-ready metadata 僅供此流程測試，不代表重新完成 MinIO intake、轉檔或 Kit/WebRTC 驗收。

官方 `start-isolated-branch-stack.ps1` 只對兩個內部 child env 透傳 key/開關，registry path 只給 Coordinator；無設定時保留 default deny。關閉服務仍按 manifest 的 PID/creation ownership 閘門。回滾以 revert 本 PR 為主；新 confirmation 表可保留，先停寫並保存 DB 備份。不得透過回滾恢復不具整改授權的正式結案流程而宣稱驗收通過。
