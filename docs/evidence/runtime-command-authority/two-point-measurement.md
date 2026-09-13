# 第十一刀：兩點距離量測契約

量測是目前 viewer 的暫時直線讀值。使用者先調整視角，再以「開始兩點量測」進入取點模式；按 Esc／取消可放棄取點，清除可移除結果。相同 session 跨 Dock 保留狀態，模型、Stage、連線或可信租約身分改變後，舊值改為未確認。尚未取得 first frame、Stage matched 與操作權限時不可開始。

## 資料流與權限

- 外側 MeasurementControls → shared ViewportSlotProvider → ReviewSessionViewerPane → exact-origin/source iframe → Window → measurementRequest。瀏覽器只提供 action、measurement_id、request_id 與 viewport UV；UV 排除 contain video 的 letterbox。
- Kit 透過既有內部 runtime-command-authorizations endpoint 取得 `measurement_context`：session_id、client_id、lease_id、binding_id、artifact_ids、policy_id。這是既有成功回應的選用欄位，其他命令回應不變。
- `primary-lease-distance-v1` 由 coordinator 實際判定：有效 primary lease、未失效的 session、同 client 的 confirmed active binding，以及仍 ready 且 URL 相符的 artifacts。browser payload 不能授予 policy。這不建立 SSO、專案 ACL 或持久化量測報告。
- 原始 IFC／USDC 不寫入 repo；本刀不新增環境變數、migration、部署目標或 API route。

## Runtime 與失效

Kit 的原生 `viewport.request_query` 回傳 world-space hit；controller 只接受明確 authored、正有限值的 metersPerUnit，再算兩點歐氏距離。未知單位不使用 USD 預設值。回應有 world points、model units 與 metres，browser 再檢查換算與第一點一致性。

每次 start／pick 都重新查 authority；native callback 後、成功回傳前再確認。HTTP 在受追蹤的單一背景工作執行；逾時不建立更多未結束的工作。每個 viewport 保留單一 controller/native ticket，取消後必須排空遲到 callback 才能再取點，request ID 不可重用。USD notice 先同步更新 revision，再在 owning asyncio loop 取消；相機、時間、解析度、單位、Stage、租約或 binding 漂移均拒絕沿用讀值。

取消以已驗證或暫存的同一 session/client/token 身分比對，只失效自己的工作；pending identity 不授予量測。handler 達容量上限時仍可本地取消，shutdown 不發布遲到結果。透過透明取點面及鍵盤 capture 隔離相機／selection；實際 SDK input 行為仍需真 browser／GPU 證據。

## 驗證用途與限制

沿用許良宇圖書館固定 IFC SHA256 `8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce` 與 USDC SHA256 `e54347dd8d8f072338f98afd9f671de45b9ce000e65d6063aede7d29e014f216`，驗證 native surface hit、模型單位換算、取消／清除及狀態隔離。

參考提案：D11 玻璃門 GUID `3$xKPHQlD10AG1nzmJabuU`，IFC OverallHeight 與原始垂直幾何边均為 2.300 m，建議絕對容差 ±0.020 m。參考與容差尚待使用者確認；CPU 讀取幾何或受控 callback 測試不是原生 GPU 取點驗收。現有 deterministic tests 覆蓋權限、schema、world distance、未知單位、逾時、取消、callback 排空、執行緒與狀態漂移；當輪真模型與瀏覽器證據另列於 PR。
