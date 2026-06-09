# Fast MVP Loop — Overall Design (Brainstorming Spec)

> **文件性質**:brainstorming `superpowers/brainstorming` skill 階段的 design artifact,不是 OpenSpec spec(authoritative spec 在 `openspec/changes/<change-id>/`)。
> **日期**:2026-05-21
> **發起人**:使用者(`xshiujj@gmail.com`)
> **brainstorming session ID**:`0bd5b305-8e62-4efe-9de3-96f575c93367`
> **執行模式**:`/goal` 驅動,使用者授權 implementation 階段全自動(memory `agent-full-automation-during-implementation`)
> **語言**:繁體中文(技術 identifier / 程式碼 / log / parser header 保留原文)

---

## 0. Goal in one sentence

> 接 IFC ifc-ready API → coordinator 同步下載 IFC + 派工轉檔 → 轉檔成功 → 對外輸出一條 viewer 連結 → client 點連結直接全螢幕看 3D stream。同時把現有「衝突檢討 / 標示問題位置 / 建立審查標註」功能移除。

---

## 1. Architecture & Flow

### 1.1 Happy path 全圖

```
Postman ──POST ifc-ready ─→ coordinator ─GET MinIO ─→ Storage
                                |          (sync)         |
                                |  ← bytes ──            |
                                | save → /workspace/storage/ifc-cache/<jobId>/source.ifc
                                |
                            200 { ifc_ready_job_id, download_status:"downloaded",
                                   message:"IFC 已下載", conversion_job_id, conversion_status:"queued" }
                                |
                            dispatch internal /api/conversions { local_path, host_local_path } 
                                ↓
                          streaming-server (host-native, 49101)
                          open same path, IFC → USDC, callback ready
                                ↓
                          coordinator ingestConversionReport (status=ready)
                            ├─ enqueue metadata-only callback outbox (沿用既有)
                            └─ autoCreateOrActivateSession → web_view_session_id (lwv_*)
                                ↓
   GET /api/external/ifc-ready/{jobId}   (Postman polls)
                                ↓
   200 { download_status:"downloaded", conversion_status:"ready",
         viewer_url:"http://192.168.10.105:8004/ui/open?session=lwv_abc",
         web_view_session_id:"lwv_abc" }
                                |
                            click viewer_url
                                ↓
                          coordinator GET /ui/open?session=lwv_abc
                          → server-side redirect to http://127.0.0.1:5173/?session=lwv_abc
                          (同台 host 上的瀏覽器才連得到 5173,LAN 用 8004 入口)
                                ↓
                          viewer 解析 ?session= → auto-attach,跳過 NVIDIA Forms
                          → GET coordinator /api/local-web-view/sessions/{id} → stream config
                          → WebRTC to streaming-server 49100 → render
                          → 全螢幕 3D stream + 邊框 HUD
```

### 1.2 Edge cases

- **下載失敗**:coordinator → 502 `download_failed`,job state `download_status:"failed"`,不 dispatch
- **下載 timeout**:預設 600s,可由 env `IFC_DOWNLOAD_TIMEOUT_SECONDS` 調
- **轉檔失敗**:`conversion_status:"failed"`,viewer_url 不會出現,polling 看得到 failure 原因
- **Idempotent replay**:同 `idempotency_key` 或 worker compat 派生 key 重打 → 200 reuse,不重下、不重派工
- **Kit busy(後到取代前到)**:Kit signaling 1:1 自然處理;HUD 顯示「另有 viewer 已接管」
- **MinIO 不可達(192.168.20.234 dev 機可能斷)**:implementation 用本機 fixture `storage/許良宇圖書館建築_2026.ifc`,Postman env 切換 `ifc_path` 變數

---

## 2. Approach B — 兩個小 change 序列依賴

