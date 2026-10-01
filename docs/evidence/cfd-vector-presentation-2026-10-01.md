# CP4 行人面向量與場景風向箭頭

## 實作與取捨

- 沿用CP3 service-only presentation v2，CLI/golden與舊結果不增加箭頭。只改後處理，不變更求解設定、API或schema。
- 模型座標規則網格，格距max(2m,最大平面範圍/60)，在原取樣多邊形的三角形內插值U，保留沒有資料的孔洞；速度低於0.05m/s或非有限值不畫，最多5000支。
- 箭頭長度0.9×格距×min(|U|/圖例上限,1)，位置高於取樣面0.05m，方向為模型座標完整U。取樣器可用不同平面軸供CP8共用。
- 採CP1已驗證的PointInstancer單一原型與逐實例顏色；圖例加入向量prim，presentation回報vectors/wind_arrow且預設顯示。
- 場景風向箭頭指向下風，採深色。真站發現原先依全場地外框放大並放在上游，會被建築聚焦畫面裁切；修正為上方四分之一高度的建物表面點之外框中心，屋頂上方0.2H，長度為min(0.8H, 0.6×屋頂最大寬度)，沒有屋頂資料時以既有外框中心回退。低矮的長附屬構造不再放大或推遠箭頭。壓力外殼色彩writer不在本切片修改。

## 驗證

- 新增真USD方向測試：四個風向×兩個真北角度，核對實際quaternion、顏色數、位置、長度、預設visibility與場景箭頭方向；另驗證線性插值、孔洞、上限、低/非有限速度與舊writer相容。
- 初輪受影響套件257 passed/1 failed；唯一失敗為service圖例測試仍期待舊prim清單，已同步新增vectors契約期望。修正後方向與streaming runner targeted 28 passed。
- 修正後完整CFD tools、streaming runner與root CFD契約258 passed，包含golden hash；僅1項既有Starlette deprecation warning。
- 獨立Spec審查重現凹多邊形扇形拆面會跨越凹槽；已改為保留拓樸的ear clipping。新增順／逆時針U形面測試，25個候選位置只保留13個有效點，凹槽沒有箭頭且線性U正確；退化面不產生資料。另補真USD逐速度RGB與長度飽和斷言。
- 審查修正後完整CFD tools、streaming runner與root CFD契約262 passed／1項既有warning。本機既有結果的34697個面產生3486支箭頭，採樣1.32秒；此為後處理量測，不代表Kit載入或真站驗收。
- 新算例、俯視/等角與逐層真站驗收尚未完成，待獨立審查、PR/CI、合併部署後補證據。

## 真站驗收修正

- 初版已完成新算例與Kit載入、向量及風向箭頭顯示讀回；俯視正交與等角實際截圖確認場景箭頭被裁切，判定呈現未通過。私有模型截圖保留於本機交接證據，不加入公開儲存庫。
- 根因是低附屬結構把場地範圍擴大，場景箭頭長度跟隨全場地最大寬度；與已完成的建築聚焦範圍不一致。本次僅修新增箭頭後處理，不改相機、聚焦、求解或既有artifact。
- 新增長200m場地、20m屋頂的回歸：箭頭長12m、位於屋頂中心上方，XY不越過屋頂外框。CFD tools及streaming job/runner/options/conversion authority共383 passed、1項既有Starlette warning。四風向×兩真北值與CLI golden仍通過。
- 修正後真站畫面尚未驗證；需合併部署後新結果，不能拿初版載入或本機測試宣告可用。
