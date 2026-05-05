# _s3_storage — Local Boundary Rules

> 完整跨 repo 邊界見根目錄 `AGENTS.md` §3.2, §4, §7。
> 此檔只列「在此 repo 工作時必須遵守的最小規則」。

## Role

Fake Object Storage — 假本地物件儲存，保存 IFC / RVT / DWG 原始檔、USD / USDC 衍生檔、`element_mapping.json`、fake review/report 檔案。

埠口：`localhost:8002`

## MUST

- 只處理「檔案本體」與 byte-level 操作（上傳 / 下載 / static URL）。
- API 變更必須先確認 `_bim-control` 與 `_conversion-service` 的依賴方有共識。
- 提交前跑 `python -m pytest tests -q`（即 `verify` 入口）。

## MUST NOT

- ❌ 保存任何 business logic（project ↔ artifact 關聯屬於 `_bim-control`）。
- ❌ 管理 user / session / permission。
- ❌ 廣播多人事件、執行 3D runtime 操作、執行轉檔。
- ❌ 引入 Omniverse / `pxr` / `omni.*` 套件。
- ❌ 對檔案內容做語意解析（例如解析 IFC GUID、解析 USD prim tree）— 那是 `_conversion-service` 與 `bim-streaming-server` 的事。

## Verify 入口

```bash
python -m pytest tests -q
```

## 權威歸屬

| 資料 | 此 repo 角色 |
|---|---|
| IFC / RVT / DWG file body | **owner** |
| USD / USDC file body | **owner** |
| element_mapping.json file body | **owner** |
| 上述檔案的 metadata（version / project 關聯） | 不擁有，由 `_bim-control` 處理 |
| 檔案內容的語意（GUID, prim path） | 不擁有 |
