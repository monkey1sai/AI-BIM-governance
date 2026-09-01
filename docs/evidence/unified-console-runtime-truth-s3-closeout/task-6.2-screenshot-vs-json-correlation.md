# Task 6.2 — screenshot vs. same-window JSON correlation table

canonical-linux (redacted as `<canonical-host>`), coordinator `:8004`, evidenceHead
`d04de191ec48d4e34c6744f9201d5e37a4f11b6c` (bound product HEAD assigned to this evidence-only
closeout round). **Correction (round-2 verification F1):** canonical-linux was rebuilt/deployed
per task 6.1's `deploy-20260831-639237709604722760-001` tag at commit
`a0ab7065131914e548e1d79a1c683c8b14b07de4`, not at `d04de191` — `d04de191` is a later,
unmerged branch-local evidence-only commit (docs/openspec only) created on top of that deploy.
The binding still holds in substance: `git diff a0ab7065131914e548e1d79a1c683c8b14b07de4
d04de191ec48d4e34c6744f9201d5e37a4f11b6c -- . ":(exclude)docs/**" ":(exclude)openspec/**"` is
empty, i.e. this evidence was captured against the deployment at `a0ab7065`, whose product tree
is byte-identical to evidenceHead `d04de191`. See `task-6.1-deploy-tag-match.txt` for the tag
message.

Screenshots: `task-6.2-screen-*.png`, captured via Playwright CLI `page.screenshot`
(`npx playwright screenshot`, no browser chrome/address bar), 1440x900 viewport,
2026-08-31T11:48:36Z .. 2026-08-31T11:49:03Z.

JSON: `task-6.2-endpoint-*.json` + `task-6.2-minio-objects-summary.json`, captured
2026-08-31T11:49:17Z .. 2026-08-31T11:49:26Z (immediately after the screenshot batch; see
`task-6.2-capture-log.txt` for the full multi-pass stability record — three independent passes
at ~11:41 / ~11:42 / ~11:49 all returned identical steady-state numbers, confirming the system
was idle throughout and the ~40s screenshot-to-JSON gap does not represent state drift).

## `no-hash` (`/ui`) and `#home` — 總覽 · Mission Control

Both screens render identically (no-hash defaults to `#home`); both screenshots show the
same displayed values.

| Screen tile | Displayed value | JSON source | JSON value | Match |
|---|---|---|---|---|
| 轉檔中／ready／failed | `0` / `ready 12` / `failed 0` | `task-6.2-endpoint-conversion-records.json` | `body.count=12`, all 12 `items[].status="ready"` (0 non-ready) | yes |
| 現有 SESSIONS／participants | `0` / `0` | `task-6.2-endpoint-runtime-status.json` | `body.sessions.count=0`, `active_count=0`, `participant_count=0` | yes |
| 未結 ISSUE | `0` | `task-6.2-endpoint-governance-issues.json` | `body.issues=[]` (length 0) | yes |
| OUTBOX 待送／attempts | `36` / `0/5` | `task-6.2-endpoint-callback-outbox-summary.json` | `body.total=36`, all 36 `entries[].attempts=0`, `max_attempts=5` | yes |
| 服務健康 (bim-review-coordinator OK) | `OK` | `task-6.2-endpoint-runtime-status.json` | `body.service.status="ok"` | yes |

## `#pipeline` — 模型資料與轉檔生產線

| Screen tile | Displayed value | JSON source | JSON value | Match |
|---|---|---|---|---|
| 件 ifc-ready | `0` | `task-6.2-endpoint-external-ifc-ready.json` | `body.count=0`, `body.items=[]` | yes |
| 資料夾／含 source IFC | `7` / `3` | `task-6.2-minio-objects-summary.json` | `distinct_top_level_folders=7`, `folders_matching_source_ifc_pattern=3` (computed from the live 1745-object bucket listing; see `folder_summary`) | yes |
| MinIO watch baseline／seen／triggered | `12` / `12` / `0` | `task-6.2-endpoint-minio-watch-status.json` | `body.baseline_count=12`, `body.seen_count=12`, `body.triggered_total=0` | yes |
| 轉檔記錄 ready／running／failed | `12` / `0` / `0` | `task-6.2-endpoint-conversion-records.json` | `body.count=12`, all `status="ready"` (0 `running`, 0 `failed`) | yes |
| REVIEW SESSIONS | `0` | `task-6.2-endpoint-runtime-status.json` | `body.sessions.count=0` | yes |
| CALLBACK OUTBOX 待送 | `36` | `task-6.2-endpoint-callback-outbox-summary.json` | `body.total=36` | yes |
| 治理／報表 rule-runs／未結issue | `0` / `0` | `task-6.2-endpoint-governance-rule-runs.json` / `-governance-issues.json` | `body.total=0` / `body.issues=[]` | yes |

