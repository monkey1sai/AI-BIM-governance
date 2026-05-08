## Context

`complete-spec-runtime-verification` 的 verification report 已把 single Kit GPU render 與 dedicated multi-Kit runtime 標為 `blocked / not passed`，但 `tasks.md` 仍把捕捉 viewport screenshot、non-zero video frame、concurrent browser readiness 等任務寫成完成。這會讓 OpenSpec CLI 的 `all_done` 被誤讀為 runtime 驗證通過。

本次修正的方向改為更嚴格：runtime verification 不能只整理 blocker。只要 task 宣稱 GPU render、WebRTC viewport、DataChannel stage load、或 same-Kit concurrent stream 已完成，就必須真的在 GPU-backed Kit runtime 上執行並留下可審查 evidence。

目前的真實條件是：

- `_worker.complete_conversion_job()` 仍產出 placeholder `model.usdc`，不能證明真實 IFC 幾何渲染。
- GPU render evidence 需要 GPU-backed Kit process、Kit signaling / stream listener、renderable USD / USDC、browser video readiness、non-zero video frame 或 screenshot。
- Multi-Kit runtime evidence 需要 root `scripts/` 可協調兩個以上 Kit instance，且 signaling / stream ports 必須可區分並可同時被 browser clients 使用。
- Browser E2E screenshot 需要被保存到 repo-local evidence folder，否則只能算當下觀察，不能算可審查 runtime pass。
- 現有 root scripts 與 `bim-streaming-server/scripts/start-streaming-server.ps1` 的行為必須作為 re-verification 依據。
- 本階段的 concurrent browser readiness 應以單一 Kit process 的 `primaryStream` + `spectatorStream[0]` 驗證；`routing_policy=dedicated_instance` 的多 Kit process capacity 只能作為後續 deployment tier，不作為這階段 pass 條件。

## Goals / Non-Goals

**Goals:**

- 修正 review finding 指出的 checklist 語意錯誤。
- 讓 `[x]` 表示「in-scope runtime tier 已由真實 GPU evidence 通過」，而不是「已完成 blocker classification」。
- 在更新 tasks 前保留實際查證依據：GPU probe、Kit process / port 狀態、script topology、worker artifact 性質、browser video readiness、screenshot / visual proof、verification report 結論。
- 保持 OpenSpec 與 verification report 對 `passed` / `blocked` / `failed` / `deferred` 的描述一致。
- 修正 runtime 驗證口徑：同一 review session 的並行觀看先以 same-Kit primary / spectator streams 驗證；若後續要做 dedicated multi-Kit process，才由 coordinator endpoint pool 分配不同 process。
- 對 single Kit GPU render，最小成功標準是：GPU-backed Kit runtime running、renderable USD / USDC loaded through current service chain、`openedStageResult` 或等效 DataChannel success、browser video ready 且有 non-zero frame，以及已存檔的 viewport screenshot。

**Non-Goals:**

- 不在此 change 實作真實 IFC->USD/USDC conversion production path；若缺少 renderable artifact，必須改用已知可渲染 USD / USDC fixture 或把 GPU render tier 保持未完成。
- 不把多 Kit instance orchestration 放進 `bim-streaming-server` 作為跨 repo 控制中心；service-local script 只負責啟動單一 Kit runtime 的 primary / spectator streams，root `scripts/` 負責多服務 orchestration。
- 不啟動或恢復 retired `_s3_storage`、`_conversion-service`、`_conversion-server`。
- 不修改 Socket.IO event、WebRTC negotiation、DataChannel payload、storage schema 或資料權威邊界。

## Decisions

### Decision 1: Checked runtime tasks require real GPU evidence

若實際驗證結果是 blocked，不能把 GPU render / concurrent stream runtime task 勾成完成。可以新增或保留 blocker 記錄 task，但真正代表 runtime pass 的 task 必須保持 `[ ]`，直到具備真實 GPU-backed Kit execution evidence。

替代方案是繼續把 blocked classification 視為 done，但這會讓 `all_done` 再次被誤讀成 runtime passed。現在採用較嚴格的標準：blocked 可以被記錄，但不能完成 in-scope runtime verification。

### Decision 2: Re-verify by running the GPU-backed runtime path before resolving findings

修正 tasks 前要核對並在可行時實際執行：

