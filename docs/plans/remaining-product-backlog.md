# Remaining Product Backlog

本檔保存移除 OpenSpec 前仍具產品價值、尚未證實完成的需求。狀態統一為 **UNVERIFIED**：這是需求遷移，不是本次 PR 的 runtime 完成聲明；實作前必須以現行 code、tests 與環境重新確認。

## A4 semantic search and model QA

- 對所有 session-scoped A4 action 落實 authenticated principal、viewer lease 與 production auth scope。
- 完成 proof expiry 的 draft-preserve UX、key rotation/retirement，以及 session issue proxy。
- 以 canonical A4 UI 取代 fixture：filters、evidence/counts、row selection、edit/confirm，涵蓋 idle/loading/success/error/partial/retry。
- 完成 mapped focus/highlight handoff；unmapped 與 spectator 必須停用 mutation。
- 補齊 shared terminal result/rejection tests，以及真實 browser/runtime/visual QA。

## Single-GPU session and AI review MVP

- 建立帶環境 fingerprint 的 GPU/VRAM/TTFF/WebRTC baseline、30 分鐘以上 soak 與 leak/admission/idle thresholds。
- 完成 SessionBroker 的單 GPU admission、primary queue、spectator、idle countdown、health recovery 與 cold-start 202 UI。
- 完成 IfcClash/geometry/viewpoint finding ingest、draft store 與可選 local-LLM advisory。
- 建立 finding fingerprint/idempotency、GUID churn/reopen/diff report、human triage concurrency/ledger。
- 支援 BCF 3.0 JSON/BCFzip，並完成一條真實 vertical-slice E2E。

## Frontend reference and runtime truth

- 維護 canonical routes、stable screen/state IDs、semantic actions、viewports 與 dynamic metadata。
- 以 tracked design HTML 重建有權威來源的產品畫面；缺少 reference 的 surface 必須誠實標記。
- 對 routes/actions/真 API/state 執行 functional browser E2E；Kit surface 另驗 first frame、Stage、DataChannel。
- 完成 LAN browser conversion trigger E2E：驗證 `has_source_ifc`、非 403、可見 lineage 與重複觸發冪等性。舊紀錄曾受 MinIO network reachability 阻擋，現況需重查。

## GPU baseline and idle reclaim

- Baseline 同時量測 GPU/VRAM/utilization/WebRTC/TTFF，並把結果綁定 GPU、driver、Kit 與 fixture fingerprint。
- Viewer 回報 activity；server 廣播 10 秒 inactivity countdown，互動可取消/重設。
- Timeout 以 session close `reason=inactivity` 完成 teardown，補 unit、integration 與 browser/runtime E2E。

## Viewer application integration surface

- 在保留現有 UI/ACK 行為下分離 protocol、transport、state 與 profile 層。
- 正式化 Kit events、VG01/DataChannel correlation、origin/source validation 與 lease channel。
- 完成 12-state model、persistent ViewportHost、manual start/lease/spectator invite E2E。
- 支援 A1/A2/A3 profiles、mapping cache、統一 A2 overlay 與 fixture profile extensions。

## RVT → IFC → USDC lineage

- 完成 alignment report read model、streaming attempt/job IDs、schedule CSV mapping 與 stable prim roots。
- 以 attempt scope 發佈 MinIO artifacts，並處理 runtime admission、`WAITING_CAPACITY` 與 cooperative/forced release safeguards。
- 保留 callback contract；完成 metadata-only cloud lineage outbox、HMAC/idempotency/health/receipt。外部 MySQL schema/credentials 不進本 repo。
- 完成 lineage console read/download/actions，以及 canonical Linux test environment 的真 MinIO vertical-slice、cache rebuild 與 audit。
