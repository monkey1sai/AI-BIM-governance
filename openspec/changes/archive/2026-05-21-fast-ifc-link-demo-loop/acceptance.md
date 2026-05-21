# Acceptance — fast-ifc-link-demo-loop

> `/goal` 終止條件 — 全 true 才視為達成。任一 stop_condition 觸發 → 中斷給人類。

```yaml
goal_id: fast-ifc-link-demo-loop
predecessor_required: remove-conflict-review-from-fast-mvp (already archived 2026-05-21 by PR #90/#91)

acceptance (all true):

  spec_layer:
    - openspec/changes/fast-ifc-link-demo-loop/{proposal,design,tasks,acceptance}.md 完整
    - openspec/changes/fast-ifc-link-demo-loop/specs/<cap>/spec.md 4 個 capability MODIFIED 寫好
    - `npx openspec validate fast-ifc-link-demo-loop --strict` valid
    - `npx openspec validate --specs --strict` all pass

  code_layer:
    coordinator:
      - POST /api/external/ifc-ready 同步下載完成才回 200;body 含 download_status:"downloaded", message, ifc_ready_job_id, conversion_job_id, conversion_status:"queued"
      - 失敗 → 502 download_failed
      - Idempotent replay 既存 job 直接 200 reuse,不重下、不重派工
      - GET /api/external/ifc-ready/{jobId} 含 download_status / conversion_status / viewer_url / web_view_session_id
      - conversion ready 時 coordinator 自動 spawn local-web-view session,viewer_url 非 null
      - GET /ui/open?session= 302 redirect 到 http://127.0.0.1:5173/?session=
      - dev-console.html 為 3 卡單欄垂直(① 提交 / ② 進度 / ③ 連結)
      - 不再有 highlight/selection/annotation 跡象(Change 1 已 ensure)
    viewer:
      - main.tsx 解析 ?session=lwv_xxx 自動 attach
      - App.tsx / AppStream.tsx 改全螢幕 + top/bottom HUD
      - 沒 session → 顯示 static entry prompt(不 fallback NVIDIA Forms)
    shared volume:
      - coordinator container 寫 /workspace/storage/ifc-cache/<jobId>/source.ifc
      - streaming-server (host-native) 讀同一 host 路徑(host_local_path / STORAGE_HOST_ROOT)
    postman:
      - docs/postman/fast-ifc-link-demo.postman_collection.json (v2.1) 存在
      - docs/postman/README.md 寫好導入 + 環境設定
    docs / boundary:
      - AGENTS.md §3.4 carve-out 寫入
      - bim-review-coordinator/CLAUDE.md MUST NOT carve-out 寫入

  verify_layer:
    L1 (unit):
      - coordinator npm run verify pass
      - viewer npm run build + test:session-first pass
      - root pytest pass
      - streaming pytest pass(含新 local_path / host_local_path 處理)
    L2 (spec):
      - openspec strict pass(change + 全 specs)
    L3 (graph):
      - gitnexus_impact 對所有改動 symbol → 無 HIGH/CRITICAL
      - gitnexus_detect_changes → 影響面 = expected
    L4 (container/network):
      - docker compose up coordinator viewer 兩 container Up
      - netstat: 5173 只 127.0.0.1, 8004 仍 0.0.0.0
      - host-native 49101 + 49100 仍 listen
      - docker exec coordinator node -e fetch /health → 200
      - container 內 fetch POST /api/external/ifc-ready(用本機 fixture)→ 200 download_status:downloaded
      - polling GET .../{jobId} → 最終 viewer_url 非 null(needs streaming real run + fixture)
      - curl /ui/open?session=lwv_test → 302 to 127.0.0.1:5173
    L5 (mcp__claude-in-chrome real UI):
      - navigate /ui → 3 卡單欄
      - form_input 填 ifc_path/project_id/version/task_id
      - click「送出 ifc-ready」
      - 卡 ② polling 顯示 downloaded → ready
      - 卡 ③ viewer_url 出現,click「開啟 viewer」自動跳轉
      - viewer 進入全螢幕 stream + HUD
      - console 無 unhandled error
      - gif_creator 錄整段 → 附 PR description
      - Postman collection runner 獨立跑通(若 Postman 可用)

  workflow_layer:
    - branch codex/openspec/fast-ifc-link-demo-loop pushed
    - PR opened (繁中 title + description + gif)
    - GitHub Actions CI 全綠
    - Reviewer approves
    - PR merged
    - openspec/changes/archive/<date>-fast-ifc-link-demo-loop/ archived
    - openspec/specs/ 對應 capability 更新(4 個)
    - docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md 同步(AGENTS.md §1.6)
    - .worktrees/fast-ifc-link-demo-loop closeout

stop_conditions (中斷給人類):
  - GitNexus impact HIGH/CRITICAL,且影響非 expected scope
  - 邊界 carve-out 引發 reviewer 異議
  - 連續 N 次 auto-fix 失敗無明確 root cause(N=3)
  - 真實 IFC 來源 MinIO 192.168.20.234 不可達,且使用者沒授權替代 fixture(implementation 用本機 storage/許良宇圖書館建築_2026.ifc 作 fixture 替代)
  - streaming-server host-native 起不來(WSL Kit graphics blocker 已知 — 不阻擋本 change merge,但 L5 full happy path 標 deferred)
  - L5 mcp__claude-in-chrome navigate 被 deny → 改用 L4 container fetch 字串斷言 + Postman manual run 代替(同 predecessor 處理)
```
