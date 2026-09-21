# tools/cfd — 建築風場 CFD 離線 PoC（計畫書 P1）

對應 `docs/plans/building-energy-cfd.md` 的 P1「本機概念驗證（離線、不接產品 UI）」。
這是功能模組，不是服務；不改任何 service、不接 A1–A10、不進 Kit runtime。結果只供設計比較，不是法規或標章依據。

## 輸入與輸出

| 階段 | 輸入 | 輸出 |
|---|---|---|
| `preprocess` | 一次成功轉檔的 `model.usdc` | `shell.stl`（封閉外殼）、`exclusions.json`（剔除清單：GlobalId、類別、原因）、`preprocess_stats.json` |
| `make-case` | `shell.stl`、`geo_reference.json`（真北）、風向 | OpenFOAM case（blockMesh → snappyHexMesh → simpleFoam，k-ω SST，ABL 入流；COST 732 計算域、阻塞比 ≤ 3%） |
| `run-case` | case 目錄 | 在 `opencfd/openfoam-default:2412` 容器內執行 `Allrun`；`run_summary.json` 記錄映像 digest |
| `postprocess` | case 的 `postProcessing/`、`model.usdc` | `cfd_<run>.usdc`（結果 layer，只寫 `/World/Overlays/Cfd/<run>`）、`cfd_view_<run>.usda`（sublayer 原模型＋結果） |
| `record` | 以上全部 | `run_record.json`（`cfd-run-record/v1`：來源 SHA-256、profile、剔除清單雜湊、網格統計、solver 映像 digest、殘差、輸出雜湊） |

## 執行

使用 repo 根目錄的 `.venv`（已有 numpy、pxr）。不需要額外 pip 套件。

```powershell
$py = "C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe"
cd tools\cfd
& $py -m bimcfd preprocess --model-usdc <conv>\model.usdc --out <work>\pre
& $py -m bimcfd make-case --shell <work>\pre\shell.stl --geo-reference <conv>\geo_reference.json --wind-from 0 --out <work>\case_w000 --cell 6
& $py -m bimcfd run-case --case <work>\case_w000
& $py -m bimcfd postprocess --case <work>\case_w000 --model-usdc <conv>\model.usdc --run-id <run> --out <work>\results
& $py -m bimcfd record --run-id <run> --case <work>\case_w000 --conversion-dir <conv> --preprocess-dir <work>\pre --out <work>\results
& $py -m pytest tests -q
```

## 慣例

- 風向為氣象慣例（風的來向，自真北順時針）；模型 +Y 為 project north，真北角度來自 `geo_reference.json`。真北缺失時以 project north 代替並在 `case_meta.json.assumptions` 標記，不推算。
- 求解永遠在「風沿 +X」的座標系；外殼先旋轉 `alpha`，結果寫回 USD 前旋轉 `-alpha`。
- 幾何以體素包覆（純 numpy：表面取樣 → 形態學閉合 → 由外部 flood fill → 取最大分量 → 邊界面），封閉性以「邊界邊數 = 0」驗證。
- IFC、USDC、STL、OpenFOAM 產物一律不入版控。