```
┌──────────────────────────────────────────────────┐
│ Change 1: remove-conflict-review-from-fast-mvp   │  predecessor
│ ── 純減法 + 一行 compose ──                       │
└──────────────────────────────────────────────────┘
           merge & archive
                ↓ NoSuccessorWhilePredecessorOpen gate cleared
┌──────────────────────────────────────────────────┐
│ Change 2: fast-ifc-link-demo-loop                │  successor
│ ── 純加法 + UI 重設 + Postman collection ──        │
└──────────────────────────────────────────────────┘
```

理由:
1. 「刪 conflict review」獨立性高、blast radius 清晰可審;baseline 變乾淨,successor 在乾淨 map 上開發。
2. 「fast link handoff」是純加法 + UI 重設,Reviewer 容易判斷加了什麼。
3. 符合 `AGENTS.md` OpenSpec workflow NoSuccessorWhilePredecessorOpen gate。
4. 若中途翻案,predecessor 已 land 不需回滾整個故事。

---

## 3. Change 1 — remove-conflict-review-from-fast-mvp

完整 spec 見 `openspec/changes/remove-conflict-review-from-fast-mvp/`(同 worktree 內):
- `proposal.md`:why / what changes / capabilities / impact
- `design.md`:刪 code vs feature flag 取捨、grep 命令、verification 5 級、blast radius
- `tasks.md`:14 章節、~80 個 task checkbox,`/goal` 視為參考路徑
- `specs/review-session-request-lifecycle/spec.md`:## REMOVED Requirements / ## MODIFIED Requirements(實際 requirement 名 implementation 階段 grep 填入)

### 3.1 範圍摘要

| 區塊 | 動作 |
|---|---|
| coordinator `src/socket/reviewNamespace.ts` | 刪 highlight/selection/annotation/issueFocus event handlers |
| coordinator `src/services/sessionStore.ts` | 刪 issue-related fields |
| coordinator `src/public/dev-console.html` + `.js` | step bar 5 步改 3 步、刪三張 guided card、刪 emit 按鈕 + functions |
| viewer `src/components/IssuePanel.tsx` + `EventLogPanel.tsx` + `types/issues.ts` | 整檔刪 |
| viewer `src/clients/bimControlClient.ts` + `reviewSocket.ts` + `types/streamMessages.ts` | issue / annotation / highlight 相關移除 |
| viewer `src/components/DemoControlPanel.tsx` | 移除 issue 樹 + IssuePanel/EventLogPanel slot |
| `compose.host-kit.yml` `viewer.ports` | `"5173:5173"` → `"127.0.0.1:5173:5173"` |
| `AGENTS.md` §5.4 / §5.5 / §7.4 / §8.x | 標記「已退役 - fast MVP 不包含」 |
| `bim-review-coordinator/CLAUDE.md` | review session 內 issue/annotation 描述同步 |

### 3.2 OpenSpec impact

- MODIFIED `review-session-request-lifecycle`:## REMOVED Requirements 移除 issue/highlight/annotation/selection scenarios
- 沒有 ADD / removed capability

---

## 4. Change 2 — fast-ifc-link-demo-loop(草圖)

完整 spec **待 Change 1 archived 後**才落地到 `openspec/changes/fast-ifc-link-demo-loop/`。本節為 successor design 草圖,供整體 brainstorming 引用。

### 4.1 API contract

#### `POST /api/external/ifc-ready` — 行為改變(202 → 同步 200)

```json
// Request (worker compat,Postman 用)
{
  "status": "ifc_ready",
  "ifc_path": "http://192.168.20.234:9000/bim-control/899/xxx/model.ifc",
  "project_id": "899",
  "version": "xxx",
  "task_id": "task_001"
}

// Response 200(等下載完才回)
{
  "ifc_ready_job_id": "ifr_2026_...",
  "download_status": "downloaded",
  "message": "IFC 已下載至本地共享卷,轉檔已派工",
  "local_path": "/workspace/storage/ifc-cache/ifr_2026_.../source.ifc",
  "conversion_job_id": "stream_conv_...",
  "conversion_status": "queued",
  "correlation_id": "...",
  "idempotent_replay": false
}
```

