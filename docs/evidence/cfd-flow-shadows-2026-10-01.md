# CFD 流線陰影修正

使用者在真站指出流線投影到建築與地面；同視角切換 Streamlines 顯示／隱藏後，條狀陰影隨流線消失。原始畫面與 run 身分只保存本機私有證據。

## 修復邊界

Kit 套用 CFD secondary layer 後，在 session layer 對 Streamlines、StreamlineGrowth 子段、FlowParticles、PedestrianWindVectors、WindDirectionArrow 的 renderable Gprim 設定 `primvars:doNotCastShadows = true`。關閉或更換疊圖會清除此項 opinion，重新套用亦補上，因此既有結果不必重算或改寫 artifact。原 BIM、壓力外殼、近壁薄膜與行人面不在此次修改範圍；不關閉全域光源或陰影。

[NVIDIA 官方文件](https://docs.omniverse.nvidia.com/extensions/latest/ext_replicator/annotations_with_transparency.html) 說明 Cast Shadows 的屬性名稱。USD 屬性存在只證明作者層正確；RTX 是否對曲線、點與箭頭採用仍以部署後真站畫面驗收。

## 驗證紀錄

- 真 USD 測試涵蓋五種流動圖層、隱藏生長段、session-only、來源及 root 不變、清理/重套與無關 opinion 保留。
- Composition 測試驗證套用、關閉、重套的清理順序。
- PR #1004 合併版本 `6f49bae` 已經 canonical 開發部署；media gate 通過、health 200。使用者可見 Chrome 重新連線收到正確 session 首幀，重套既有 CFD 結果。
- 真站同視角先只顯示 Streamlines，再隱藏 Streamlines：流線保持可見時已無原先條狀投影，建築與樹木的陰影仍保留；原 artifact SHA-256 在部署前後相同。原始截圖與 hash 僅保存在私有交接紀錄。
- 完整 streaming 測試 881 passed、8 個平台跳過；其中針對變更的 61 項通過。真站像素對照以 Streamlines 為限；粒子、向量及生長段的作者層由 USD 測試覆蓋，未逐類完成同樣像素對照。
- 全部靜態流線同時顯示仍可能遮擋建築，屬於密度與可讀性限制，不因陰影修復而視為已解決。
