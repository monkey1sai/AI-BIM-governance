# CFD 呈現探針（CP1）證據 — 2026-09-30

對應 `docs/plans/cfd-presentation-parity-contract.md` §6 CP1。本資料夾只含**合成場景**（40 × 25 × 30 m 方塊建物與解析式風場），沒有任何真實專案資料；PNG 都是該合成場景的 Kit 截圖。

## 共同方法

- **探針場景**：`tools/cfd/kit/make_presentation_probe_stage.py`（repo `.venv`，純 `usd-core`，決定性；單元測試 `tools/cfd/tests/test_presentation_probe_stage.py`）。輸出 `model.usdc`（`/World/Elements/IfcWall/ProbeBuilding`）、`overlay.usdc`（`/World/Overlays/Cfd/cfd_probe/…`）、`view.usda`、`manifest.json`。慣例同 `cfd_pipeline/usd_results.py`：Z 向上、公尺、模型 +Y＝project north、U 色階 0–5 m/s（`usd_results.colormap`）、240 幀 @ 24 fps 循環與 `customLayerData["cfd:animation"]`。風場是解析式替身（圓柱勢流＋冪律剖面），只用來量渲染技術、層檔大小與開啟時間，不代表物理。
- **Kit 探針**：`tools/cfd/kit/probe_presentation.py`，在 headless Kit 110.1.0（`ezplus.bim_review_stream.kit`，RTX，viewport 1920 × 1078）以 `--exec` 執行。開檔方式比照產品：root layer＝`model.usdc`，`overlay.usdc` 接到 session layer 的 sublayer，timeline 依 `stage_loading._sync_cfd_animation_playback` 設定（不播放）。燈光、像素差與 overlay style controller 直接載入 `open_stage_capture_and_quit.py` 的 helper（該檔未修改）。相機是 session layer 上的固定相機（`iso`、`near`、`top`＝正上方、北朝上），所以不同 stage 的截圖可以逐像素比較。
- **像素差**：`changed_pixel_fraction`＝RGB 絕對差總和 > 24 的像素比例（harness 的 `_pixel_diff`）。
- **共同指令**（`<repo>`＝主 checkout，`<wt>`＝本 worktree，`<s>`＝本機 scratch）：

```bash
# 產生探針場景（repo .venv）
<repo>/.venv/Scripts/python.exe <wt>/tools/cfd/kit/make_presentation_probe_stage.py --out-dir <s>/stages/<name> <flags>
# 在 Kit 內執行探針（cwd = <repo>/bim-streaming-server/_build/windows-x86_64/release）
timeout 900 ./kit/kit.exe apps/ezplus.bim_review_stream.kit --no-window \
  --ext-folder "<repo>/bim-streaming-server/source/extensions" --portable-root "<s>/kit_portable" --/app/fastShutdown=1 \
  --exec "<wt>/tools/cfd/kit/probe_presentation.py --probe <probe> --stage <label>=<s>/stages/<name> --out-dir <s>/out/<label> <flags>"
```

## 判定總表

| 探針 | 問題 | 判定 | 影響切片 |
|---|---|---|---|
| P1 | 流線漸進生長在 RTX 可行的技術 | **PASS**（方案 a：分段 prim＋時間取樣 `visibility`） | CP3、N3.4 |

---

## P1 流線生長（CP3、N3.4）

**問題**：`StreamlineGrowth` 能否在 Kit RTX 內沿行進時間逐段顯現，並留在既有 240 幀循環內？依序試 (a) 分段 prim 的時間取樣 `visibility`、(b) 單一 BasisCurves 的時間取樣 `widths`、(c) 退回只用粒子。

**方法**：120 條流線 × 80 點，依行進時間切成 24 個 `StreamlineGrowth/Seg_NNN`（BasisCurves，管寬 0.5 m，逐點速度色），每段 `visibility` 只有兩個時間取樣：幀 0 `invisible`、幀 6k `inherited`（k＝1…24，`growth_seconds` 6 s＝144 幀內全部顯現）。行進時間以各流線總行進時間的第 95 百分位（此場景 64 s）正規化。不寫靜態 `Streamlines`，讓截圖只看生長。以 timeline `set_current_time` 停在各時間碼，等 30 幀後截圖；另以 USD `ComputeVisibility` 讀回可見段數。

```bash
make_presentation_probe_stage.py --out-dir <s>/stages/p1a --streamlines 120 --streamline-points 80 --no-static-streamlines --growth segments --growth-segments 24
probe_presentation.py --probe growth --stage p1a=<s>/stages/p1a --out-dir <s>/out/p1a --views iso
```

**量測**（`p1_probe_growth.json`；Kit 行程 23 s，exit 0）：

| 時間碼 | USD 讀回可見段 | 相對 t=0 變動像素 | 相對前一張變動像素 |
|---:|---:|---:|---:|
| 0 | 0／24 | — | — |
| 24 | 4／24 | 35.6% | 35.6% |
| 48 | 8／24 | 50.6% | 23.9% |
| 72 | 12／24 | 57.7% | 11.1% |
| 96 | 16／24 | 58.3% | 3.3% |
| 120 | 20／24 | 58.5% | 1.5% |
| 144 | 24／24 | 58.7% | 0.9% |
| 200 | 24／24 | 58.7% | 0.4%（已全部顯現，只剩雜訊） |
| 0（循環回到起點） | 0／24 | 3.2% | 55.4% |

相對 t=0 的變動像素隨時間單調增加、到 144 幀飽和，t=144 → 200 只剩 0.4% 雜訊；回到 t=0 後 24 段全部消失。回到起點的 3.2% 殘差是 RTX 時間累積留下的淡殘影（差異圖集中在建物立面反射），USD 讀回為 0 段可見，不是可見性失敗。前段變動量大是因為上層流線速度快，前 4 段就涵蓋了它們的大半長度；這是 CP3 正規化方式的設計選擇，不影響技術判定。

![P1 growth](p1_growth_segments_iso.png)

**判定：PASS（方案 a）**。依規則在第一個可行方案停止，方案 (b) 時間取樣 `widths` 未在 Kit 執行（產生器已支援 `--growth widths`，單元測試涵蓋）。

**對 CP3 的影響**：N3.4 採用「分段 prim＋時間取樣 `visibility`（invisible → inherited）」。每段只有 2 個 token 時間取樣，層檔成本幾乎全在幾何本身（見 P5）。剛回到循環起點時會有 1 秒內的 RTX 殘影，屬顯示特性，不需處理。