- timeout 預設 600s
- 失敗:502 `download_failed`,job 標 `download_status:"failed"`,不 dispatch
- Idempotent replay 既存 job 直接 200 reuse,不重下

#### `GET /api/external/ifc-ready/:jobId` — 新增欄位

```json
{
  "ifc_ready_job_id": "...",
  "download_status": "pending|downloading|downloaded|failed",
  "conversion_job_id": "...",
  "conversion_status": "queued|running|ready|failed",
  "viewer_url": null | "http://192.168.10.105:8004/ui/open?session=lwv_abc",
  "web_view_session_id": null | "lwv_abc",
  "...既有欄位"
}
```

conversion ready 時 coordinator 自動 spawn local-web-view session(沿用既有 `autoCreateOrActivateSession`,在 `ingestConversionReport` ready 分支內 hook),並把 `viewer_url` 寫進 job state。

#### 新 endpoint `GET /ui/open?session=<id>`

server-side redirect 到 `http://127.0.0.1:5173/?session=<id>`。理由:viewer 已綁 127.0.0.1(Change 1 完成),LAN 連不到;coordinator 在同 host 收到 LAN client 的 redirect 後,讓 client 端 browser 改連 viewer。最終使用者必須**在同台 host 開 browser**(fast MVP 邊界,不做反向代理)。

### 4.2 Shared volume

```
compose.runtime-manager.yml (coordinator 已有 ./storage:/workspace/storage)
  coordinator 寫:/workspace/storage/ifc-cache/<jobId>/source.ifc

streaming-server (host-native) 從 host 角度讀:
  C:\Repos\active\iot\AI-BIM-governance\storage\ifc-cache\<jobId>\source.ifc

coordinator → streaming dispatch payload:
{
  "ifc_ready_job_id": "...",
  "external_model_version_id": "...",
  "local_path": "/workspace/storage/ifc-cache/<jobId>/source.ifc",
  "host_local_path": "C:\\Repos\\...\\storage\\ifc-cache\\<jobId>\\source.ifc",
  "source_ifc_ref": "..."  // fallback
}
```

streaming-server 設 `STORAGE_HOST_ROOT` env 把 container path 轉成 host path。

### 4.3 邊界文字 carve-out(`AGENTS.md` §3.4 + coordinator CLAUDE.md MUST NOT)

```
> 例外(2026-05-21 fast-ifc-link-demo-loop):允許 coordinator 在 ifc-ready intake
> 同步階段,將外部 IFC 下載至本地 shared volume 路徑
> `storage/ifc-cache/<ifc_ready_job_id>/source.ifc`,作為 dispatch streaming-server
> 前的臨時通道快取。coordinator 不視為該 IFC bytes 的資料權威;權威仍屬外部公司
> 雲端 control-plane(`external_model_version_id` 參照),streaming-server 為
> conversion authority。
```

### 4.4 `/ui` 重做(3 卡片單欄垂直)

```
+--------------------------------------------------------------+
| BIM 審查雲端 / 快速 Demo                                       |
+--------------------------------------------------------------+
| ① 提交 IFC source(模擬外部 ifc-ready)                       |
|    ifc_path  [_________________________________________]      |
|    project_id [____]  version [____]  task_id [____]         |
|    [ 送出 ifc-ready ]                                         |
+--------------------------------------------------------------+
| ② 下載 + 轉檔進度(每 5s 自動 polling)                       |
|    ● download_status:  downloaded                            |
|    ● conversion_status: running (45s)                       |
|    ● viewer_open_ready: false                                |
+--------------------------------------------------------------+
| ③ 開啟 viewer                                                 |
|    viewer_url:  http://192.168.10.105:8004/ui/open?...       |
|    [ 複製 ]  [ 開啟 viewer ]                                  |
+--------------------------------------------------------------+
```

完全替換現有 5 卡 + 互動實驗室 + raw API/Socket 區。

