# web-viewer-sample — Claude Mirror Entry

本檔是 sibling [`AGENTS.md`](AGENTS.md) 的 Claude 鏡像入口。完整規則（七段 schema）以 sibling `AGENTS.md` 為準；衝突時依根目錄 `CLAUDE.md` §1 優先序解析。

重點：Browser Client / EdgeConsole UI（dev `127.0.0.1:5173`；正式產品入口是 coordinator `:8004/ui`）。session / metadata / file URL 一律經 `bim-review-coordinator`，不得讓瀏覽器直連 governance `:49102` 等 internal loopback；與 streaming server 的互動限 WebRTC video + DataChannel JSON command；不啟停 Kit、不轉檔、不在前端保存權威資料（顯示用 cache OK）。Codex 執行防呆：本 repo `.codex/config.toml` 為 project-level guardrail，sandbox 寫入限本 repo root。完整跨 repo 邊界見根目錄 [`docs/agents/repo-boundary-detail.md`](../docs/agents/repo-boundary-detail.md) §3.6。

Verify：

```powershell
npm run verify   # = npm run build && npm test && npm run test:struct-log
```
