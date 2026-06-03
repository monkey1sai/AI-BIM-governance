# Design — governance-issue-db

## 資料流

```
瀏覽器 (console Issue Center)
  │ 只打 :8004
  ▼
coordinator (:8004) ── /api/governance/issues* proxy（HTTP 透傳）──► governance-service (127.0.0.1:49102)
                                                                       │ issues / issue_events (SQLite governance.db)
                                                                       │ from-rule-run 讀 rule_results；from-diff 讀 model_diff_items
```

## Source-of-truth 與邊界

| 資料 | 權威 |
|---|---|
| issues / issue_events | `governance-service`（落地端 issue 權威；雲端同步另議） |
| ifc_guid（issue 主鍵） | IFC 來源；usd_prim_path 為執行期索引 |

- coordinator 僅 HTTP 透傳，**不**復活 2026-05-21 退役的 socket collaboration server-push（`getReviewIssues`/`createAnnotation`/即時廣播）。issue 走 request/response，非 push。

## BCF 對齊（BCF 結合 USD 開發原則）

- rule 3/4：issue 綁 `ifc_guid` + `model_version_id`。
- rule 9：所有建立/轉換寫 `issue_events` audit。
- rule 10：無 `ifc_guid` → `kind=annotation`（視覺標註），非正式可交換 issue。

## 狀態機

`open → {assigned,in_progress,resolved,rejected}`；`assigned/in_progress → resolved/rejected`；`resolved/rejected → reopened`；`reopened → {assigned,in_progress,resolved,rejected}`。非法轉換回 4xx。

## 儲存 schema

```
issues(id, kind[issue|annotation], title, description, status, severity, assignee, ifc_guid, usd_prim_path, model_version_id, source_type[manual|rule_result|diff_item], source_ref, created_at, updated_at)
issue_events(id, issue_id, event_type[created|transition|comment], from_status, to_status, note, created_at)
```

## 驗證

- pytest：lifecycle + 非法轉換被擋 + audit 計數 + from-rule-run（帶真實 guid、kind=issue）+ from-diff + annotation kind。
- 前端 build + vitest；coordinator tsc。
- host-native Python 3.12；SQLite stdlib，無新增依賴。
