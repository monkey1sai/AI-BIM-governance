## Context

`complete-spec-runtime-verification` 的 verification report 已把 single Kit GPU render 與 dedicated multi-Kit runtime 標為 `blocked / not passed`，但 `tasks.md` 仍把捕捉 viewport screenshot、non-zero video frame、multi-Kit concurrent browser readiness 等任務寫成完成。這會讓 OpenSpec CLI 的 `all_done` 被誤讀為 runtime 驗證通過。

目前的真實條件是：

- `_worker.complete_conversion_job()` 仍產出 placeholder `model.usdc`，不能證明真實 IFC 幾何渲染。
- GPU render evidence 需要 Kit stream listener、renderable USD / USDC、browser video readiness、non-zero video frame 或 screenshot。
- Multi-Kit runtime evidence 需要 root `scripts/` 可協調兩個以上 Kit instance，且 signaling ports 必須可區分。
- 現有 root scripts 與 `bim-streaming-server/scripts/start-streaming-server.ps1` 的行為必須作為 re-verification 依據。

## Goals / Non-Goals

**Goals:**

- 修正 review finding 指出的 checklist 語意錯誤。
- 讓 `[x]` 表示「完成了任務描述的工作」，而任務描述必須明確區分 successful validation 與 blocked evidence classification。
- 在更新 tasks 前保留實際查證依據：port 狀態、script topology、worker artifact 性質、verification report 結論。
- 保持 OpenSpec 與 verification report 對 blocked/not passed 的描述一致。

**Non-Goals:**

- 不在此 change 實作真實 IFC->USD/USDC conversion。
- 不新增多 Kit instance launcher。
- 不啟動或恢復 retired `_s3_storage`、`_conversion-service`、`_conversion-server`。
- 不修改 REST API、Socket.IO event、WebRTC negotiation、DataChannel payload、storage schema 或 production runtime code。

## Decisions

### Decision 1: Rewrite ambiguous completed tasks instead of pretending runtime passed

若實際驗證結果是 blocked，task 文字必須寫成 `attempt`、`verify availability`、`record blocker` 或同等語意。這讓 `[x]` 合理代表「blocked evidence 已完成分類」，而不是「GPU render / multi-Kit runtime 成功」。

替代方案是把 blocked tasks 改回 `[ ]`。這也可行，但會讓 OpenSpec apply 永遠顯示未完成，即使這個 change 的目標其實是把 blocker 記錄清楚。對目前 review finding，改寫任務語意比保留 ambiguous unchecked item 更可審查。

### Decision 2: Re-verify environment before resolving findings

修正 tasks 前要核對：

- `49100` / `47998` 是否有 Kit listener。
- Root `scripts/` 是否存在多 Kit orchestration entrypoint。
- `bim-streaming-server/scripts/start-streaming-server.ps1` 是否仍使用固定 streaming ports。
- `_worker` 是否仍產出 placeholder `model.usdc`。
- verification report 是否明確寫出 `blocked / not passed`。

替代方案是只依照 review comment 修改文字，但這無法滿足「請真實驗證」。

### Decision 3: Keep the fix in OpenSpec / documentation boundary

這次修正只改 OpenSpec task semantics 與必要 evidence documentation。production behavior 沒有變，因此不需要 GitNexus symbol impact、API migration 或 runtime dependency 變更。

## Risks / Trade-offs

- [Risk] Reviewer 仍把 `all_done` 當成 runtime pass → Mitigation: tasks 與 verification report 都必須明寫 `blocked/not passed` 與「checkbox only means blocker classified」。
- [Risk] 未來真正完成 GPU / multi-Kit 後沒有更新此段 → Mitigation: successful validation 需要新增或更新 evidence，包含 screenshot / video readiness / distinct Kit endpoint proof。
- [Risk] 新 change 與原 change 疊在同一分支造成流程混淆 → Mitigation: final handoff 必須指出目前有既有 `complete-spec-runtime-verification/tasks.md` 未提交修正與新 `fix-runtime-verification-task-status` artifacts。
