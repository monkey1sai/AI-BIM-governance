# CFD P2 S4 — 181 真站 16 風向 run 與 UI 疊圖證據（2026-09-22）

契約：`docs/plans/building-energy-cfd-p2-contract.md` S4 列（181 上跑完 16 方向並在 UI 檢視）。本目錄是**該列的真站證據**；部署接線本身由 PR #893 落地。

## 環境

- 181 部署版本（run 執行期間）：`6f7f611`（S6 前置合併後；S7 #900 在 run 完成後才合併部署）。
- `CFD_ENABLED=true`（owner 手動加入 canonical env），求解映像 `opencfd/openfoam-default:2412` 以 pinned digest 拉取，`CFD_N_PROCS=4`。
- 送出方式：coordinator `POST /api/cfd/runs`（`cfd-run-request/v1`），16 個風向、U_ref 5 m/s @ 10 m、z0 0.5 m、`true_north_source: geo_reference`；mesh／solver 用 service 預設（背景格由自動規則 `min(6, max(1.5, H/6))` 決定：本模型 H = 23.08 m → **3.85 m**；等向精細盒、endTime 600、可自動延長一次）。（2026-09-23 更正：原寫「背景格 6 m」有誤，6 m 是 S5b 收斂研究以 CLI 明確指定的值；實際值取自 run record。）
- 模型：181 上既有的 ready 轉檔（MinIO watch 來源）；本目錄不含專案名稱、GlobalId、IFC／USDC 檔。

## 結果（`run/run_summary.json`、`run/result.json`、`run/ledger_detail.json`）

| 項目 | 值 |
|---|---|
| run 狀態 | `ready` 16/16，`converged_count` 16，`sealing_suspect` false |
| 牆鐘 | 2026-09-22T08:24:09Z → 2026-09-22T15:27:45Z（7.06 h，平均每向 26.5 分） |
| 收斂 | 16/16 由 residualControl 收斂，436–571 步，無方向需要自動延長 |
| 網格 | 1,253,984–3,410,812 格（背景 3.85 m＋建物表面 2 級、精細盒 1 級加細；N 0° 的背景網格 173 × 296 × 36 = 1,843,488 格，占該向 3,048,141 格的 60%；隨風向旋轉的計算域大小不同） |
| 行人面 1.5 m \|U\|max | 3.49–4.48 m/s（U_ref 5 m/s） |
| 外殼洩漏率 | 12.0%（門檻 15%，`appendage_policy: included`） |
| `validation_level` | `screening` |
| assumptions | true_north_unknown_assumed_project_north |

| 風向 from (°) | 步數 | 網格 | \|U\|max 1.5 m (m/s) | p min / max (Pa) |
|---|---|---|---|---|
| 0 | 483 | 3,048,141 | 3.84 | -21.5 / 13.1 |
| 22.5 | 464 | 3,202,056 | 4.03 | -23.3 / 14.5 |
| 45 | 467 | 3,083,960 | 3.63 | -31.6 / 15.1 |
| 67.5 | 496 | 3,410,812 | 3.86 | -30.9 / 16.4 |
| 90 | 523 | 3,227,324 | 3.58 | -20.9 / 17.3 |
| 112.5 | 550 | 2,477,148 | 4.06 | -25.6 / 16.8 |
| 135 | 571 | 1,334,539 | 4.48 | -30.1 / 16.3 |
| 157.5 | 542 | 2,647,365 | 4.42 | -38.9 / 16.4 |
| 180 | 528 | 3,221,205 | 4.29 | -22.1 / 15.6 |
| 202.5 | 491 | 3,316,355 | 4.06 | -25.5 / 18.5 |
| 225 | 436 | 3,098,393 | 4.12 | -19.3 / 13.3 |
| 247.5 | 452 | 3,265,022 | 4.33 | -25.8 / 13.1 |
| 270 | 481 | 3,015,247 | 3.91 | -23.7 / 13.4 |
| 292.5 | 527 | 2,321,122 | 4.35 | -25.2 / 13.5 |
| 315 | 555 | 1,253,984 | 3.49 | -21.6 / 14.5 |
| 337.5 | 524 | 2,501,641 | 3.49 | -22.4 / 13.6 |

## 瀏覽器 E2E（`browser/`）

`web-viewer-sample/e2e/cfd-wind-overlay-real.spec.ts` 以真 Chrome channel 對 181 執行（`E2E_COORDINATOR_BASE_URL` 指向 181，`CFD_E2E_SESSION_ID`／`CFD_E2E_RUN_ID` 為既有 session 與本 run）：開 3D 工作區 → 啟動 3D → 對 N 0° 按「顯示疊圖」→ coordinator 登記 overlay binding（201）→ stage-binding 帶 secondary layer → Kit 回報「已確認載入疊圖」→ 錄 10 秒直播。1 passed（20.2 s）。

- `01-first-frame-before-overlay.png`：疊圖前的 first frame。
- `02-overlay-applied.png`：Kit 確認疊圖後（左側為 S3.1 圖例：\|U\| 0–5 m/s、建物表面壓力範圍、行人面透明度滑桿 0.60，以及 16 向結果表）。
- `03-overlay-live-t3s/t6s/t10s.png`、`overlay-live-0.webm`：疊圖後 3／6／10 秒的直播畫面與 Playwright 錄影（錄影已以 ffmpeg 裁成左側 1180 px 重編碼，與截圖同一裁切）。
- `browser-e2e.json`：stage-binding／cfd-overlays 回應（`binding_revision_id`、secondary layer 為本 run 的 `w000` 圖層）。

截圖與錄影都裁掉右側「選擇模型與審查」面板（含專案顯示名稱）；主機位址與本機路徑以 `<canonical-host>`／`<local-path>` 取代。

## 限制與未做

- `screening` 等級：S5b-2 對本 run 使用的等向精細盒模式量到峰值 U_max GCI 1.9%，但平均場（U_mean／U_p95）未網格獨立；S6 前置在 AIJ Case C（3 m／1.5 m 縮尺網格）hit rate 38–40%，低於 66% 門檻。本 run 的數值只能做設計比較，不是法規或認證依據。
- 真北未知（`true_north_unknown_assumed_project_north`）：風向相對 project north。
- 疊圖畫面沿用 S3.1 的相機框取（行人面與流線佈滿視野，建物在中央偏小）；未另做相機對焦。
- Kit first frame 與 DataChannel ACK 在求解期間不退化（R-A1）未在本輪量測：求解期間沒有並行的串流 session。
- S7（模型為主體的面板）真站操作證據見 `../cfd-s7-2026-09-22/`；S6 A1 finding 真站操作證據待 #901 合併部署後補。
