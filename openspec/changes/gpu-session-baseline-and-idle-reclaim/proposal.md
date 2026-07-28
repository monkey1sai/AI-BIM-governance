## Why

自 `add-single-gpu-session-ai-review-mvp`（已於 2026-07-28 標 `Status: deferred`）切出的最小可完成切片。依 2026-07-28 read-only 盤點，該傘型 change 中真正無人認領、且不依賴 SessionBroker／IfcClash／LLM／BCF 3.0 等重物的獨有主線只有兩條：

1. **單 GPU 容量的量化缺口至今無答案**：repo 唯一數字來源是 `docs/verification/2026-06-05-host-gpu-runtime-reality-check.md` 的一次性環境快照——無 per-stream VRAM、無 TTFF、無建立成功率、無 soak 斜率、無任何 SLO 數值；`KitGpuFleetPage` 自標「GPU busy / total = 未取得」。先量測、再談任何 admission／排程承諾（母 change MVP 哲學原文）。
2. **忘關分頁餓死洞已有使用者裁決但未實作**（2026-07-22 原話「同意, 但是前端追加 session 進入倒數10秒顯示」）：無互動軟門檻＋前端 10 秒回收倒數。此路徑不依賴佇列／SessionBroker，可疊加落在既有 coordinator session close 路徑上。

## What Changes

- **`gpu-session-baseline`**（New capability）：量測 harness `measure-session-baseline.ps1`（nvidia-smi＋WebRTC health probe＋TTFF＋建立成功率）、環境指紋必填 schema＋驗證測試、隔離 stack ≥30 分鐘 soak 記憶體斜率、由本地實測訂 SLO 具體數值寫入部署文件（禁引用外部數字）、「指紋變動即 SLO 失效」＋無基準報告時 admission 參數 loader 硬 gate。
- **`session-lifecycle`**（New capability，slim delta）：只含「回收倒數與互動保活」第二回收路徑——互動事件上報彙整、連續 T_inactivity 觸發、10 秒倒數廣播與前端倒數 UI、任一互動取消並重置、歸零經既有 session close 路徑 teardown（reason=inactivity 入 session ledger）。佇列、SessionBroker、健康探針自動復原、202 冷啟動等其餘 lifecycle 語意**不在本 change**。
- 一律疊加式：不動凍結三檔（`app.py`／`conversion_authority.py`／`governanceProxy.ts`），不改既有 route／response shape。

## Impact

- Affected specs: `gpu-session-baseline`（new）、`session-lifecycle`（new，slim）。
- Affected code: `scripts/`（harness＋最小驗證測試）、可稽核部署文件、`bim-review-coordinator`（additive：互動上報彙整＋倒數觸發＋close reason）、`web-viewer-sample`（倒數 UI＋E2E）。
- **與 deferred 母 change 的關係**：本 change 承接其 T1 六項（1.1–1.5、2.11）。母 change 對應 delta（`gpu-session-baseline` 三條 Requirement、`session-lifecycle` 的「回收倒數與互動保活」Requirement）於 thaw crosswalk 時標記由本 change 承接，不得平行實作；本 change 的 Requirement 名稱刻意沿用母版以利 crosswalk。
- **明確不做**（supersede／frozen 證據見母 change Status 段）：SessionBroker 抽象與 contract test、primary 佇列、202 冷啟動、健康探針自動復原、IfcClash／LLM 草稿管線、人審 triage 佇列、BCF-API 3.0（zip 骨架已有＝`governance-service/bcf/bcf_writer.py`，BCF 2.1）、跨版本冪等指紋（機制已有＝`governance-service/diff_engine/keys.py`）。