## `#runtime` — Runtime / Kit · GPU 營運

| Screen tile | Displayed value | JSON source | JSON value | Match |
|---|---|---|---|---|
| Kit Instance id | `kit_local_001` | `task-6.2-endpoint-kit-instances-current.json` | `body.instance_id="kit_local_001"` | yes |
| Kit Instance status (`idle` badge) | `idle` | `task-6.2-endpoint-kit-instances-current.json` | `body.status="idle"` | yes |
| control (`not_sent`) | `control not_sent` | `task-6.2-endpoint-kit-instances-current.json` | `body.control_status="not_sent"` | yes |
| opened (`0`) | `opened 0` | `task-6.2-endpoint-kit-instances-current.json` | `body.opened_runtime_uris=[]` (length 0) | yes |
| GPU Fleet 未取得 | `未取得` | (no GPU telemetry endpoint in the required ten; consistent with proposal.md's disclosed "GPU 遙測未取得" gap — none of the 10 canonical endpoints expose GPU utilization) | n/a | consistent (honest-absence, not a fabricated value) |
| 服務健康 kit-manager-api | `OK` | `task-6.2-endpoint-kit-health.json` | `body.status="ok"` | yes |

## `#a1` / `#a2` / `#a3` — 3D 工作區 (A1 治理檢核 / A2 版本 Diff / A3 Federation)

These render the design-preview 3D workbench (model tree, rule/diff/federation panels) with a
`no-GPU 示意／示範圖（非即時渲染）` corner label on every screen (**correction, round-2
verification F2**: an earlier draft of this table misquoted the label as `no-GPU
尚無／未啟動（非可信提交）`; the string actually rendered — confirmed against
`WorkspacePage.tsx:189`, the committed `task-6.2-screen-a1/a2/a3.png`, and
`task-2.1-3.2-canonical-dom-audit.md`'s live DOM query — is `no-GPU
示意／示範圖（非即時渲染）`, matching task 3.1's required wording exactly), i.e. an offline/demo
viewport, not a claim of a live GPU-backed session. Cross-check against the ten-endpoint JSON:

| Cross-check | Displayed | JSON source | JSON value | Match |
|---|---|---|---|---|
| No live review session backing the viewport | (no session banner; `review session` control shown, not an active session) | `task-6.2-endpoint-runtime-status.json` | `body.sessions.count=0`, `body.kit_instance_bindings=[]` | consistent — 0 backend sessions matches the absence of any live-session claim on screen |
| Kit instance idle (no GPU stream claimed) | corner label reads `no-GPU`, not a fabricated FPS/ms figure | `task-6.2-endpoint-kit-instances-current.json` | `body.status="idle"`, `control_status="not_sent"` | consistent |

## `#a4` — A4 語意查詢與證據

Renders `asbuilt · PARTIAL` with an LLM status block (`state: disabled`,
`configured_model: Ornith-1.0-35B`, `transport_class: unconfigured`,
`readiness_evidence: config`, `error_code: llm_disabled`). This reads from
`GET /api/governance/search/llm-status`, which is **not** one of the ten endpoints this task's
JSON snapshot covers (task 1.2's ten-endpoint list is `runtime/status`, `external/ifc-ready`,
`conversion/records`, `callback-outbox/summary`, `governance/issues`, `governance/rule-runs`,
`external/minio-watch/status`, `minio/objects`, `kit/health`, `kit/instances/current`); no
separate probe of `llm-status` was taken in this pass and none is claimed here. The screen's own
self-reported `disabled`/`unconfigured`/`llm_disabled` state is internally consistent (an honest
"not available" state, not a fabricated live value), matching R6's requirement that the page
explain the empty/partial state rather than show fabricated data.

## Endpoint not independently re-verified with a second capture in the authoritative window

`/api/minio/objects` (the 10th endpoint) returns a full 1745-object bucket listing; its full
payload is summarized (not committed verbatim) in `task-6.2-minio-objects-summary.json` per the
privacy rule against publishing real customer/project folder names into a public repo (see
`task-6.2-6.5-deidentification-map.json`). The `distinct_top_level_folders=7` /
`folders_matching_source_ifc_pattern=3` aggregate is the value that cross-checks against the
`#pipeline` screen's `7/3` tile, and is directly computed from that same capture.
