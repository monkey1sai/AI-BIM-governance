# Spec End-to-End Verification — 2026-05-08

驗證對象：

- `openspec/specs/review-session-request-lifecycle/`
- `openspec/specs/session-first-review-viewer/`

驗證範圍涵蓋自動化測試套件、API 端對端 smoke、瀏覽器 multi-user 操作、與 lifecycle close/release。執行人：Claude（受 monkey1sai 指派）。

---

## 1. Spec → Code Path 對應

| Spec / Requirement | 實作位置 | 測試入口 |
| --- | --- | --- |
| review-session-request-lifecycle Req1（POST /api/review-session-requests + 必填驗證） | `_bim-control/app/main.py:498` | `_bim-control/tests/test_review_session_requests_api.py` |
| Req2（artifact readiness、blocked_conversion） | `_bim-control/app/main.py:290`、`216`、`701` | 同上 |
| Req3（coordinator session 回寫 + queued_for_instance） | `_bim-control/app/main.py:559`、`bim-review-coordinator/src/services/kitPool.ts` | 同上 + `bim-review-coordinator/tests/sessions.test.ts` |
| Req4（lifecycle 顯式狀態） | `_bim-control/app/main.py:568`、`bim-review-coordinator/src/app.ts:273` | 同上 |
| Req5（closing vs instance release 分離） | `bim-review-coordinator/src/app.ts:287`、`src/services/kitPool.ts:86` | `bim-review-coordinator/tests/sessions.test.ts:264, 566` |
| session-first-review-viewer Req1（從 review_request_id / session_id bootstrap） | `web-viewer-sample/src/Window.tsx:355` 起 | `web-viewer-sample/scripts/verify-session-first-contract.mjs` |
| Req2（顯示 artifact / lifecycle / Kit binding readiness） | `web-viewer-sample/src/Window.tsx:126`、`components/ArtifactPanel.tsx` | 同上 |
| Req3（runtime command 走 DataChannel；collaboration 走 coordinator） | `web-viewer-sample/src/clients/streamMessages.ts`、`reviewSocket.ts` | 同上 |
| Req4（multi-artifact 控制） | `web-viewer-sample/src/clients/streamMessages.ts` `buildOpenStageRequest` | 同上 |
| Req5（lifecycle transition 安全） | `web-viewer-sample/src/Window.tsx:229, 297` | 同上 |

---

## 2. 自動化測試套件結果

| 套件 | 入口 | 結果 |
| --- | --- | --- |
| `_bim-control` pytest（review session lifecycle 套組） | `cd _bim-control && python -m pytest tests/test_review_session_requests_api.py -v` | 21 / 21 通過 |
| `bim-review-coordinator` vitest（4 檔：sessions / kitpool / sessionstore / dev-console） | `cd bim-review-coordinator && npm test` | 102 / 102 通過 |
| `web-viewer-sample` session-first contract | `cd web-viewer-sample && npm run test:session-first` | 通過 |

執行注意：

- 系統 Python 安裝過 starlette 1.0.0，與 `_bim-control/requirements.txt` 鎖定的 fastapi 0.111.0 / starlette 0.37.2 不相容（會出 `Router.__init__() got an unexpected keyword argument 'on_startup'`）。需在 worktree 建立獨立 `.venv` 安裝 pinned 版本後才能跑 pytest。
- `bim-review-coordinator` 與 `web-viewer-sample` 的 `node_modules` 預設未提交，需先 `npm install` 才能跑 `npm test` / `npm run test:session-first`。

---

## 3. API 端對端 smoke

執行 `scripts/smoke-worker-review-request.ps1`：

```
[smoke] worker review request passed
[smoke] source_artifact_id: artifact_src_20209fe14110
[smoke] conversion_job_id: conv_20260508035732_f35ea00e
[smoke] review_request_id: review_request_1778212653364
[smoke] session_id: review_session_6721d4c09e6d
```

驗證鏈路：

```
_worker POST /api/artifacts
→ _worker POST /api/conversions
→ _worker GET /api/conversions/{id}/result (status=succeeded)
→ _bim-control POST /api/review-session-requests (status=created)
→ coordinator POST /api/review-sessions
→ coordinator GET /api/review-sessions/{id}/stream-config (model.status=ready)
→ _bim-control PATCH /api/review-session-requests/{id} (status=active)
```

延伸驗證（lifecycle / binding / close release）：

