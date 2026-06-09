# AI-BIM-governance：下一輪 burn-down（2026-05-19）

> **文件性質**：Drive-ready planning artifact。Source of truth 仍以 repo `main`、`AGENTS.md`、`openspec/specs/`、`docs/verification/` 為準；本文件只把 2026-05-14/15 Drive 上的 `12h Claude Design` 設計工作台，重新過濾成目前還有效的下一輪候選。

## 1. 比對基準

| 來源 | 本輪使用方式 | 結論 |
|---|---|---|
| Drive `12h-claude-design-run-2026-05-14.md` / `12h-claude-design-2026-05-14-1944` | 取得 5/14 「B 方案 land 後第一輪 risk burn-down」的舊候選與 NOT-DO | 5/14 的 `_worker` / `_bim-control` burn-down 語意已被 5/18 Phase B 移除，僅保留為 archive context |
| Drive `12h-claude-design-2026-05-15-0704` | 取得 C1/C2/C3 與 runtime gap 順序 | C1/C2 仍有效但需改名為 B-scheme runtime evidence；C3 已失效，不能再啟動 `_bim-control` / `_worker` facade/bridge |
| Repo `origin/main` | `70a0dd2 docs(openspec): 歸檔 local-coordinator-ifc-ready-intake-boundary 並 sync specs (#64)` | 本輪基準已是 merged + archived 後的 main；`_worker` / `_bim-control` 已 removed from product runtime |
| Legacy roadmap | `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`（已於 2026-06 source-of-truth 切換中移除） | 本 burn-down 保留歷史脈絡；現行功能需求改看 `docs/plans/ai-bim-governance-設計規格.md` 與 `docs/plans/ai-bim-governance-prototype.html` |
| Recent archive | `2026-05-18-introduce-ai-bim-runtime-manager-docker-kit-mvp`、`2026-05-18-local-coordinator-ifc-ready-intake-boundary` | Docker-first runtime MVP 已 archive；B-scheme coordinator intake + streaming internal + callback outbox 已 archive；Kit launcher runtime evidence 仍 deferred |
| Runtime evidence | `docs/verification/evidence/2026-05-18-bscheme-intake-smoke/bscheme-readiness.json`、`docs/verification/evidence/2026-05-18-t0-kit-launcher/kit-launcher-readiness.json` | API/contract layers passed；mapping quality、single Kit render、WebRTC、USD stage composition 未觀察；runtime image Kit launcher deferred |

## 2. 舊工作台候選處理

| Drive 候選 / gap | 本輪判定 | 下一輪處理 |
|---|---|---|
| C1 `streaming-launcher-bringup` | **仍有效但收斂** | 改為 `runtime-image-linux-kit-launcher-readiness-pass`：只處理 container 內 NVIDIA graphics/Vulkan libs / Kit launcher 實際啟動，不用 host-local Kit 充當 pass |
| C2 `conversion-webhook-evidence-v2` | **仍有效但 scope 已改** | 改為 `bscheme-real-streaming-conversion-evidence`：外部 IFC-ready contract stub -> coordinator intake -> streaming internal conversion -> callback outbox；必須用 streaming-owned result，不沿用 historical worker evidence |
| C3 `revit-intake-rvt-ifc-bridge-evidence` | **失效** | `_bim-control` / `_worker` 已自 repo 刪除；Revit/RVT/IFC Worker 是外部既有平台，只能由 `tests/fakes` + `tests/contracts` 模擬，不再新增產品候選 |
| `13-file batch` / `MINIMUM_COVERAGE_LOCKED` | **轉為 archive-only historical evidence** | 5/15 archive 已證明 worker-era v3 lock；但 Phase B 後不作為本 repo runtime 候選。若要補跑，只能當 archived evidence backfill，不得阻塞 B-scheme runtime |
| `KIT/WEBRTC blocked` | **仍是最大 runtime gap** | 必須先補 Kit launcher / WebRTC live evidence；未補前不能把 browser visual、single Kit render、multi-viewer 標 passed |
| `USDC owner legacy` | **已由 Phase B 清除** | 現行 owner 是 `bim-streaming-server` internal-only；任何新文件不得把 USDC / mapping authority 寫回 `_worker` |

## 3. 下一輪有效候選

| 順序 | 候選 | 狀態 | Owner | 成功標準 | 不做的事 |
|---|---|---|---|---|---|
| 1 | `runtime-image-linux-kit-launcher-readiness-pass` | **P0 / deferred blocker** | `bim-streaming-server` + Docker runtime | `scripts/verify-runtime-kit-launcher.ps1` 顯示 runtime image 內 produced Linux Kit launcher 真正啟動；不再缺 `libGLX_nvidia.so.0` / graphics-Vulkan libs；evidence 更新為 passed | 不用 Windows host-local Kit、不用 `nvidia-smi` compute-only 充當 pass |
| 2 | `bscheme-real-streaming-conversion-evidence` | **P0 / candidate** | `bim-review-coordinator` + `bim-streaming-server` | 以 contract-correct IFC-ready payload 建 job；streaming internal conversion 回 `conversion_job_id` / result / quality metrics；`external_model_version_id` binding 可追溯；callback outbox metadata-only | 不重建 `_worker`；不把 historical worker mapping quality 升等成 B-scheme pass |
| 3 | `single-kit-webrtc-visual-evidence` | **P0 / blocked by #1** | `bim-streaming-server` + `web-viewer-sample` | 用 streaming-produced artifact 開 stage；記錄 `openedStageResult`、非零 video dimensions、viewport screenshot 或等效 visual proof | 不把 API-only pass、Socket.IO pass、或舊截圖當 current WebRTC evidence |
| 4 | `same-kit-multi-viewer-session-evidence` | **P1 / after #3** | `web-viewer-sample` + `bim-review-coordinator` + streaming | 同一 Kit endpoint 支援至少兩個 viewer session；presence/session/callback 狀態分層清楚 | 不啟動 dedicated multi-Kit；那是 GPU capacity tier |
| 5 | `streaming-multi-instance-orchestration` | **P0-hold** | streaming runtime / coordinator Kit pool | 等至少兩個 GPU-backed Kit endpoints + 24GB 級 GPU capacity 到位後再驗 dedicated instance routing | GPU 未到位前不標 in-progress、passed 或 failed |
| 6 | `company-cloud-callback-auth-binding` | **blocked by OQ1** | coordinator callback outbox + 外部公司雲端 | 外部 endpoint/auth 確認後，把 outbox target/auth 從 placeholder 轉成 real integration evidence | 不先假設 endpoint、不傳 `.usdc` 本體、不把 dead-letter 當失敗 conversion |
| 7 | `local-web-view-sso-binding` | **blocked by OQ5** | coordinator user auth + 外部 SSO | 公司 SSO/token introspection 確認後，替換 local-dev provider 並保留 current local web view contract | 不寫死 EZPLUS SSO、不把 dev token 當正式登入 pass |