### 4.5 viewer 重做(query-string auto-attach + 全螢幕)

`web-viewer-sample/src/main.tsx`:解析 `?session=lwv_xxx` → 跳過 NVIDIA Forms,直接走 auto-attach helper → GET coordinator `/api/local-web-view/sessions/{id}` → 拿 stream config → render `<AppStream>`。

`App.tsx` / `AppStream.tsx`:全螢幕版面
- headerHeight 36px,bottom 36px HUD
- video element 填中央
- top HUD:project name + session id + 重連
- bottom HUD:kit instance id + WebRTC status + fps + diagnostic

### 4.6 Postman collection

`docs/postman/fast-ifc-link-demo.postman_collection.json`(v2.1)

```
├── Submit ifc-ready         POST  {{coordinator_base_url}}/api/external/ifc-ready
│                            Body: worker compat
│                            Tests: assert 200; capture ifc_ready_job_id
│                            Timeout: 600s
├── Poll ifc-ready job       GET   .../api/external/ifc-ready/{{ifc_ready_job_id}}
│                            Tests: viewer_url null → setNextRequest(self) + 5s sleep
│                                    else capture viewer_url + stop loop
└── Open viewer (info only)  GET   {{viewer_url}}
                             Pre-request: console.log viewer_url
                             (使用者手動打開,或 mcp__claude-in-chrome 接力)
```

Environment:`coordinator_base_url`、`webhook_secret`、`ifc_path`、`project_id`、`version`、`task_id`

`docs/postman/README.md`:導入步驟、環境設定。

### 4.7 OpenSpec spec deltas(預估)

- `local-coordinator-ifc-ready-intake-boundary` MODIFIED:sync-download requirement + response body fields + viewer_url surfacing in job GET
- `conversion-webhook-lifecycle` MODIFIED:dispatch payload includes `local_path` / `host_local_path`
- `demo-fast-mvp-orchestration` MODIFIED:3 步 runbook + Postman collection
- `documentation-source-of-truth` MODIFIED:邊界 carve-out 寫入

---

## 5. /goal Acceptance condition

```yaml
goal_id: fast-mvp-loop  # 涵蓋兩個 change
predecessor_chain:
  - Change 1: remove-conflict-review-from-fast-mvp (predecessor)
  - Change 2: fast-ifc-link-demo-loop (successor, gated)

acceptance (all true):
  Change 1 archived:
    - PR merged + squash commit on main
    - openspec/changes/archive/<date>-remove-conflict-review-from-fast-mvp/ exists
    - openspec/specs/review-session-request-lifecycle/spec.md merged delta
    - npx openspec validate --specs --strict → all pass
    - historical roadmap-era docs updated (current product requirements now live in docs/plans/ai-bim-governance-設計規格.md + docs/plans/ai-bim-governance-prototype.html)

  Change 2 land + archived:
    - PR merged
    - openspec/changes/archive/<date>-fast-ifc-link-demo-loop/ exists
    - openspec/specs/ 對應 capability 更新
    - npx openspec validate --specs --strict → all pass
    - roadmap synced

  end-to-end happy path (Change 2 後):
    - L1: 所有 npm/python test 綠
    - L2: openspec strict 綠
    - L3: gitnexus_impact 全 LOW/MEDIUM、detect_changes 影響面 = expected
    - L4: docker compose up 後 viewer container 只 listen 127.0.0.1:5173,
           coordinator 0.0.0.0:8004,49100/49101 host-native 仍 listen
    - L5 (mcp__claude-in-chrome 自動化):
        - navigate /ui → 看到 3 卡單欄
        - 填 ifc_path + project_id + version + task_id,點「送出 ifc-ready」
        - 卡 2 polling 顯示 downloaded → ready
        - 卡 3 viewer_url 出現,點「開啟 viewer」自動跳轉
        - viewer 進入全螢幕 stream + HUD
        - console 無 unhandled error
        - gif_creator 錄整段 → 附 PR description
        - Postman collection runner 獨立跑通一次

stop_conditions (中斷給人類):
  - GitNexus impact HIGH/CRITICAL
  - 邊界 carve-out 引發 reviewer 異議
  - 連續 N 次 auto-fix 失敗無明確 root cause
  - 真實 IFC 來源 (192.168.20.x) 不可達且使用者沒授權替代 fixture
```