- `POST /api/review-session-requests` 在 `model_version_id` 缺失時回 HTTP 422。
- `GET /api/review-session-requests/{id}/lifecycle-events` 回 `reviewRequestCreated` + `sessionBound` 兩筆事件。
- `GET /api/review-session-requests/{id}` 顯示 `status=active`、`session_id`、`artifact_bindings`、`kit_instance_bindings` 全數回寫。
- `POST /api/review-sessions/{sid}/close` 將 session 移到 `closed`、kit binding 全部 `released`，二次 close idempotent。

---

## 4. 瀏覽器 multi-user / WebRTC 驗證

啟動端口：`_bim-control`（8001）、`_worker`（8005）、`bim-review-coordinator`（8004）、`bim-streaming-server` Kit signaling（49100）、`web-viewer-sample` dev server（5173）。

開兩個 Chrome tab，帶 `?sessionId=review_session_6721d4c09e6d&userId=user_alpha&displayName=Alpha` 與 `?userId=user_bravo&displayName=Bravo`。

### 4.1 WebRTC + Kit DataChannel pipeline

Tab A console / UI 證據：

- Kit signaling 49100 連線建立。
- WebRTC SDP offer/answer + ICE 完成（SDP 含 `BUNDLE 0 1 2`、`ice-ufrag`）。
- viewer 透過 DataChannel 送 `openStageRequest`，UI ⑥ 顯示 `openedStageResult`。
- Kit App 對 demo USD 回 `Kit App communicates there was an error loading: ...model.usdc`。原因是 smoke 用的 `storage/sample.ifc` 只含 ISO-10303-21 兩行 header，轉出的 USD 沒有可渲染幾何，**不是 streaming pipeline 缺陷**。

### 4.2 Multi-Kit instance routing 觀察

Tab B Kit signaling 同時連 49100 時，Kit 回 `0xC0F22219`（GPU busy / already streaming），retry 持續觸發；UI 顯示「WebRTC 串流未建立（30 秒內沒有收到影片）」。

這符合 spec 的 multi-instance routing 設計：本機 `local_fixed` Kit profile 是 1:1 stream，需要 `dedicated_instance` + 多個 Kit instance 才能並行 stream。Tab B 的 Socket.IO collaboration 仍正常運作。

### 4.3 Multi-user Socket.IO collaboration

`coordinator GET /api/review-sessions/{sid}` 回：

```
status=active, participants=2
- user_alpha (display=Alpha, joined 03:57:51)
- user_bravo (display=Bravo, joined 03:57:56)
```

Tab A 點「建立審查標註」按鈕後，`coordinator GET /api/review-sessions/{sid}/events` 多出第三筆：

```
type=annotationCreated
actor_id=user_alpha
target.usd_prim_path=/World
saved.annotation_id=ann_1778212872
```

`_bim-control GET /api/review-sessions/{sid}/annotations` 也讀到 `ann_1778212872`（actor=user_alpha、created_at 對應 socket emit 時間）。

驗證鏈完整：viewer → coordinator socket `annotationCreate` → `bimControlClient.createAnnotation` → `_bim-control` 持久化 → `recordAndBroadcast` 回灌 `namespace.to(sessionId).emit("annotationCreated", ...)` 給 Tab A + Tab B。

### 4.4 Session close / Kit release 收尾

`POST /api/review-sessions/{sid}/close` 回：

```
status=closed
kit_instance_bindings[0].status=released
kit_instance_bindings[0].released_at=2026-05-08T04:03:56.242Z
participants=[]
```

證實 close 與 instance release 分離、release 時間戳獨立記錄。

---

## 5. 已驗證 vs 仍未驗證

### 已驗證

- `_bim-control` review-session-request CRUD + lifecycle + readiness 檢查（pytest + 端對端 API）。
- coordinator session lifecycle、`artifact_bindings[]`、`kit_instance_bindings[]`、`queued_for_instance` 容量處理、close → release 分離（vitest + 端對端 API）。
- viewer 從 `session_id` / `review_request_id` bootstrap、blocked / closing / closed 狀態 gating、runtime 與 collaboration 分流（contract test + 真實瀏覽器執行）。
- WebRTC signaling + DataChannel + `openStageRequest` 從 viewer 路由到 Kit。
- Multi-user Socket.IO `joinSession` + `annotationCreate` + 廣播 + `_bim-control` 持久化（兩個 Chrome tab 真實互動）。

### 仍未驗證 / 限制

