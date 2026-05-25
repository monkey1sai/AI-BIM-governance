# FU4:HOOPS A3D Primary Path 修復評估(2026-05-25)

## 結論

**Out of scope — 維持 deferred,不在本 repo 修復範圍。**

## 為什麼 vendor-side 限制

HOOPS Asset Converter / A3D 是 NVIDIA Omniverse Kit 內建的 commercial
asset import library(vendor:NVIDIA + Tech Soft 3D HOOPS family)。
2026-05-22 `fix-ifc-usdc-hoops-load-failure` archive 已確認:

- 主要 IFC fixture(`storage/許良宇圖書館建築_2026 - 轉檔測試*.ifc`,341MB)
  進入 Kit/HOOPS `convert-ifc-to-usdc.ps1` 後,A3D library 拋
  `A3D_LOAD_CANNOT_LOAD_MODEL` / `-10007` 並終止 import。
- `kit-stderr.log`(由 `streaming-server-capture-kit-conversion-logs` archive
  落地)清楚顯示是 A3D 內部 import 階段 fail,並非 prerequisite / file 路徑
  /licensing 問題。
- 同一 IFC 用 `ifcopenshell.open(...)` 可成功解析(schema `IFC4`,4889
  entities,geometry iterator 可產出 mesh)。
- 因此根因不在我方 code,不在 IFC 檔案,而在 vendor library 對該 IFC 表達
  的支援度。

## 本 repo 不可控的部分

1. **HOOPS A3D library binary 為 closed-source vendor binary**(隨 Omniverse
   Kit SDK 分發),我方無 source code 可 patch。
2. **沒有 NVIDIA / Tech Soft 3D vendor 支援管道**:本 session 沒有 vendor
   bug bounty channel、不在 vendor SLA 期內、無 license 升級權限。
3. **替換 importer 不在 fast MVP scope**:替換為 IFC.js / Speckle / Forge
   etc. 屬於 Phase 5 platform capability,需要新 OpenSpec change 與 capability
   ADD。

## 本 repo 已做的緩解(2026-05-22 + 2026-05-25 已 archive)

| Change | 緩解動作 |
|---|---|
| `2026-05-22-fix-ifc-usdc-hoops-load-failure` | 加 `IfcOpenShell + OpenUSD` fallback path,A3D 失敗時自動接手產出可開啟 `model.usdc`,viewer / coordinator 不需感知 HOOPS 失敗 |
| `2026-05-25-streaming-server-capture-kit-conversion-logs` | 把 Kit/HOOPS stdout/stderr async capture 進 `kit-stdout.log` / `kit-stderr.log`,operator 可直接 tail 看 vendor error code,不用 reproduce |
| `2026-05-25-streaming-server-fallback-semantic-mapping` (本輪 C1) | fallback 補 IFC class grouped prim path + ifc_type/name/entity_id mapping,讓 fallback 產出對 viewer / `/ui` 是「Semantic-equivalent」結果,不再只是 shape-level placeholder |

## 下一步建議(不在本輪 scope)

1. **Vendor 通報**:把 `A3D_LOAD_CANNOT_LOAD_MODEL` 加 IFC fixture sample 透過
   NVIDIA Omniverse forum / Tech Soft 3D HOOPS support 報 bug,等 vendor
   library 升級
2. **試新版 Omniverse Kit**:若 Kit SDK 有新版本(2026 Q3 之後),嘗試升級
   後重跑同一 IFC,看 HOOPS 是否已支援
3. **替換 importer 計畫**:評估 IFC.js / pythonOCC / web-ifc 作為 long-term
   alternative,寫新 OpenSpec change(候選 change-id:
   `evaluate-alternative-ifc-importer-pipeline`)

## 對 fast MVP 的影響

**零阻塞**。fallback path 已能讓:
- conversion_status=ready
- viewer 開 stage 成功
- Semantic ready=yes(C1 fallback mapping fidelity 升級後)

HOOPS primary path 修不修,fast MVP demo 都可走完閉環。本評估是 advisory,
不阻擋本輪 follow-up 收尾。
