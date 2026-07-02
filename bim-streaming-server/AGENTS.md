# bim-streaming-server Agent Rules

本檔是 `bim-streaming-server/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`bim-streaming-server` 是 Omniverse Kit Runtime / GPU Streaming Server，也是 B 方案中的 IFC→USDC conversion authority。它負責 IFC→USDC job authority、USD / USDC stage runtime、viewport rendering、WebRTC video stream、DataChannel JSON command、selection / camera / overlay runtime 操作。

主要 runtime 埠口：WebRTC `127.0.0.1:49100`

## Owns

- USD / USDC stage runtime state
- IFC→USDC conversion job status / result authority under B 方案
- streaming-owned `model.usdc` / `element_mapping.json` / `entity_index.json` / `metadata.json` result payloads
- mapping quality metrics and no-placeholder-ready enforcement for streaming-owned conversion results
- Kit viewport、camera、visual overlay、selection runtime behavior
- WebRTC video streaming server behavior
- DataChannel scene command handling
- Kit application / extension source in this repo

## Does Not Own

- project / model version / artifact metadata authority
- issue / annotation 長期保存
- review session lifecycle 與多人 collaboration hub
- source RVT / IFC file body storage
- browser UI

## Required Boundaries

- 載入 USD / USDC 應透過 streaming-owned conversion result、coordinator artifact binding，或本機測試 file path，不把大型檔案納入 source。
- heavy IFC→USDC conversion 必須走 headless converter app、subprocess 或 worker lane，不得阻塞 live WebRTC viewport runtime。
- runtime state 只代表目前 stream session；若要成為正式審查資料，必須透過 `bim-review-coordinator` 或外部公司雲端 control-plane 形成 metadata / issue / artifact record。
- DataChannel payload schema 變更必須同步檢查 `web-viewer-sample` 與 `docs/contracts/streaming-datachannel.md`。
- 不得管理 user auth、project metadata、review session lifecycle、annotation persistence。
- Conversion / highlight / stage-load 類 user-facing runtime capability 不得只以 server-side/API 測試宣告完成；必須有前端 Review Room / Edge Console 操作與 browser evidence，或明確標為 runtime-only partial。

## Before Editing

- 先讀 `README.md`、`BUILD.md`、`source/`、`scripts/`、`config/` 與相關 docs。
- Source 改動需檢查相關 build、deployment、public API、DataChannel contract 與測試影響。
- Docs-only 改動只需確認文件語意，除非文件改變 build、deployment、public API 或 operational runbook 行為。
- 不要刪除 `_build/`、`logs/`、`bim-models/` 等本地產物，除非使用者明確要求。

## Verify

低成本 smoke：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-stage-loading-contract.ps1
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
- 若改動影響 deploy / runtime / viewer / port / env，必須更新或明確驗證 root `scripts/deploy.ps1` golden path。
- 相關 smoke、build 或 test 通過，或清楚說明未跑原因。
- Source 改動完成後檢查等效 diff 範圍。
- 最終回覆列出 changed files、validation、known risks。
