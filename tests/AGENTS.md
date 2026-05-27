# tests/ Agent Rules

本檔是 `tests/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`tests/` 是 **root-level contracts + test-only fakes** —— B 方案閉環的最後一道 verify gate。它驗證外部平台 contract（公司雲端 bim-control / 客戶落地端 IFC Worker）與本 repo 的整合行為，並提供 test-only 替身讓本機驗證可以跑起來；它不是 runtime profile。

入口指令：

```powershell
.\.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider
```

## Owns

- `tests/contracts/` — 對外部平台的 contract test（IFC-ready intake、callback 等）
- `tests/fakes/` — `fake-bim-control` / `fake-edge-worker` 等 test-only 替身
- root-level pytest fixtures / conftest 與 `tests/__init__.py`
- 跨 sub-repo 的 integration smoke（非 unit test）

## Does Not Own

- sub-repo 內部 unit test（屬於各 sub-repo 的 `tests/`）
- runtime profile / production fake（fakes 僅 test-only，不參與 runtime）
- mapping 真實資料（mock 嚴禁覆蓋真 `element_mapping.json` —— 規則見 memory `mapping-fake-vs-real-isolation.md`）

## Required Boundaries

- MUST 走 `.venv\Scripts\python.exe`；不可用系統 Python，否則 user-site packages 會撞 FastAPI / Starlette / uvicorn 版本（規則見 memory `venv-python-required-for-pytest.md`）。
- MUST 使用 `-p no:cacheprovider`，避免 pytest cache 殘留導致跨 service import 污染。
- MUST 標示 fake 屬性：`mock=true` / `allow_fake_mapping=true` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test` 一律當 fake，**不得** 寫入真 `element_mapping.json`。
- MUST NOT 把 contract 改成 follow 實作（contract 是 spec source-of-truth）。
- MUST NOT 在 fakes 內 inline 真實 credentials / token。

## Before Editing

- 先讀目標 `tests/contracts/<name>.py` 或 `tests/fakes/<name>/`。
- 改 contract 行為前 MUST 同步檢查 `docs/contracts/<corresponding>.md` 與相關 sub-repo 對外 API。
- 改 fake 行為前 MUST 確認該 fake 對應的外部系統文件（`docs/contracts/bim-control-fake-api.md` 等）。
- 新增 contract test 時，命名沿用既有 module pattern。

## Verify

```powershell
.\.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider
```

## Done Criteria

- 改動沒有把 `tests/` 變成 runtime profile 或 production fake。
- pytest 全綠或清楚說明哪些 case 未跑、原因為何。
- 若觸及 contract，PR 描述 MUST 列出對應 `docs/contracts/*.md` 是否同步。
- 最終回覆列出 changed files、validation、known risks。
