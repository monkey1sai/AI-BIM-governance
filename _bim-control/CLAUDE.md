# _bim-control — Local Boundary Rules

> 完整跨 repo 邊界見根目錄 `AGENTS.md` §3.1, §4, §7。
> 此檔只列「在此 repo 工作時必須遵守的最小規則」。

## Role

Fake BIM Data Authority — 假 BIM 主平台 metadata 層，提供 project / model version / artifact / issue / annotation / mapping metadata。

埠口：`localhost:8001`

## MUST

- 所有 metadata 寫入必須是「資料描述 + 關聯關係」，例如 `model_version_id`、`artifact_id`、`file_url`、`issue_id`、`ifc_guid`、`usd_prim_path`。
- 變更 API schema 前必對齊 `docs/contracts/` 下的 BIM control contract，並同步更新測試 fixture。
- 提交前跑 `python -m pytest tests -q`（即 `verify` 入口）。

## MUST NOT

- ❌ 引入 Omniverse / `pxr` / `omni.*` 套件。
- ❌ 處理 WebRTC / DataChannel / GPU runtime。
- ❌ 保存大型 binary（IFC / RVT / USD bytes）— 檔案本體屬於 `_s3_storage`。
- ❌ 主動推播多人協作事件（presence / selection / annotation broadcast）— 那是 `bim-review-coordinator` 的責任。
- ❌ 讀寫其他 repo 的 source 路徑。

## Verify 入口

```bash
python -m pytest tests -q
```

或於 workspace 根目錄跑 `scripts/verify-all.{ps1,sh}` 一次驗證所有 repo。

## 權威歸屬

| 資料 | 此 repo 角色 |
|---|---|
| project / version / artifact metadata | **owner** |
| issue / annotation metadata | **owner** |
| element_mapping metadata（不含檔案 body） | **owner** |
| IFC / USD 檔案 body | 不擁有，由 `_s3_storage` 提供 URL |
| 3D runtime state | 不擁有，由 `bim-streaming-server` 處理 |
| session / collaboration state | 不擁有，由 `bim-review-coordinator` 處理 |
