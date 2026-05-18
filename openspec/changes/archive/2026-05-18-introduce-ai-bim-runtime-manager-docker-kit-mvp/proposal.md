## Why

使用者要求第一版 MVP 直接改成 Docker container 運作，Kit 以 GPU container 運行，原本本機 host-local 啟動環境取消作為 MVP 驗收路徑。現有 repo 已有 `_worker`、`bim-streaming-server`、coordinator、viewer 邊界，但 README / scripts 仍以 host-local demo 為主。

## What Changes

- 新增 Docker Compose primary runtime。
- 新增 Kit Manager API 與 Kit Manager Web 前端。
- 支援一個 Kit instance 選擇 k 個 `.usdc` 檔案 open / close。
- 新增 GPU Kit container profile。
- 原 host-local runtime 降級為 legacy/debug，不作為 MVP pass evidence。
- 新增 Docker-first smoke / runbook / contract。
- 保持每個新增檔案不超過 500 行，採 class-based service / repository / gateway。

## Non-goals

- 不在第一版完成正式 PPMS API。
- 不在第一版完成多 Kit instance scheduler。
- 不用 host-local Kit 代替 GPU container。
- 不提交 `.usdc`、`.ifc`、`.rvt` 大檔。