`/goal` 預期使用方式(SKILL.md 未找到,以下為假設;真實 schema 在 implementation 階段 align):

```
/goal fast-mvp-loop
# 或
/goal "從 docs/superpowers/specs/2026-05-21-fast-mvp-loop-overall-design.md §5 acceptance 為終止條件"
```

---

## 6. Memory references

- `kit-gpu-render-needs-windows-native`:streaming-server 必須 host-native
- `webrtc-1on1-entrypoint-via-coordinator-ui`:viewer 是 1:1 endpoint 不可暴露 → 本 design 落實為 `compose.host-kit.yml` 127.0.0.1 bind + viewer_url 走 coordinator redirect
- `agent-full-automation-during-implementation`:implementation 階段 agent 一路操作,deny 換等價路徑
- `opsx-skill-placeholder-bug`:部分 opsx skill 的 bash hook 壞掉 → 手動跑底層 CLI
- `opsx-worktree-closeout-gotchas`:gh pr merge 從 worktree exit=1 但 merge 成功;GitNexus detect-changes 看不到 linked worktree staged → 用 git diff --stat 佐證
- `gitbash-windows-bat-invocation`:.bat 走 .ps1 wrapper + Start-Process 完整路徑

---

## 7. Brainstorming session 紀錄

- Visual Companion offer:使用者打開 viewer 截圖,但實際 visual companion 未啟用;設計全程文字 / ASCII 進行
- 提出的關鍵設計問題與選擇:
  1. ifc-ready 下載:**A 同步下載完才回 200**(其他選項:async + GET polling、streaming-server 自己拉)
  2. viewer URL 取得:**A Postman 輪詢 GET job URL 到 viewer_url 出現**(其他:callback URL、長 hold sync)
  3. 衝突檢討刪除:**A 直接刪 code 乾淨不可逆**(其他:feature flag、archive folder)
  4. viewer 介面:**A 全螢幕 stream + 邊框 HUD**(其他:三欄保留 minus 衝突檢討、極簡無 HUD)
  5. `/ui` 介面:**A 單欄垂直流程 + 試控台 + polling + viewer 連結卡**(其他:現有卡片 minus 衝突檢討、儀表板)
  6. IFC handoff:**A Shared volume**(其他:stream-through、coordinator 不下載)
  7. 預設 design 段(viewer URL token、viewer 127.0.0.1 bind、bim-control 真實對接):皆採 fast MVP 簡化版,review 時可推翻
- Approach 選擇:**B 兩個小 change 序列依賴**
- Spec storage:**OpenSpec change folder**(本檔為 brainstorming 副產品)

---

## 8. Next steps

- [x] 8.1 brainstorming Section 1 / 2 / 3 設計核可
- [x] 8.2 spec storage 決定:OpenSpec change folder
- [x] 8.3 Change 1 OpenSpec change folder 落地(proposal / design / tasks / spec delta)
- [x] 8.4 本檔 overall design doc 落地
- [ ] 8.5 等使用者 review 整份 brainstorming spec(本檔 + Change 1 OpenSpec change folder)
- [ ] 8.6 brainstorming skill 規定 → invoke `writing-plans` skill(brainstorming terminal state)
- [ ] 8.7 `/goal` 啟動 Change 1 implementation(由 agent 全程自動跑到 archive)
- [ ] 8.8 Change 1 archived → 切 Change 2 worktree → 重複 brainstorming → writing-plans → `/goal`
- [ ] 8.9 兩 change 全 archived + roadmap synced + fast MVP loop end-to-end demo 通 → goal 達成