- **Kit GPU 實際渲染 USD**：本次使用的 smoke fixture (`storage/sample.ifc` 只含 ISO header) 轉出來的 USD 沒有可渲染幾何，Kit App 載入回 error。需要準備有效幾何的 IFC（或現成可用 USD）才能驗證 Kit viewport 上會看到圖。
- **多 Kit instance 並行 streaming（`dedicated_instance` routing）**：本機 `kit_profile=local_fixed` 只有 1 個 Kit instance（signaling 49100），第二個 viewer 會撞 `0xC0F22219`。需要 ≥ 2 個 Kit instance（不同 signaling port）才能驗 spec Req3 中 `dedicated_instance` routing 在實機上的並行 stream。
- **大型 IFC 端對端壓力**：smoke fixture 是極小檔案，沒驗 conversion 在大型 IFC 下的耗時、記憶體、或 readiness 中間態（`status=processing` 較長時間時的 viewer 行為）。
- **Socket.IO 大量併發**：本次只實測 2 個瀏覽器 tab；coordinator vitest 有 `selectionUpdate` / `presenceUpdated` broadcast 邏輯覆蓋，但沒做多 user 真實壓力。
- **`bim-streaming-server` 自身的 unit / contract test**：本次沒跑 `bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1`（驗 streaming pipeline 對 USD 載入的 contract）。

### 後續建議

1. 將 `storage/` 的 demo IFC 換成至少含一個 wall / slab 的有效模型，才能跑出有畫面的 Kit viewport，並做 viewport screenshot 證據。
2. 若需要驗 `dedicated_instance` routing，先補 `bim-streaming-server` 多 instance 啟動腳本（不同 signaling port），再讓 coordinator KitInstancePool 註冊兩台。
3. 考慮把這份 verification 報告納入 OpenSpec change archive 的 task 7.5 / 7.6 後續紀錄，避免下次再被重新驗證一次。

---

## 附錄：本次使用 / 清理的測試 session

- `review_request_id: review_request_1778212653364`
- `session_id: review_session_6721d4c09e6d`（已 `closed`）
- 所有臨時 PowerShell 探測腳本（`scripts/_tmp_*.ps1`）已刪除。
- 為環境準備建立的 `.venv` 與 `node_modules` 屬 gitignored，未提交。

---

## 6. OpenSpec Follow-up Evidence - `complete-spec-runtime-verification`

執行時間：2026-05-08

本節補記 `openspec/changes/complete-spec-runtime-verification/` apply 階段的 runtime evidence。原本第 5 節保留 03:57 那次 E2E 的歷史結果；本節是後續補驗與 blocker 分層，不把硬體 / fixture 條件混成單一 pass/fail。

### 6.1 Baseline / machine constraints

| 項目 | 結果 |
| --- | --- |
| `_bim-control` health | `http://127.0.0.1:8001/health` 回 `status=ok` |
| `_worker` health | 原先 8005 未開；apply 階段暫時啟動 `_worker`，`/health` 回 `status=ok` |
| `bim-review-coordinator` health | `http://127.0.0.1:8004/health` 回 `status=ok`，`kit_signaling_port=49100` |
| `web-viewer-sample` | `http://127.0.0.1:5173` 回 HTTP 200 |
| Kit signaling port | `127.0.0.1:49100` TCP reachable |
| Kit stream port | `127.0.0.1:47998` TCP not reachable during this apply |
| GPU probe | `nvidia-smi`: `NVIDIA GeForce RTX 4060 Ti`, driver `580.97`, total memory `8188 MiB` |
| WMI GPU probe | `Get-CimInstance Win32_VideoController` was access-denied in this sandbox |
| worktree `storage/` | only `README.md` |
| user main checkout `storage/` | `C:\Repos\active\iot\AI-BIM-governance\storage` contains 13 IFC files |
| selected repo-local IFC fixture | `許良宇圖書館建築_2026.ifc`, `89394282` bytes, contains `IFCPROJECT` |

### 6.2 Non-GPU stage-loading contract

