# A1 材質高亮與 DataChannel 驗收

使用目前分支的隔離建置、真實 IFC 轉出的 USDC 與相符 mapping。正式入口為
`/ui#a1` 或 3D Workspace 的 A1 Dock；Kit 必須由操作者明確啟動。
執行前記錄 source IFC/USDC/mapping SHA256、product HEAD、Kit build closure 與 renderer 設定。

1. 選擇來源並完成 CPU 檢核，確認結果數與問題明細。此步不得建立 Kit lease 或送高亮。
2. 建立／選擇相同來源的 review session，按啟動 3D，記錄 lease、正確 Stage、first frame、DataChannel。
3. 在高亮關閉時切換規則／嚴重度，展開明細；模型外觀與相機應保持不變。
4. 按「在模型中顯示問題」；同場景至少兩種嚴重度、兩種可見顏色，圖例包含文字。
   記錄 request_id、trace、material_overlay ACK、applied/missing/unsupported，以及實際畫面。
5. 一個構件含兩筆不同嚴重度問題時，保持兩筆明細，以最高嚴重度著色。
   隱去較高嚴重度後，列表與模型同步降級；問題數與構件數分列。
6. 明確定位後應有 framing 與選取框，severity colors 保留；左 Stage 樹同步對應 path。
7. 清除選取只移除選取框；關閉問題高亮只還原材質。兩者都不重載 Stage、不重置相機。
8. 同 session 切 A1→A2→A1、開關 Dock／表單，保留 iframe、lease、camera、高亮與篩選。
   新 Stage／CLOSED 清掉舊 overlay，禁止跨來源套用舊結果。
9. 無 mapping／prototype／直接 instance proxy／PointInstancer 的問題仍可閱讀，顯示無法定位。
   stale、authority denial、malformed、timeout、部分套用不能當作完整成功。
10. 記錄 Kit 實際 `/rtx/rendermode` 及帶多色效果的 live frame。renderer_mode ACK、CPU USD
    composition 或健康檢查都不能單獨當成 RTX 視覺驗收。
11. 比對 source USDC 前後 hash、原始 session opinions 與其他 layer 保留；結束時確認本次
    owned processes／sockets 正常退出、只清理本次臨時網路規則。

舊 `/World` demo 僅供事件連通性觀察；不得以根節點替代正確 mapped 構件。
協定與相容性定義見 `docs/contracts/streaming-datachannel-events.md`。
