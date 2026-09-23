# CFD P2 R-A1 — 求解期間 Kit 串流不退化（181 真站，2026-09-23）

契約：`docs/plans/building-energy-cfd-p2-contract.md` §6 **R-A1**：「求解與 Kit 同機搶 CPU：S4 以 `CFD_N_PROCS` 與 docker `--cpus` 限制，實測 Kit first frame 與 DataChannel ACK 不退化才算過」。S4 真站 16 向 run 期間沒有並行串流 session，這一項當時未量；本目錄補上。

## 結論

**四項判定全數通過（`summary.json` `overall_pass: true`）**：CFD 網格化與求解佔滿其 4 核上限時，Kit 的 first frame、DataChannel ACK 往返、串流 fps 與連線穩定度都在判定範圍內。fps 中位數下降約 7%（59.3→55.4），是四項中唯一可見的變化，見「觀察」。

## 環境與負載

- 181：20 核 CPU、NVIDIA RTX 5080；Kit 為 host-native，coordinator／viewer 為 docker。部署 `f2905ba`（deploy tag `deploy-20260923-…-001`）。
- CFD 限制：部署腳本把 `CFD_N_PROCS` 預設為 4，求解容器以 `--cpus 4` 執行（取樣到 391–394% CPU，即上限 4 核）。
- 負載 run：`cfd_20260923T031117Z_a565e1`，2 個風向（0°、90°），service 預設（背景格 6 m、等向精細盒），`origin.session_id: null`。進入 `solving` 後等 30 秒開始量；量完即取消（`POST …/cancel` 回 200，約 20 秒內 `cancelled`，取消後取樣確認求解容器已移除）。
- 審查 session：S4 用的同一個 session（同一模型、同一 Kit instance）。

## 方法（`tools/`）

每個條件 3 次，順序為閒置（前）→ CFD 負載中 → 閒置（後），A-B-A 以排除時間漂移；兩次之間等 60 秒，讓前一次的 primary viewer lease（TTL 45 秒）過期。每次都是新的真 Chrome（Playwright，headless）：

1. 開 `/ui/#a1` → 選審查 session → 按「啟動 A1 3D Session」。**first frame** ＝ 按下到 viewer iframe 發出 `first_frame` postMessage 的時間。
2. 等 3 秒後，對 viewer iframe 逐筆送 30 筆 `camera_state`（與 console 相同的 `vg01` 封裝）。viewer 轉成 Kit DataChannel `cameraStateRequest`，Kit 回覆後 viewer 發 `camera_state_result`。**ACK 往返** ＝ 送出到收到回覆，只計 `applied`（Kit 有回）的筆數。`camera_state` 是唯讀查詢，不改 stage。
3. 在 viewer frame 內用 `requestVideoFrameCallback` 計 10 秒內的幀數得 **fps**，並以 `getVideoPlaybackQuality()` 取 **掉幀數**。
4. 每次試量開始後 12 秒，以唯讀 SSH 取樣一次主機：load average、依 %CPU 排序的前 10 個程序（只取短命令名）、docker 各容器 CPU%、GPU 使用率與編碼器使用率。
5. 每次都記錄 viewer lease claim 的角色；只有 primary 的試量才算數（9/9 皆為 primary）。

## 判定基準

基準在閒置（前）三次完成、CFD 負載中第一次回來之後才寫定（不是量測前），因此如實列出所有逐次數據供重新判讀：

| 項目 | 基準 | 閒置 | CFD 負載中 | 判定 |
|---|---|---|---|---|
| first frame | 負載中位數 ≤ 1.5 × 閒置中位數，且每次 < 5,000 ms | 中位數 1238 ms | 中位數 1287 ms（1.04×），最大 1,544 ms | 通過 |
| DataChannel ACK | 負載中最差一次的 p95 ≤ min(100 ms, 1.5 × 閒置最差 p95)，且每筆都 `applied` | 最差 p95 40.6 ms | 最差 p95 43.9 ms；90/90 applied | 通過 |
| 串流 fps | 負載中位數 ≥ 0.9 × 閒置中位數 | 中位數 59.3 | 中位數 55.4 | 通過 |
| 連線 | 不斷線，每次 primary lease | 0 斷線 | 0 斷線 | 通過 |

