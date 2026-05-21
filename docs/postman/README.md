# Postman — fast-ifc-link-demo

> fast-ifc-link-demo-loop change(2026-05-21)的外部 caller 模擬器。設計見
> `docs/superpowers/specs/2026-05-21-fast-mvp-loop-overall-design.md` §4 與
> `openspec/changes/archive/2026-05-21-fast-ifc-link-demo-loop/`(archive 後路徑)。

## 1. 導入

1. Postman → File → Import → 選 `docs/postman/fast-ifc-link-demo.postman_collection.json`
2. Collection 內 8 個 variables 已含 default,可直接跑;若要對外部真實 MinIO,改 `ifc_path`

## 2. 環境變數

| Variable | Default | 說明 |
|---|---|---|
| `coordinator_base_url` | `http://127.0.0.1:8004` | coordinator API base;LAN 上其他機器改 `http://<host-LAN-IP>:8004` |
| `webhook_secret` | `dev-webhook-secret` | 對應 `EXTERNAL_INTAKE_WEBHOOK_SECRET` env |
| `ifc_path` | `http://192.168.20.234:9000/bim-control/899/xxx/model.ifc` | 對應「BIM 模型管理平台 系統架構」PDF 上的 MinIO 路徑;非生產可換 local fixture URL |
| `project_id` / `version` / `task_id` | `899` / `xxx` / `task_img_001` | worker compat payload identity |
| `ifc_ready_job_id` | `` | 由 Submit response 自動寫入 |
| `viewer_url` | `` | 由 Poll response 自動寫入(轉檔 ready 時) |

## 3. Happy path 跑法

### 3.1 自動(Postman Collection Runner)

1. 設好 `ifc_path` 指向實際可達的 IFC URL(或 dev 機本機 fixture HTTP server)
2. Collection → Runner → 選本 collection → **勾 Delay = 5000 ms**(讓 Poll 重試之間有間隔)
3. 跑;Runner 會自動 `Submit ifc-ready` → `Poll ifc-ready job`(setNextRequest 迴圈到 viewer_url 出現)→ `Open viewer (info only)`
4. Console panel 看到 `captured viewer_url = http://<host>:8004/ui/open?session=review_session_...` 即成功
5. 在**同一台 host 的瀏覽器**打開 viewer_url(coordinator 會 302 redirect 到 `127.0.0.1:5173/?session=...`)

### 3.2 手動單步

1. 開 `Submit ifc-ready` request,點 Send → 看 response status `200` 或 `202`、body 含 `ifc_ready_job_id` / `download_status:"downloaded"`
2. 開 `Poll ifc-ready job` request,點 Send → 看 response body `viewer_url`;若 null 等 5 秒再點一次
3. `viewer_url` 出現後,複製到同台 host 的瀏覽器,看到 viewer 全螢幕 stream 即完成

## 4. 常見 issue

- **`502 IFC download failed`**:`ifc_path` 不可達(MinIO 192.168.20.234 沒開、HTTPS cert 問題、connection refused)。dev 機環境的 non-strict mode 應該回 `202 placeholder`,strict mode 才會 502。看 coordinator log:`IFC download failed: <reason>`。
- **Poll 一直回 `conversion_status: queued` 不前進**:streaming-server (49101) 沒起 / 起來但沒收到 dispatch。看 coordinator log `streaming conversion API ...` 錯誤。
- **viewer_url 出現但瀏覽器打不開**:viewer 已綁 `127.0.0.1:5173`,**LAN 其他機器連不到**;必須在同台 host 的瀏覽器打開,或走 reverse proxy(本 change 不做)。
- **`X-Correlation-Id` / `X-Idempotency-Key` 重複錯誤**:Postman `{{$randomUUID}}` 每次 send 都會重 roll;若 collection runner 多次跑同 task_id,worker compat 派生的 idempotency 會視為 idempotent replay(回 200 既存 job),這是 spec `local-coordinator-ifc-ready-intake-boundary` 既定行為。

## 5. 對應 spec

- `local-coordinator-ifc-ready-intake-boundary`:Coordinator synchronously downloads IFC + GET job 暴露 viewer_url + /ui/open redirect
- `conversion-webhook-lifecycle`:dispatch payload local_path / host_local_path
- `demo-fast-mvp-orchestration`:本 Postman collection + README + coordinator `/ui` 3 卡

## 6. 對應檔

- Coordinator implementation:`bim-review-coordinator/src/services/ifcDownloader.ts`、`bim-review-coordinator/src/app.ts` `POST /api/external/ifc-ready` handler、`GET /ui/open`
- Brainstorming overall design:`docs/superpowers/specs/2026-05-21-fast-mvp-loop-overall-design.md`