- `nvidia-smi` 或等效 GPU probe 是否可證明目前機器有 GPU。
- `49100` / `47998` 或 configured Kit signaling / stream ports 是否有 Kit listener。
- `bim-streaming-server` 是否由 Kit SDK 啟動，而不是只檢查 contract tokens。
- Browser 是否取得 video readiness、non-zero video frame 或 viewport screenshot。
- DataChannel 是否回傳 `openedStageResult` 或等效 stage-load success。
- Screenshot 是否已保存為 repo-local evidence artifact，且 verification report 是否引用該檔案。
- Root `scripts/` 是否存在多 Kit orchestration entrypoint。
- `bim-streaming-server/scripts/start-streaming-server.ps1` 是否仍使用固定 streaming ports。
- `_worker` 是否仍產出 placeholder `model.usdc`。
- verification report 是否明確寫出 `blocked / not passed`。

替代方案是只依照 review comment 修改文字，但這無法滿足「真實地在 GPU 上執行」。

### Decision 3: Keep production boundaries stable while allowing verification orchestration

這次修正先改 OpenSpec task semantics 與必要 evidence documentation。後續 apply 可啟動既有服務或新增 root-level verification scripts，但不得讓 `web-viewer-sample` 啟動 Kit、不得讓 `bim-streaming-server` 成為 session / file authority，也不得恢復 retired conversion / storage services。

### Decision 4: Archive browser E2E screenshots as evidence

成功的 browser E2E run 必須把 viewport screenshot 存成檔案，例如 `docs/verification/evidence/<YYYY-MM-DD>-runtime-e2e/` 底下的 PNG。Verification report 必須引用檔案路徑，並記錄對應的 `session_id`、`review_request_id`、artifact URL、Kit endpoint、browser URL、video dimensions 與 capture time。

若同時驗證 primary / spectator streams，每個 browser stream 都必須各有一張獨立 screenshot，且檔名或旁邊的 metadata 必須能分辨對應的是 primary 或 spectator signaling port。只截一張合成畫面不足以證明兩個 stream 都 ready。

### Decision 5: Treat same-Kit primary / spectator streams as this stage's concurrent runtime target

本階段不再把「兩個 Kit process」當成必要 pass 條件。NVIDIA Kit 的 `omni.kit.livestream.app` 已支援同一 process 內的 primary stream 與 indexed spectator streams；因此 concurrent browser E2E 應啟動一個 GPU-backed Kit process，設定 primary `49100` / `47998` 與 spectator `49110` / `48008`，再用兩個 browser pages 分別連線。

Primary browser 負責 DataChannel stage-load / `openedStageResult` 或等效 stage success；spectator browser 是 view-only evidence，成功標準是 WebRTC video readiness、non-zero frame、已顯示同一 USDC stage 的畫面、Socket.IO session continuity，以及 repo-local screenshot。若 spectator stream 沒有 app DataChannel，不應因此把 same-Kit concurrent viewing 判定失敗。

Dedicated multi-Kit process routing 仍可保留為後續 capacity / isolation tier。若未來產品真的需要每個 artifact 或 reviewer 對應不同 GPU runtime，才要求 `KIT_INSTANCE_ENDPOINTS` 內的 distinct process endpoints 與 `routing_policy=dedicated_instance` 實機 E2E。

## Risks / Trade-offs

- [Risk] Reviewer 仍把 `all_done` 當成 runtime pass → Mitigation: in-scope GPU / same-Kit concurrent stream pass tasks 在 evidence 不足時必須保持未完成或 explicit deferred，不能用 checked blocker task 取代。
- [Risk] GPU / Kit runtime 在不同 Windows machine 上結果不穩 → Mitigation: evidence 必須包含 GPU probe、Kit profile、ports、fixture、session id、video readiness 與已存檔 screenshot。
- [Risk] 為了驗證而跨越 repo 邊界 → Mitigation: root `scripts/` 負責 orchestration，各服務仍維持 AGENTS 定義的責任。
- [Risk] 新 change 與原 change 疊在同一分支造成流程混淆 → Mitigation: final handoff 必須指出目前有既有 `complete-spec-runtime-verification/tasks.md` 未提交修正與新 `fix-runtime-verification-task-status` artifacts。
