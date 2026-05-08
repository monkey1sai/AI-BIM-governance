## Context

`docs/verification/2026-05-08-spec-end-to-end-verification.md` 已完成兩個 spec 的主要 control-plane / viewer 驗證，但剩餘項目跨越不同 runtime 條件：

- 不需要 GPU 的 `bim-streaming-server` DataChannel stage-loading contract smoke。
- 需要有效幾何 IFC / USD 與 NVIDIA Kit runtime 的單一 viewport 實際渲染。
- 需要兩個以上 Kit instance 的 `dedicated_instance` routing 實機並行 stream。
- 需要較大 fixture 與負載工具的大型 IFC / Socket.IO stress evidence。

這些不是同一種驗證，若不分層記錄，容易把 hardware-blocked 項目誤判成 OpenSpec 未完成，也容易把只有 header 的 smoke fixture 誤當成實際 3D render evidence。

## Goals / Non-Goals

**Goals:**

- 把 runtime verification 拆成可重跑、可判定、可跳過且可審查的 evidence tiers。
- 補上目前最小可執行的 non-GPU stage-loading contract smoke。
- 明確定義 GPU viewport render 的有效模型前置條件與截圖 / video readiness 證據。
- 明確定義 `dedicated_instance` routing 的多 Kit topology 前置條件。
- 明確定義大型 IFC 與 Socket.IO concurrency 的門檻與報告格式。
- 保留各 repo 的責任邊界，不讓 viewer、coordinator、worker 或 streaming server 互相取代。

**Non-Goals:**

- 不修改 REST API、Socket.IO event、WebRTC negotiation 或 DataChannel payload。
- 不新增 production dependency。
- 不把 retired `_s3_storage`、`_conversion-service`、`_conversion-server` 加回 current runtime。
- 不要求 Cloud VM 或無 GPU 環境通過 Kit viewport render。
- 不在這個 change 內實作多 Kit instance launcher；此 change 只定義驗證 contract 與 follow-up 任務。

## Decisions

### Decision 1: Use evidence tiers instead of one binary E2E status

Runtime evidence 分成四層：

1. `contract`: 不需要 GPU，例如 `bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1`。
2. `single_kit_render`: 需要一個 Kit instance、有效幾何模型、browser video readiness 與 screenshot。
3. `multi_kit_routing`: 需要兩個以上 Kit instance 與不同 signaling ports。
4. `stress`: 需要大型 IFC fixture 或多 Socket.IO client workload。

替代方案是維持單一 E2E checklist，但它無法區分「沒跑」、「環境不具備」與「系統失敗」。

### Decision 2: Treat valid geometry as a render prerequisite

Kit viewport render evidence MUST NOT 使用只有 `ISO-10303-21` header 的 minimal smoke IFC。有效 evidence 需要至少有可渲染幾何的 IFC 或現成 USD / USDC，並記錄該 fixture 的來源、大小、artifact URL 與 session id。

替代方案是沿用 existing smoke fixture，但它只能證明 API chain，不足以證明 viewport render。

### Decision 3: Keep `local_fixed` single-instance behavior honest

在 `kit_profile.provider=local_fixed` 且只有 signaling `49100` 的環境中，第二個 viewer 撞到 GPU busy / already streaming 不能視為 `dedicated_instance` routing failure。多 Kit routing 只有在 coordinator 可註冊兩個以上 Kit instance 時才可判定。

替代方案是在單 instance 環境硬測兩個 tab，但這只能重現容量限制，不能驗證 dedicated routing。

### Decision 4: Record blocked evidence explicitly

每個硬體或負載相依項目都要記錄 `status=blocked`、缺少的前置條件與下一步，而不是留下模糊的「未驗證」。這讓 PR reviewer 可判斷目前 change 是否可接受，並避免下次重跑已知不可能通過的步驟。

## Risks / Trade-offs

- [Risk] 驗證文件變成流程文件而不是可執行測試 → Mitigation: 每個 requirement 都要求明確命令、前置條件、成功標準與 evidence location。
- [Risk] GPU / Kit 驗證在不同 Windows machine 上結果不穩 → Mitigation: 記錄 Kit profile、signaling port、fixture、session id、video readiness 與 screenshot，不只記錄「看起來成功」。
- [Risk] 多 Kit routing 被誤認為已由 unit tests 完整覆蓋 → Mitigation: unit tests 只算 control-plane evidence；實機並行 stream 需要 `multi_kit_routing` evidence tier。
- [Risk] 大型 IFC 壓力測試拖慢一般 PR → Mitigation: stress tier 不納入最小 PR gate，除非該 PR 修改 conversion、readiness 或 Socket.IO fanout 行為。

## Migration Plan

1. 新增 runtime verification evidence spec。
2. 後續 apply 時更新 verification report 或新增 follow-up report，把每個未驗證項目改成 `passed` / `blocked` / `deferred` 並附前置條件。
3. 先補跑 non-GPU contract smoke；GPU / stress evidence 在具備環境與 fixture 時再補。

Rollback 方式：撤回此 OpenSpec change 的新增 artifacts，不影響 production runtime。

## Open Questions

- 有效幾何 IFC fixture 要使用 repo-local sample、外部客戶樣本，或由 Kit/USD toolchain 產生 synthetic sample？
- 多 Kit instance 啟動腳本要放在 `bim-streaming-server/scripts/`，還是由 root `scripts/` 協調多服務啟動？
- Socket.IO stress 的最低門檻要訂為 10、25 還是 50 clients？
