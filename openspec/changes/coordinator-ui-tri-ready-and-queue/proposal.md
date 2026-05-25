## Why

2026-05-25 fast MVP session/artifact binding 討論筆記:`bim-review-coordinator`
`/ui` runtime dashboard 目前把 conversion / model / WebRTC ready 都用單一 `ready`
描述,operator 難以分辨 stage matched 是否等同於 IFC 語意正確。同時,並發 ifc-ready
POST(由 C4 序列化 dispatch)的等待中清單目前沒有可視化入口。
歷史 demo step 文案仍偏「審查 demo」語境,未對齊 fast MVP 收斂後的 Edge BIM Data
Server Console 定位。

## What Changes

- 修改 `bim-review-coordinator/src/public/dev-console.html`(`/ui` 後端 HTML 模板):
  - 加三段 ready 顯示(File / Runtime / Semantic)與 viewer 對齊
  - 加 Conversion Dispatch Queue 區段:顯示 in-flight + queued 列表 +
    queue_position(資料來源 = `GET /api/external/ifc-ready` job list,filter
    by status `queued_for_conversion` / `converting` / `dispatched`)
  - Step 文案改為(① 接收 IFC-ready webhook ② 產生本機 USDC 資料包
    ③ 啟動 Kit/WebRTC 串流 ④ 驗證 BIM 語意對照)
  - Legacy `/api/assets` 區加 disclaimer「此區為舊 demo asset,**不代表** 當前
    session model」
- 三段 ready 計算規則必須與 `session-first-review-viewer` 的 viewer 端一致
  (同一 `quality_metrics_summary` 欄位來源 + 同一判定邏輯)
- 不改 `/ui` 後端 API 路由形狀;只擴 dashboard render 與顯示文案
- 不引入新 coordinator runtime 行為

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `demo-fast-mvp-orchestration`:
  - MODIFY 既有 requirement「Coordinator /ui provides closed-loop runtime
    dashboard」加 scenario:dashboard 顯示 File / Runtime / Semantic 三段
    ready 標籤;legacy `/api/assets` 顯示時必須帶 disclaimer
  - ADD requirement「Coordinator /ui dashboard surfaces three-tier readiness」
    要求三段判定規則寫入 spec,並與 viewer 計算一致
  - ADD requirement「Coordinator /ui dashboard renames demo steps」
    要求 ① / ② / ③ / ④ 四步驟文案
  - ADD requirement「Coordinator /ui dashboard shows conversion dispatch queue」
    要求 in-flight + queued 區別、queue_position、dropped_on_restart 提示

## Impact

- Owner repo / folder:
  - `bim-review-coordinator/src/public/dev-console.html`
  - `bim-review-coordinator/tests/dev-console.test.ts`(若有)
  - `openspec/changes/coordinator-ui-tri-ready-and-queue/`
- Runtime boundary:不改 streaming-server / viewer / callback outbox / dispatch
  worker;coordinator runtime 行為不變,只更新 `/ui` HTML 模板。
- API:不新增 endpoint;`/ui` consumes 現有 `GET /api/external/ifc-ready` 與
  `GET /api/external/ifc-ready/:id`。三段 ready 從 `stream_config.quality_metrics_summary`
  + `model.status` 等既有欄位推導(C1 提供新欄位)。
- Data:無持久化變化。
- Dependencies:無新增。
- Non-goals:
  - 不改 `/ui` API 路由
  - 不引入 React / SPA framework(維持 vanilla HTML / inline JS)
  - 不還原 issue / annotation / multi-user UI
  - 不改 coordinator dispatch / queue runtime 行為(屬 C4)
  - HTML view dashboard 不取代 operator runbook
