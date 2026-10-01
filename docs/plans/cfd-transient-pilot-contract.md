# 非穩態流場與表面壓力同步：有界首輪

## Owner 決策與範圍

2026-10-01 owner 選定真正非穩態 CFD，同一物理時間同步顯示流場與表面壓力；首輪單次求解占用硬上限30分鐘，到限保存已完成輸出，不自動延長或重跑。建築幾何固定，不包含流固耦合。現有穩態粒子或流線生長不可作為完成證據。

## 第一刀：成本與資料配對探針

`tools/cfd/probes/transient_probe.py` 為離線工具，不修改服務API、既有run、模型或已發布artifact。從成功完成的kOmegaSST算例複製已重建網格及最新U/p/k/omega/nut至全新目錄，初始物理時間重設為0；來源SIMPLE迭代數另外記錄，禁止冒充物理秒數。

- OpenFOAM2412 pimpleFoam、URANS kOmegaSST，Euler首階時間基準，PIMPLE外圈2／壓力修正2。
- 預設物理時段0–10秒、每0.5秒保存，最多20輸出幀；初始dt0.01、maxDeltaT0.02、maxCo1，自適應步長。
- CPU限制4；容器及host兩層在1680秒停止求解，留下120秒清理緩衝，總授權上限1800秒。無自動延長；啟動標記排除同目錄重跑。
- 拷貝輸入上限4GiB、工作目錄上限8GiB；不刪除超限/逾時資料。沿用既有Docker runner的任務名稱停止路徑，禁止停止其他容器。
- 行人面U、外殼p、近壁U皆由同一次surfaces函式在同時間輸出。同一時間資料不完整就列為未完成；不拿別的時間補值。保留每個VTK雜湊、樣本數與時間。
- 只使用主機既有官方映像；缺映像停止，不自動下載。執行前確認無其他CFD求解，再記錄具體來源、目的地與授權範圍。

先以 `--source <completed-case> --case <new-pilot>` 準備，再以 `--case <pilot> --run` 執行一次。不要對原算例使用此工具；目的目錄不得存在或位於來源內。

## 證據與後續交付門檻

首輪保留實際wall time、可達物理秒數、Courant、輸出量與同時間U/p配對。至少兩組完整資料才有時間序列；仍不得宣稱暖機、統計穩定、時間步或網格收斂已驗證。URANS不是直接解析全部瞬時紊流。

下一刀須將明確的transient模式、時間清單與artifact身分納入服務契約，以同一Kit timeline更新流場與表面壓力，HUD顯示物理秒數及模式；暫停、拖動、重播、換run皆須讀回。圖層拓樸不一致或資料缺失必須拒絕組合，不得用假振盪製造壓力變化。

只有通過獨立審查、CI、合併部署、可見Chrome真站相同時間步操作及截圖，才能將使用者要求的「非穩態同步」列為完成。這份探針不單獨構成該功能交付。

## 官方依據

已核對官方OpenFOAM2412映像內 `tutorials/incompressible/pimpleFoam/RAS/pitzDaily/system` 的PIMPLE、Euler及自適應時間字典；本探針maxCo與輸出上限是保守基準設定，並非沿用教程作工程精度保證。

- [OpenFOAM pimpleFoam](https://api.openfoam.com/2312/pimpleFoam_8C.html)
- [OpenFOAM sampling](https://www.openfoam.com/documentation/user-guide/7-post-processing/7.4-sampling-data)
