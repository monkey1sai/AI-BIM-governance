# tools/cfd — 建築風場 CFD 離線 PoC（計畫書 P1）

對應 `docs/plans/building-energy-cfd.md` 的 P1「本機概念驗證（離線、不接產品 UI）」。
這是功能模組，不是服務；不接 A1–A10、不進 Kit runtime。結果只供設計比較，不是法規或標章依據。

**程式位置（P2 S1 起）**：pipeline 程式碼在 `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/cfd_pipeline/`，由 host-native conversion service 的 CFD job（`cfd_job_service.py`，`/api/cfd-runs`）與本 CLI 共用。`tools/cfd/bimcfd/__init__.py` 只是把 `bimcfd` 的 `__path__` 指到該套件的薄殼，因此 `python -m bimcfd …` 與 `tools/cfd/tests` 照舊可用，程式只有一份。

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
& $py -m bimcfd converge --shell <work>\pre\shell.stl --conversion-dir <conv> --preprocess-dir <work>\pre --out <work>\converge --run-id <run> --cells 8,6,4.5 --direction 0
& $py -m bimcfd record --run-id <run> --case <work>\case_w000 --conversion-dir <conv> --preprocess-dir <work>\pre --out <work>\results --validation-level mesh_convergence_checked --validation-evidence <work>\converge\mesh_convergence.json
& $py -m pytest tests -q
```

### 自動延長與品質層級（S5b）

- `run-case`／`batch`／`converge`／job service 在第一趟 `Allrun` 結束但 `log.simpleFoam` 沒有 `SIMPLE solution converged` 時，會寫 `Allcontinue`（`foamDictionary` 把 `endTime`／`writeInterval` 提到 2 倍，`runParallel -s continue` 從 latestTime 續解，`reconstructPar -latestTime`）並**只延長一次**；`run_summary.json.extended_to`、`case_meta.json.extension`、run record `solver.end_time_effective`／`extended_once`、result `directions[].end_time_extended_to` 都會記下來。續解的判定以 `log.simpleFoam.continue` 為準。
- `converge`：同一風向跑三個背景格尺寸（建物面／區域細化層級相同），在行人面（建物 bbox 外擴 3H 內）取 `U_max`／`U_mean`／`U_p95`、建物面取 `p_min`／`p_max`，依 Celik et al. (2008) 三網格法算 apparent order、Richardson 外插與 fine-grid GCI（Fs 1.25），輸出 `mesh_convergence.json`（`cfd-mesh-convergence/v1`）與 `mesh_convergence.svg`（無繪圖套件）。`verdict.pedestrian_within_5pct` 只是設計比較用的門檻，不是法規判定。
- `converge --refinement-box isotropic`：細化盒改為以建物平面外接圓為準（半徑 R＋同樣的 1H／2H 邊距），所有風向同一個盒子，格數不再隨 bbox 旋轉變動（S5b-2 網格重測用；預設仍為 `bbox`）。
- `aij-case-c`（S5b-2）：AIJ UWE Case C 方塊基準（Zenodo 10.5281/zenodo.15401792，CC BY 4.0；`RS_caseC.csv`／`AF_caseC.csv` 放本機 `--data-dir`，不入版控）。程式自建 3×3 個 0.2 m 立方體（中心距 0.4 m，中央 0D／1D／2D），依 `--scale`（預設 75，讓 1.5 m 行人面＝0.1D）放大；入流以 AF 剖面做 log-law 擬合取 `z0`、`uref` 取 z=D；風向 270°（吹向 +x）對應 AIJ WD 0；在量測點以 IDW 取行人面 |U|，兩邊各以「量測高度的來流風速」正規化後算 hit rate（AIJ 門檻 66%）、FAC2、R、FB、NMSE，輸出 `aij_case_c_comparison.json`＋散點 SVG。只支援 WD 0；22.5／45 需旋轉方塊陣列而非入流。
- run record 的 `validation_level`：service 的 run 一律 `screening`；`record --validation-level mesh_convergence_checked|benchmark_compared` 必須附 `--validation-evidence`（研究文件路徑，記 sha256），否則拒寫。

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
