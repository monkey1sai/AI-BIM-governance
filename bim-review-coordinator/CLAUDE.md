# bim-review-coordinator — Local Boundary Rules

> 完整跨 repo 邊界見根目錄 `AGENTS.md` §1.A、§10、§11。
> 此檔只列「在此 repo 工作時必須遵守的最小規則」。

## Role

IFC-ready Intake / Callback Outbox / Session Control Plane — 唯一外部 IFC-ready intake；協調 browser client 與 Kit streaming server 的連線資訊；廣播 presence(`joinSession` / `leaveSession` / `presenceUpdated`)等基本 session 事件；將 streaming conversion 結果放入 metadata-only callback outbox。

> **退役狀態(2026-05-21,change `remove-conflict-review-from-fast-mvp`)**:
> `highlightRequest` / `selectionUpdate` / `annotationCreate` 等 collaboration
> Socket.IO event handlers 已從本 service 移除(`src/socket/reviewNamespace.ts`);
> `getReviewIssues` / `createAnnotation` / `/api/model-versions/:id/review-bootstrap`
> 也已刪。`/api/review-sessions/:id/events` 與 `/lifecycle-events` 仍保留;
> lifecycle endpoint 排除 collaboration event 的語意 wording 保留作 archive
> compatibility(舊 event log 仍可能含這些 type)。

埠口：`localhost:8004`（含 Socket.IO）

## MUST

- 外部 IFC-ready 只進 `POST /api/external/ifc-ready`；internal conversion result / callback outbox 端點必須使用 internal token。
- Session lifecycle 事件（create / join / leave / dispose）必須由本服務集中管理。
- API / Socket.IO event schema 變更必同步 `docs/contracts/` 下對應 contract，並更新 `tests/` fixture。
- 提交前跑 `npm run verify`（= `npm run build && npm test`）。

## MUST NOT

- ❌ 渲染 3D / 開啟 USD stage / 處理 GPU。
- ❌ 直接保存大型模型檔案 byte（屬於 streaming/data-plane artifact storage）。
- ❌ 取代外部公司雲端 control-plane 成為 metadata 權威（本服務只保存最小 shadow metadata）。
- ❌ 取代 `web-viewer-sample` 成為 UI（本服務不渲染畫面、不送 view-layer 樣式）。
- ❌ 引入 Omniverse / `pxr` / `omni.*` 套件。
- ❌ 直接控制 Kit 進程的 viewport / camera / material（runtime 操作必須透過 DataChannel 由 `web-viewer-sample` 發出，或由 streaming server 自治）。

## Verify 入口

```bash
npm run verify
```

## 權威歸屬

| 行為 | 此 repo 角色 |
|---|---|
| review session state | **owner** |
| presence / selection broadcast | **owner** |
| stream config 給 viewer | **owner** |
| external IFC-ready intake | **owner** |
| cloud callback outbox | **owner** |
| project / artifact metadata | **reference only**（owner 在外部公司雲端 control-plane） |
| file / conversion body | **不擁有**（owner 在 `bim-streaming-server` / 外部 artifact store） |
| 3D runtime state | 不參與（owner 在 `bim-streaming-server`） |
