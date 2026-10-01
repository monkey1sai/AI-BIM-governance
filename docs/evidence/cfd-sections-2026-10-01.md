# CP8 標準與自訂剖面

需求正本：[呈現契約 N6／§6](../plans/cfd-presentation-parity-contract.md)。截至本提交，程式與本機檢查完成；合併、部署及可見 Chrome 新算例驗收尚未完成。本文件不宣稱 runtime 完成。

## 行為與相容性

- 新 presentation v2 算例由同一最終時間的 U/p 取樣，產生 Z=ground+0.25/0.5/0.75H 與 footprint 面積形心 X/Y 標準面，最多再加八個模型軸向自訂面。點與法向旋至 solver 座標，顯示再逆旋；沒有改變求解域、邊界條件或網格。
- Request 新增 optional `sampling.sections[{axis,position_m}]`；超過八個、非有限值或域外位置，在排隊前回 400。自訂域判斷需要相同 conversion、模型 SHA 與前處理設定的既有外殼；沒有則回 `section_domain_unavailable`，面板明示先產生標準取樣。這個保守限制避免把粗略 bbox 當成精確計算域。
- `sampling` 為手寫契約欄位，記入 ledger origin 並保留 idempotent replay 原紀錄；不加入計算設定 catalog，不改 cell/time estimate。Result presentation 的 ground/height 為 optional，新 section/section_vectors 皆以明確 invisible opinion 預設隱藏。舊結果不出現無資料的剖面按鈕；CLI presentation v1 與 golden 保持相容。
- 缺少任何宣告面在同一最終時間的 VTK 會拒絕後處理；真正零風速保留空向量層且不假造箭頭。剖面向量沿用既有 arrow sampler，標記不投射陰影。
- 延伸既有 `clipPlaneRequest` 讀取、`overlayVisibilityRequest` 讀取與 `cameraViewRequest` restore；仍維持原有 primary/authority gate。讀回包含實際裁切持有狀態、圖層 visibility、相機視角及 centerOfInterest。
- 「剖面檢視」依序取得 Kit 圖層、裁切（相機側 0.05m）、正視角及正交投影 ACK，逐步顯示部分失敗。「離開」回復操作前讀得的裁切、相機與圖層，不假設預設狀態。換 binding/斷線取消舊序列；相同 Stage 重用時還原本功能持有的舊裁切，外部持有的裁切不覆寫。
- HUD 與 PNG/WebM 共用繪製器，新增 footprint/cutline 或樓高、北向與剖面位置。標示外部風場、建物為實體，不宣稱室內模擬。

## VERIFIED：本機檢查

| 檢查 | 本次結果 |
|---|---|
| viewer `npm test` | 2,920 passed |
| viewer typecheck、session-first、struct-log、build | exit 0；struct-log 23 passed |
| Kit vocabulary／CFD catalog `--check` | current |
| coordinator `npm test` | 2,505 passed（本切片先前結果，修正未影響） |
| coordinator build／contract check | exit 0／current（本切片先前結果，修正未影響） |
| streaming＋root `pytest bim-streaming-server/tests tests` | 2,325 passed、8 skipped、20 warnings |
| tools/cfd `pytest tests` | 268 passed，含既有 golden（本切片先前結果，修正未影響） |
| canonical `scripts/deploy.ps1 -DryRun` | exit 0，未實際部署或重啟 |

平台跳過、ifcopenshell 清理及既有 React/打包警告不算額外通過證據。新增測試涵蓋四風向加真北旋轉、面積形心、缺檔、零值、同步 400、不入 queue、履歷 replay、四步部分失敗、實際狀態復原與 late reply 取消。

第一輪獨立需求與程式審查各發現一項 P2，已先建立失敗回歸再修正：自訂 Z 高於屋頂或低於模型地面時，小圖延伸高度範圍並保留真實屋頂 H；由透視切到正交、進出剖面再切回透視時，保留原相機鏡頭。另補 33 項圖層的 32＋1 批次、第二批失敗後原狀復原。修正後受影響的 viewer 與 streaming＋root 完整檢查已重跑；coordinator、CFD tools 沿用本切片先前通過且修正未影響的結果。

需求與程式兩軸在 `086a86f924db9fe9ef2c866b7e82cb911f7390e7` 複審均為 P1＝0、P2＝0。需求軸另提出一項非阻擋的檢查範圍措辭建議，已依上表與本段限定。本次審查為 advisory，不代替 PR required check 或真站證據。

## 尚未驗證與放行條件

尚未使用真 OpenFOAM、串流 Kit 或可見 Chrome 驗證本切片；離線資料與假容器不能取代這些證據。獨立雙軸審查及 protected PR 流程後，canonical 部署已合併 main，再完成一次單向含兩個自訂面的新 steady run、標準/自訂剖面切換、四步 ACK、退出還原及帶小圖的 PNG。另量測 layer 大小與附加耗時，對照 P5 上限。

本切片不重跑已耗盡預算的非穩態試驗；非穩態 U/p 時間同步與 CP9/CP10 仍是各自未完成事項。此次附帶更新已完成導航的去識別真站證據，沒有重做導航功能。

## 後續真站結果

上述未驗證狀態為原提交時點。PR #1010 補齊 authority read/restore，PR #1011 修正裁切方向後，七個自動切面、原生 PNG 與透視／正交復原已在可見 headed Chrome 通過。完整數字、畫面及仍未解除的大小／箭頭／色階限制見 [CP8 真站驗收](cfd-sections-live-2026-10-01/README.md)。
