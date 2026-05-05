# bim-streaming-server Agent Rules

本檔是 `bim-streaming-server/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`bim-streaming-server` 是 Omniverse Kit Runtime / GPU Streaming Server。它負責 USD / USDC stage runtime、viewport rendering、WebRTC video stream、DataChannel JSON command、selection / camera / overlay runtime 操作。

主要 runtime 埠口：WebRTC `127.0.0.1:49100`

## Owns

- USD / USDC stage runtime state
- Kit viewport、camera、visual overlay、selection runtime behavior
- WebRTC video streaming server behavior
- DataChannel scene command handling
- Kit application / extension source in this repo

## Does Not Own

- project / model version / artifact metadata authority
- issue / annotation 長期保存
- review session lifecycle 與多人 collaboration hub
- file body storage
- browser UI

## Required Boundaries

- 載入 USD / USDC 應透過 `_s3_storage` 或 coordinator 提供的 URL / file path，不把大型檔案納入 source。
- runtime state 只代表目前 stream session；若要成為正式審查資料，必須回寫 `_bim-control` 或透過 `bim-review-coordinator`。
- DataChannel payload schema 變更必須同步檢查 `web-viewer-sample` 與 `docs/contracts/streaming-datachannel.md`。
- 不得管理 user auth、project metadata、review session lifecycle、annotation persistence。

## Before Editing

- 先讀 `README.md`、`BUILD.md`、`source/`、`scripts/`、`config/` 與相關 docs。
- Source symbol 改動必須依根目錄 GitNexus 規則先做 impact analysis；HIGH / CRITICAL impact 先停下回報。
- Docs-only 改動不需要 GitNexus symbol impact，除非文件改變 build、deployment、public API 或 operational runbook 行為。
- 不要刪除 `_build/`、`logs/`、`bim-models/` 等本地產物，除非使用者明確要求。

## Verify

低成本 smoke：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-convert-ifc-to-usdc.ps1
```

完整 Kit 驗證依變更範圍選擇：

```powershell
.\repo.bat build
.\repo.bat test
```

workspace 聚合檢查：

```powershell
scripts\verify-all.ps1 -StreamingOnly
```

## Done Criteria

- 變更維持 Kit runtime / streaming server 邊界。
- 相關 smoke、build 或 test 通過，或清楚說明未跑原因。
- Source symbol 改動完成後檢查 GitNexus detect changes 或等效 diff 範圍。
- 最終回覆列出 changed files、validation、known risks。