## 逐次數據（`trials.json`、`summary.json`）

| 試量 | first frame (ms) | ACK 中位 / p95 / 最大 (ms) | ACK applied | fps | 掉幀 | load1 | Kit CPU | 求解容器 CPU | 其他重負載程序 |
|---|---|---|---|---|---|---|---|---|---|
| 閒置（前） 1 | 1,218 | 31.9 / 38.6 / 67.6 | 30/30 | 59.9 | 0 | 1.9 | 50% | — | — |
| 閒置（前） 2 | 1,206 | 29.3 / 39.8 / 49.8 | 30/30 | 55.8 | 0 | 0.8 | 60% | — | — |
| 閒置（前） 3 | 1,434 | 31.8 / 40.6 / 47.1 | 30/30 | 59.4 | 0 | 1.6 | 60% | — | — |
| CFD 負載中 1 | 1,287 | 32.2 / 43.9 / 46.7 | 30/30 | 59.9 | 0 | 3.15 | 70% | 393.17% | snappyHexMesh |
| CFD 負載中 2 | 1,201 | 32.2 / 38.3 / 38.7 | 30/30 | 55.4 | 0 | 5.77 | 73% | 393.77% | simpleFoam |
| CFD 負載中 3 | 1,544 | 32.9 / 41.5 / 47.7 | 30/30 | 53.1 | 6 | 5.38 | 73% | 391.79% | simpleFoam |
| 閒置（後） 1 | 1,212 | 31.9 / 34.6 / 40.4 | 30/30 | 59.2 | 0 | 1.94 | 54% | — | — |
| 閒置（後） 2 | 1,292 | 31.1 / 37.9 / 38.1 | 30/30 | 59.4 | 1 | 1.98 | 50% | — | — |
| 閒置（後） 3 | 1,259 | 29.8 / 35.6 / 37.4 | 30/30 | 59 | 5 | 1.24 | 60% | — | — |

Kit CPU 與其他程序是 `top -bn1` 的單次快照（每核 100%）；docker CPU 是 `docker stats --no-stream` 的單次值。

## 觀察

- **網格化也涵蓋在內**：CFD 負載中第 1 次取樣時 ledger 已顯示 `solving`，主機上實際在跑的是 4 個 `snappyHexMesh`；第 2、3 次才是 `simpleFoam`。兩者都是 4 核上限內的重負載階段。ledger 的 `meshing` 狀態在 20 秒輪詢下沒被看到，狀態顆粒度比實際階段粗。
- **fps**：負載中三次為 59.9, 55.4, 53.1，隨求解進行略降；第 3 次 53.1 低於閒置中位數的 90%（53.4），但中位數仍在線上。閒置（前）也出現過 55.8。三次樣本不足以區分「CPU 競爭造成」與「一般波動」。
- **掉幀**：負載中第 3 次 6 幀；閒置（後）第 3 次也有 5 幀，無法歸因於 CFD。
- **Kit CPU**：閒置 50–60%，負載中 70–73%（單次快照）。GPU 使用率 5%、編碼器 7%，九次取樣都相同。
- **first frame** 量的是對已載入 stage 的 session 重新連線，不含冷啟動載入 stage 的時間。

## 限制與未做

- 每個條件只有 3 次，單一站點、單一模型、單一 Kit instance；結論只適用 `CFD_N_PROCS=4`（20 核主機上 4 核）。調高 `CFD_N_PROCS` 需重量。
- 前處理（體素化）在 host-native 轉檔服務內執行、**不受 `--cpus` 限制**；本次約 40 秒就進入後續階段，未安排試量落在其間。
- ACK 用唯讀的 `camera_state` 量 DataChannel 往返（含 console↔iframe 的 postMessage）；改變 stage 的命令（stage-binding、overlay 樣式）未納入。
- 無頭 Chrome 的 `requestVideoFrameCallback` 計數；未量 WebRTC `getStats` 的 jitter／RTT。

## 181 上留下的狀態

- 負載 run `cfd_20260923T031117Z_a565e1` 狀態 `cancelled`，保留在 job store 與 ledger。
- 九次試量都在結束時關閉瀏覽器；viewer lease 依 TTL 自然過期，未另外釋放。
