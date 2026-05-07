# bim-review-coordinator — Local Boundary Rules

> 完整跨 repo 邊界見根目錄 `AGENTS.md` §3.3, §5, §7.4。
> 此檔只列「在此 repo 工作時必須遵守的最小規則」。

## Role

Session / Collaboration Control Plane — review session 協調中心；協調 browser client 與 Kit streaming server 的連線資訊；廣播 presence / selection / annotation 等多人事件；查詢路由 `_bim-control` 與 `_worker`。

埠口：`localhost:8004`（含 Socket.IO）

## MUST

- 所有跨 repo 資料查詢都要走此 service 對外的 REST，不讓 `web-viewer-sample` 直連 `_bim-control` / `_worker`。
- Session lifecycle 事件（create / join / leave / dispose）必須由本服務集中管理。
- API / Socket.IO event schema 變更必同步 `docs/contracts/` 下對應 contract，並更新 `tests/` fixture。
- 提交前跑 `npm run verify`（= `npm run build && npm test`）。

## MUST NOT

- ❌ 渲染 3D / 開啟 USD stage / 處理 GPU。
- ❌ 直接保存大型模型檔案 byte（屬於 `_worker`）。
- ❌ 取代 `_bim-control` 成為 metadata 權威（本服務只查詢與轉發，不持久化 review metadata）。
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
| project / artifact metadata | **caller**（owner 在 `_bim-control`） |
| file URL | **caller**（owner 在 `_worker`） |
| 3D runtime state | 不參與（owner 在 `bim-streaming-server`） |
