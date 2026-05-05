# _conversion-service — Local Boundary Rules

> 完整跨 repo 邊界見根目錄 `AGENTS.md` §1, §9。
> 此檔只列「在此 repo 工作時必須遵守的最小規則」。

## Role

Conversion Worker API — IFC → USDC 轉檔服務，從 `_s3_storage` 讀取原始檔，產出 USDC + element_mapping，寫回 `_s3_storage` 並更新 `_bim-control` 的 artifact status。

埠口：`localhost:8003`

## MUST

- 轉檔輸出必須包含 `element_mapping.json`（IFC GUID ↔ USD Prim Path）並寫回 `_s3_storage`。
- 完成 / 失敗皆需透過 `_bim-control` 的 artifact status API 回寫狀態。
- 變更 conversion API schema 前對齊 `docs/contracts/conversion-api.md`。
- 提交前跑 `python -m pytest tests -q`（即 `verify` 入口）。

## MUST NOT

- ❌ 直接寫入 `_bim-control` 的 metadata 表（除了 artifact status 這個約定回寫點）。
- ❌ 啟動或控制 Omniverse Kit / WebRTC / GPU runtime。
- ❌ 管理 review session / collaboration / annotation。
- ❌ 直接送 DataChannel command 給 `bim-streaming-server`。
- ❌ 成為檔案儲存權威 — 大檔一律寫回 `_s3_storage`，本服務不長期保存 binary。

## Verify 入口

```bash
python -m pytest tests -q
```

## 權威歸屬

| 行為 | 此 repo 角色 |
|---|---|
| IFC → USDC 轉檔邏輯 | **owner** |
| element_mapping 產生 | **owner** |
| artifact status 回寫 | **caller**（API 在 `_bim-control`） |
| 檔案讀寫 | **caller**（檔案 body 在 `_s3_storage`） |
| review / streaming / runtime | 不參與 |