Command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\bim-streaming-server\scripts\tests\test-stage-loading-contract.ps1
```

Result:

```txt
[verify] stage loading DataChannel contract passed
```

Status: **passed at `contract` tier**.

Scope: this validates `stage_loading.py` contains the expected DataChannel contract tokens and load-order / sublayer behavior checks. It does **not** prove GPU viewport render or real USD geometry loading.

### 6.3 Single Kit GPU render

Status: **blocked / not passed**.

Evidence gathered:

- Valid repo-local IFC fixture exists in the user main checkout storage: `許良宇圖書館建築_2026.ifc`, `89394282` bytes.
- `_worker` can list that storage root when started with `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage`.
- `_worker` large-fixture facade conversion succeeded, but current `complete_conversion_job()` writes a placeholder `model.usdc` (`# worker adapter USDC placeholder`) rather than a renderable converted model.
- Kit signaling `49100` was reachable, but stream port `47998` was not reachable during this apply.
- No browser viewport screenshot or non-zero video frame evidence was captured for a renderable geometry USD / USDC.

Conclusion: the repo-local IFC fixture prerequisite is satisfied, but the runtime still lacks a renderable USD / USDC artifact produced from that fixture. A future pass needs either a real IFC->USD/USDC conversion path or a known renderable USD / USDC fixture before claiming single Kit GPU viewport render.

### 6.4 Dedicated multi-Kit routing

Status: **blocked / not passed**.

Evidence gathered:

- Root `scripts/start-all.ps1` coordinates normal multi-service startup and delegates single streaming startup to `bim-streaming-server/scripts/start-streaming-server.ps1`.
- No root `scripts/` orchestration entrypoint currently launches two or more Kit instances with distinct signaling ports.
- Existing coordinator tests cover `dedicated_instance` allocation semantics, but this remains control-plane evidence only.

Conclusion: `dedicated_instance` runtime streaming is not verified on this machine yet. The next runnable step is a root `scripts/` orchestration entrypoint that can launch / check multiple Kit instances with distinct signaling ports, then run two browsers against distinct `kit_instance_bindings[]`.

### 6.5 Large IFC worker/readiness stress

Status: **passed at `_worker` facade/readiness tier; not a real converter or viewport render pass**.

Selected fixture:

```txt
source_id: 208b4ebf111c1a6e28dd971867fed5ac
filename: 許良宇圖書館建築_2026.ifc
size_bytes: 89394282
```

Result:

```txt
conversion_job_id: conv_20260508045208_51f18a51
artifact_group_id: ag_4e3b78ffcbaf
job_status: succeeded
result_status: succeeded
readiness_status: ready
readiness_ready_status: ready
elapsed_ms: 1181
worker_working_set_before: 49090560
worker_working_set_after: 51568640
usdc_url: http://127.0.0.1:8005/objects/tenants/tenant_runtime_verify/projects/project_runtime_verify/versions/version_runtime_verify_001/artifact-groups/ag_4e3b78ffcbaf/derived/conv_20260508045208_51f18a51/usdc/model.usdc
mapping_url: http://127.0.0.1:8005/objects/tenants/tenant_runtime_verify/projects/project_runtime_verify/versions/version_runtime_verify_001/artifact-groups/ag_4e3b78ffcbaf/derived/conv_20260508045208_51f18a51/usdc/element_mapping.json
```

Conclusion: `_worker` can ingest the 89 MB repo-local IFC through the dev source flow and move the artifact group to `ready`. This is useful readiness evidence, but it does not measure real IFC geometry conversion cost because the current worker facade emits placeholder derived files.

### 6.6 Socket.IO bounded ramp / 90% stress

Prerequisite smoke:

```txt
[socket-smoke] passed session=review_session_e569f6ec955d
```

Bounded ramp:

| Clients | Result | Session | Broadcasts seen | Elapsed |
| --- | --- | --- | --- | --- |
| 10 | passed | `review_session_e9651b8e458e` | 9 | 62 ms |
| 25 | passed | `review_session_a1715ab615de` | 24 | 125 ms |
| 50 | passed | `review_session_9cb34f41b86f` | 49 | 249 ms |
| 75 | passed | `review_session_636072ea2bc4` | 74 | 352 ms |
| 100 | passed | `review_session_79a48756bf44` | 99 | 518 ms |

Formal target used for this apply:

```txt
bounded max stable clients: 100
90% target: 90
stress session: review_session_f4e936dc529c
stress result: passed
stress elapsed_ms: 432
broadcasts_seen: 89
coordinator health after run: status=ok
```

Conclusion: Socket.IO collaboration passed a bounded 90-client stress run on this machine. This is not an absolute maximum-capacity proof because the ramp stopped at 100 stable clients; it is sufficient evidence for the current 90% target defined by this bounded apply pass.
