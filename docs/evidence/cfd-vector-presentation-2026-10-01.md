# CP4 行人面向量與場景風向箭頭

## 實作與取捨

- 沿用CP3 service-only presentation v2，CLI/golden與舊結果不增加箭頭。只改後處理，不變更求解設定、API或schema。
- 模型座標規則網格，格距max(2m,最大平面範圍/60)，在原取樣多邊形的三角形內插值U，保留沒有資料的孔洞；速度低於0.05m/s或非有限值不畫，最多5000支。
- 箭頭長度0.9×格距×min(|U|/圖例上限,1)，位置高於取樣面0.05m，方向為模型座標完整U。取樣器可用不同平面軸供CP8共用。
- 採CP1已驗證的PointInstancer單一原型與逐實例顏色；圖例加入向量prim，presentation回報vectors/wind_arrow且預設顯示。
- 場景風向箭頭在上游並指向下風，屋頂上方0.1H、深色，提高CP1白色低位箭頭的可見性；俯視與等角仍須真站驗收。壓力外殼色彩writer不在本切片修改。

## 驗證

- 新增真USD方向測試：四個風向×兩個真北角度，核對實際quaternion、顏色數、位置、長度、預設visibility與場景箭頭方向；另驗證線性插值、孔洞、上限、低/非有限速度與舊writer相容。
- 初輪受影響套件257 passed/1 failed；唯一失敗為service圖例測試仍期待舊prim清單，已同步新增vectors契約期望。修正後方向與streaming runner targeted 28 passed。
- 修正後完整CFD tools、streaming runner與root CFD契約258 passed，包含golden hash；僅1項既有Starlette deprecation warning。
- 獨立Spec審查重現凹多邊形扇形拆面會跨越凹槽；已改為保留拓樸的ear clipping。新增順／逆時針U形面測試，25個候選位置只保留13個有效點，凹槽沒有箭頭且線性U正確；退化面不產生資料。另補真USD逐速度RGB與長度飽和斷言。
- 審查修正後完整CFD tools、streaming runner與root CFD契約262 passed／1項既有warning。本機既有結果的34697個面產生3486支箭頭，採樣1.32秒；此為後處理量測，不代表Kit載入或真站驗收。
- 新算例、俯視/等角與逐層真站驗收尚未完成，待獨立審查、PR/CI、合併部署後補證據。