## 4. Deferred / blocked evidence ledger

| Evidence | 現況 | 原因 | 下一步 |
|---|---|---|---|
| `runtime_image_kit_launcher` | `deferred` | container 可見 CUDA compute，但未掛 NVIDIA graphics/Vulkan libs；Kit RTX runtime 缺 `libGLX_nvidia.so.0`，entrypoint exit 75 | 在 native Linux + NVIDIA Container Toolkit graphics capability，或修 WSL2 GL/Vulkan passthrough 後，重跑 `scripts/verify-runtime-kit-launcher.ps1` |
| `mapping_quality` | `not_observed` | 5/18 B-scheme smoke 是 API-only pass，沒有 streaming-owned real quality metrics | 跟 #2 一起補：streaming internal conversion result 必須帶 metrics，不沿用 worker evidence |
| `single_kit_render` | `deferred` | Kit/GPU/WebRTC live render 未跑；launcher blocker 未解除 | #1 passed 後跑 browser / Kit render validation |
| `single_kit_multi_viewer` | `not_observed` | 未收集多 viewer browser evidence | #3 passed 後再跑，不和 dedicated multi-Kit 混在一起 |
| `usd_stage_composition` | `not_observed` | 未用 streaming-owned artifacts 實際開 stage | #2 + #3 合併驗證 |
| OQ1 company-cloud callback endpoint/auth | `pending` | 外部公司雲端 endpoint/auth 尚未確認 | 保留 contract + outbox retry/dead-letter；等外部平台 team 給 endpoint/auth 後再升級 |
| OQ5 SSO binding | `pending` | 公司 SSO / user auth provider 尚未確認 | 保留可替換 user auth provider；等 SSO 決策 |
| dedicated multi-Kit | `deferred` | 少於兩個 live GPU-backed Kit endpoints | GPU capacity 到位後再啟動 `streaming-multi-instance-orchestration` |

## 5. 建議執行順序

1. **先解 runtime image Kit launcher deferred**
   這是現在最大的卡點。沒有這一步，WebRTC、single Kit render、stage composition、multi-viewer 都只能保持 blocked / not_observed。

2. **再補 B-scheme real streaming conversion evidence**
   目標是證明現在的正路徑：external IFC Worker payload -> coordinator intake -> streaming internal conversion -> metadata-only callback outbox。這一步要補 streaming-owned mapping quality，不得把 worker-era evidence 升等。

3. **接 single Kit / WebRTC visual proof**
   用 #2 產出的 streaming artifact 開 stage，留下 `openedStageResult`、video dimensions、screenshot。這是從 API-only 走向 demo runtime 的分水嶺。

4. **同一 Kit 多 viewer，再 dedicated multi-Kit**
   先證明 same-Kit 多 viewer。dedicated multi-Kit 等硬體 capacity，避免把 GPU 購買問題偽裝成功能 regression。

5. **OQ1 / OQ5 等外部平台輸入**
   callback endpoint/auth 與 SSO 都不是本 repo 可以單方面完成的工作；維持 contract frozen + pending，等外部系統確認後再開小 change。

6. **Phase 5 / OVAS / Presence / Phase 6 全部後置**
   OVAS、Presence layer、notification、tenant RBAC、observability、production deployment 都不能搶在 B-scheme runtime evidence 前面。

## 6. NOT-DO

- 不重開 `_worker` / `_bim-control` 產品 runtime，也不把它們作為 startup、health、smoke、review-session 依賴。
- 不把 historical worker real conversion / mapping / browser screenshot 當成 B-scheme streaming-owned current pass。
- 不把 `runtime_image_kit_launcher=deferred`、`single_kit_render=deferred`、`mapping_quality=not_observed` 改寫成 passed。
- 不把 OQ1 / OQ5 placeholder 寫成真實外部對接完成。
- 不啟動 Phase 6 候選，除非有公司業務系統接入確認。

## 7. Drive 回寫建議

建議 Drive 文件標題：

```txt
AI-BIM-governance next burn-down 2026-05-19
```

建議摘要：

```txt
本文件以 repo main 70a0dd2 與 2026-05-18 OpenSpec archive 為準，重比對 2026-05-14/15 12h Claude Design 工作台。下一輪只保留 B-scheme runtime evidence 候選：Kit launcher deferred closure、streaming-owned conversion/mapping evidence、single Kit/WebRTC visual proof、same-Kit multi-viewer、GPU capacity 後 dedicated multi-Kit。_worker/_bim-control 候選已失效，OQ1/OQ5 維持 pending。
```
