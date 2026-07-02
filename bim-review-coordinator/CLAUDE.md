# bim-review-coordinator — Claude Mirror Entry

本檔是 sibling [`AGENTS.md`](AGENTS.md) 的 Claude 鏡像入口。完整規則（七段 schema、collaboration handler 退役狀態、ifc-cache carve-out、權威歸屬表）以 sibling `AGENTS.md` 為準；衝突時依根目錄 `CLAUDE.md` §1 優先序解析。

重點：唯一對外 IFC-ready intake（`POST /api/external/ifc-ready`，Service auth + idempotency）+ Session Control Plane + metadata-only callback outbox（`localhost:8004` 含 Socket.IO）。不渲染 3D、不存大型模型 byte（`storage/ifc-cache/` 臨時通道除外）、不當 metadata 權威；governance 一律經 `/api/governance/*` proxy。完整跨 repo 邊界見根目錄 [`docs/agents/repo-boundary-detail.md`](../docs/agents/repo-boundary-detail.md) §3.4。

Verify：

```bash
npm run verify   # = npm run build && npm test
```
