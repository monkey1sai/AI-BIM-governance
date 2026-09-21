# Repository Boundaries

產品現況的優先順序是 source code、可執行 tests/contracts、`docs/plans/` 目標文件、本協作文件。文件與實作不一致時標記為 implementation gap。

| Owning service | Owns | Must not become |
|---|---|---|
| `bim-review-coordinator` (:8004) | external IFC-ready intake、session/presence、lease policy、browser-facing governance proxy、CFD run ledger 與 `/api/cfd/*` proxy | conversion engine、CFD solver、Kit renderer、issue/BCF data authority |
| `bim-streaming-server` (49100/49101) | IFC→USDC conversion、CFD wind run job（`/api/cfd-runs`、`/cfd-artifacts`；OpenFOAM 容器；run record 權威）、Kit stage/runtime、WebRTC/DataChannel execution | public browser control plane、cloud data authority、規範／標章計算書 |
| `governance-service` (:49102 loopback) | A1/A2/A3 rules、diff/federation、issue/annotation/BCF | public network entrypoint、viewer |
| `web-viewer-sample` (:5173) | browser UI、REST/Socket.IO client、Kit WebRTC/DataChannel client | backend proxy、conversion authority |
| `apps/kit-manager-web` / `services/kit-manager-api` (:8010) | operator UI、fleet operations and telemetry | customer-facing review UI、conversion authority |

## Canonical flow

1. 外部公司雲端是 control-plane；客戶 IFC Worker 通知 coordinator 的 IFC-ready endpoint。
2. Coordinator 驗證與協調 session，再把 conversion 工作交給 streaming server。
3. Streaming server 產生並載入 USDC；browser 透過 coordinator 取得控制資訊，媒體與 runtime 命令直接走 Kit WebRTC/DataChannel。
3b. CFD（`docs/plans/building-energy-cfd-p2-contract.md`，方向 A）：coordinator 以 conversion ledger 綁定 `model.usdc` 雜湊後把 run 交給 streaming 的 CFD job（同時只跑一個，OpenFOAM 容器）；結果 layer 只寫 `/World/Overlays/Cfd/<run_id>`，以既有 `ArtifactBinding(overlay)`＋`loadArtifactGroupRequest` 進 Kit；run record 留在 streaming job store；結果一律 `design_comparison_only`。
4. Governance service 是 rule/diff/issue/BCF 權威，只允許 coordinator 的 browser-facing proxy 對外；CFD 超標項目日後只經既有 `/api/issues` 進入，不新增 governance 路由。
5. 大型 IFC/USDC 不提交到 Git；本機與測試環境 artifact 需保留 provenance。

`tests/fakes/` 與 `tests/contracts/` 只供測試；退役的 `_worker`、`_bim-control` 不得恢復為 runtime service。
