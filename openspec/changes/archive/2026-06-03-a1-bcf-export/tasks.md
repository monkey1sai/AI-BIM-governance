## 1. Preflight

- [x] 1.1 確認 `bcf-client` 為 GPLv3（importlib.metadata）→ 決定純 stdlib 自寫，不 import。
- [x] 1.2 branch `codex/openspec/a1-bcf-export`（stacked 於 a1-ids-import）。

## 2. Tests First

- [x] 2.1 `build_bcfzip` 結構：`bcf.version`=2.1、markup.bcf Topic（TopicStatus）、viewpoint.bcfv Component `IfcGuid`。
- [x] 2.2 rule 10：annotation / 無 guid / 空 guid 皆排除；空清單 → count 0。
- [x] 2.3 status 映射（resolved→Closed）；API 端點 200 + 404（無正式 issue）。

## 3. Core

- [x] 3.1 `bcf/bcf_writer.py`：純 stdlib zipfile + xml.etree 產 BCF 2.1。
- [x] 3.2 `bcf/api.py` + `__init__.py`；`app.py` 掛載 + `fmt=bcf` 改 400 導引。

## 4. 前端 + proxy

- [x] 4.1 coordinator `GET /api/governance/bcf/export` 二進位透傳。
- [x] 4.2 governanceClient `bcfExportUrl` + Issue Center「匯出 BCF 2.1」按鈕（blob 下載 + 404 誠實訊息）。

## 5. Validation

- [x] 5.1 BCF 測試（8）通過。
- [x] 5.2 全套 pytest（40）+ viewer vitest（38）+ vite build + coordinator build/test（273）。
- [x] 5.3 `npx openspec validate a1-bcf-export --strict` → valid。

## 6. Closeout

- [ ] 6.1 commit + PR（stacked 於 a1-ids-import PR）。
- [ ] 6.2 merge 後 archive。
