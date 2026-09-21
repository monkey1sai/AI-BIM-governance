# tools/cfd — 建築風場 CFD 離線 PoC（計畫書 P1）

對應 `docs/plans/building-energy-cfd.md` 的 P1「本機概念驗證（離線、不接產品 UI）」。
這是功能模組，不是服務；不改任何 service、不接 A1–A10、不進 Kit runtime。結果只供設計比較，不是法規或標章依據。

## 輸入與輸出

| 階段 | 輸入 | 輸出 |
|---|---|---|
| `preprocess` | 一次成功轉檔的 `model.usdc` | `shell.stl`（體素包覆外殼）、`exclusions.json`（剔除清單：GlobalId、類別、原因）、`preprocess_stats.json`（含 `sealing_*` 洩漏指標） |
| `make-case` | `shell.stl`、`geo_reference.json`（真北）、風向 | OpenFOAM case（blockMesh → snappyHexMesh → simpleFoam，k-ω SST，ABL 入流；COST 732 計算域、阻塞比 ≤ 3%） |
| `run-case` | case 目錄 | 在 `opencfd/openfoam-default:2412` 容器內執行 `Allrun`；`run_summary.json` 記錄映像 digest |
| `postprocess` | case 的 `postProcessing/`、`model.usdc` | `cfd_<run>.usdc`（結果 layer，只寫 `/World/Overlays/Cfd/<run>`）、`cfd_view_<run>.usda`（sublayer 原模型＋結果） |
| `record` | 以上全部 | `run_record.json`（`cfd-run-record/v1`：來源 SHA-256、profile、剔除清單雜湊、網格統計、solver 映像 digest、殘差、輸出雜湊） |

## 執行

使用 repo 根目錄的 `.venv`（已有 numpy、pxr）。不需要額外 pip 套件。

```powershell
$py = "<repo>\.venv\Scripts\python.exe"
cd tools\cfd
& $py -m bimcfd preprocess --model-usdc <conv>\model.usdc --out <work>\pre
& $py -m bimcfd make-case --shell <work>\pre\shell.stl --geo-reference <conv>\geo_reference.json --wind-from 0 --out <work>\case_w000 --cell 6
& $py -m bimcfd run-case --case <work>\case_w000
& $py -m bimcfd postprocess --case <work>\case_w000 --model-usdc <conv>\model.usdc --run-id <run> --out <work>\results
& $py -m bimcfd record --run-id <run> --case <work>\case_w000 --conversion-dir <conv> --preprocess-dir <work>\pre --out <work>\results
& $py -m bimcfd batch --shell <work>\pre\shell.stl --model-usdc <conv>\model.usdc --conversion-dir <conv> --preprocess-dir <work>\pre --out <work>\batch16 --directions 16 --cell 6
& $py -m pytest tests -q
```

輸出檔名：結果 layer `cfd_<run>.usdc`（run id 已以 `cfd_` 開頭時不重複加前綴）、包裝 stage `cfd_<run>_view.usda`。

## 慣例

- 風向為氣象慣例（風的來向，自真北順時針）；模型 +Y 為 project north，真北角度來自 `geo_reference.json`。真北缺失時以 project north 代替並在 `case_meta.json.assumptions` 標記，不推算。
- 求解永遠在「風沿 +X」的座標系；外殼先旋轉 `alpha`，結果寫回 USD 前旋轉 `-alpha`。
- 幾何以體素包覆（純 numpy：表面取樣 → 形態學閉合 → 由外部 flood fill → 取最大分量 → 邊界面）。體素邊界面在建構上必然封閉，`watertight` 只守住抽取程式；真正的「有沒有包住建物」看 `sealing_*` 指標：另跑一次大半徑（預設 8 格）閉合當作密封參考體積，工作半徑保留體積的短少就是外部空氣經開口灌入的體積（`leak_volume_m3`、`leak_fraction`），超過 `leak_fraction_limit`（0.10）即 `sealing_suspect`，CLI 回 exit 7。預設閉合半徑 4 格（0.5 m 體素 → 封到 4 m 寬的開口）。
- IFC、USDC、STL、OpenFOAM 產物一律不入版控。

## Kit 載入證據（P1.3）

`kit/open_stage_capture_and_quit.py` 在 Kit 內以 `--exec` 執行：開包裝 stage → 等資產載完 → 於 session layer 補預設燈光（IFC 轉出的 stage 沒有燈，否則截圖全黑）→ 截 viewport → 寫 `kit_evidence.json` 後退出。

```powershell
cd bim-streaming-server\_build\windows-x86_64\release
.\kit\kit.exe apps\ezplus.bim_review_stream.kit --no-window --portable-root <work>\kit_portable `
  --ext-folder <repo>\bim-streaming-server\source\extensions --/app/fastShutdown=1 `
  --exec "<repo>\tools\cfd\kit\open_stage_capture_and_quit.py --usd-path <work>\results\cfd_<run>_view.usda --out-dir <work>\kit_evidence"
```

（`<repo>`＝主 checkout，`<work>`＝本機工作目錄；Kit 執行檔在 `<repo>\bim-streaming-server\_build\windows-x86_64\release`。）

```powershell
```

2026-09-21 真檔實測紀錄與去識別化證據見 `docs/plans/building-energy-cfd.md` §6.1 與 `docs/evidence/cfd-p1-poc-2026-09-21/`。
