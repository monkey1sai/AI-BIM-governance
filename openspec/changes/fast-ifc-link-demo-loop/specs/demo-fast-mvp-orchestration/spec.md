# demo-fast-mvp-orchestration — Spec Delta (fast-ifc-link-demo-loop)

> Delta against `openspec/specs/demo-fast-mvp-orchestration/spec.md`(本檔僅含本 change 的差異)。本 change 把 demo runbook 從「3 step PowerShell scripts」擴展為「coordinator `/ui` 一頁完成 happy path + Postman 模擬外部 caller」雙路徑,並把 viewer 進入體驗收斂為「一條連結點開全螢幕 stream」。

## ADDED Requirements

### Requirement: Coordinator /ui provides 3-card single-column fast-mvp happy path

`bim-review-coordinator` `GET /ui` SHALL serve a single-column vertical 3-card layout(remove conflict-review predecessor 已刪 step 5 改 3)that allows a demo operator to complete the entire fast-mvp loop without leaving the page:

- **Card ①** Submit IFC source:form with inputs `ifc_path`(URL or local file ref)、`project_id`、`version`、`task_id`, plus a button that POSTs `worker compat` body to `/api/external/ifc-ready`. After submit, the card displays the HTTP status, `ifc_ready_job_id`, and initial `download_status`.
- **Card ②** Download + conversion progress:every 5 seconds the page polls `GET /api/external/ifc-ready/<ifc_ready_job_id>` and updates three indicators: `download_status`, `conversion_status`, `viewer_open_ready`(boolean derived from `viewer_url !== null`).
- **Card ③** Open viewer:displays `viewer_url` when present, with a "copy" button and an "open viewer" button that navigates to `viewer_url`(which itself is the coordinator's `/ui/open?session=...` redirect).

The dev-console test bench in the existing inline script(`socket.IO joinSession / heartbeat`, `raw HTTP buttons for joinSession/leaveSession/heartbeat`)SHALL be preserved as an expandable details panel for engineering troubleshooting, but it is NOT the primary path. The previous 5-step "互動實驗室" cards(predecessor archived)remain removed.

#### Scenario: Demo operator completes the happy path from /ui

- **WHEN** a demo operator navigates to `http://127.0.0.1:8004/ui`, fills card ① with valid `ifc_path` / `project_id` / `version` / `task_id`, and clicks "送出 ifc-ready"
- **THEN** the page submits `POST /api/external/ifc-ready`, captures `ifc_ready_job_id`, displays HTTP 200 with `download_status:"downloaded"`, and starts 5-second polling
- **AND** card ② updates `download_status`, `conversion_status` as `GET .../<jobId>` returns
- **AND** when `conversion_status:"ready"` and `viewer_url` becomes non-null, card ③ shows the viewer URL with copy and open buttons
- **AND** clicking "開啟 viewer" navigates to `viewer_url` which redirects to `http://127.0.0.1:5173/?session=<lwv>`

#### Scenario: /ui retains canonical title for dev-console test compatibility

- **WHEN** `GET /ui` is served
- **THEN** the response body contains the string `審查協調 (Review Coordinator)` so existing dev-console.test.ts string assertions remain green

### Requirement: Postman collection mirrors external caller flow

The repository SHALL include `docs/postman/fast-ifc-link-demo.postman_collection.json`(Postman Collection v2.1)and `docs/postman/README.md` that allow an operator without coordinator `/ui` access to drive the same happy path:

- **Submit ifc-ready**: POST `{{coordinator_base_url}}/api/external/ifc-ready` with worker compat body and 600-second timeout; test script captures `ifc_ready_job_id` to collection variable
- **Poll ifc-ready job**: GET `{{coordinator_base_url}}/api/external/ifc-ready/{{ifc_ready_job_id}}`; test script captures `viewer_url` when non-null, else calls `pm.execution.setNextRequest("Poll ifc-ready job")` with a 5-second delay
- **Open viewer (info only)**: GET `{{viewer_url}}` as a manual reference; the README explains that Postman cannot drive a browser, so the operator opens the URL in a browser on the same host

The collection's environment variables MUST include: `coordinator_base_url`, `webhook_secret`, `ifc_path`, `project_id`, `version`, `task_id`. Default values MUST point at the local dev stack(`http://127.0.0.1:8004`, etc.). The README MUST explain how to override `ifc_path` to point at a real MinIO URL or a local fixture served by another HTTP server.

#### Scenario: Postman Collection Runner drives happy path

- **WHEN** an operator imports `docs/postman/fast-ifc-link-demo.postman_collection.json`, configures the environment to point at a running coordinator + streaming-server stack, and runs the collection
- **THEN** Submit returns HTTP 200 with `download_status:"downloaded"` and `ifc_ready_job_id` captured
- **AND** Poll iterates until `viewer_url` is set, then exits the loop
- **AND** the operator can copy `viewer_url` and open it in a browser to reach a working full-screen stream

