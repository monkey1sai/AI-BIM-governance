# bim-streaming-server — Claude Mirror Entry

本檔是 sibling [`AGENTS.md`](AGENTS.md) 的 Claude 鏡像入口。完整規則（七段 schema）以 sibling `AGENTS.md` 為準；衝突時依根目錄 `CLAUDE.md` §1 優先序解析。

重點：Omniverse Kit Runtime / GPU Streaming Server + B 方案 IFC→USDC conversion authority（WebRTC `127.0.0.1:49100`、conversion `:49101`）。runtime state 只代表當前 stream session——要成為正式審查資料必須經 `bim-review-coordinator` 或外部公司雲端 control-plane；metadata 查詢一律走 coordinator，本服務不管理 session lifecycle、不持久化 annotation / issue、不當檔案倉庫。DataChannel payload schema 變更必同步 `web-viewer-sample` 與 `docs/contracts/streaming-datachannel.md`。完整跨 repo 邊界見根目錄 [`docs/agents/repo-boundary-detail.md`](../docs/agents/repo-boundary-detail.md) §3.5。

Verify（低成本 smoke）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-stage-loading-contract.ps1
```

完整驗證：`.\repo.bat build` / `.\repo.bat test`；workspace 聚合：`scripts\verify-all.ps1 -StreamingOnly`。
