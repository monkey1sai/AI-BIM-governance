# CP8 真站命令補修（2026-10-01）

PR #1009 的本機檢查與獨立審查通過後，真站仍拒絕剖面切換前的裁切讀取。本文件保留失敗證據與補修範圍，不把工程檢查視為真站完成。

## 已觀察的問題

- 真站已完成一次含五個標準剖面、兩個自訂剖面的 steady run，ready、483 iterations、殘差收斂、1,689,260 cells、16 分 51 秒。七個剖面都有實際 sampled polygons。
- 疊圖取得 Kit 成功 ACK；按下標準剖面後，原裁切讀取收到 `commandRejected / invalid_payload`，序列停止且沒有執行後續裁切、圖層或相機寫入。
- `clipPlaneRequest` 的新 `action: read` 在 `x-kit-command.context` 遺漏，Kit 提取的 authority context 成為空物件；coordinator 的手寫 schema 也僅接受舊裁切寫入。
- 同一條呼叫路徑的 `cameraViewRequest / restore` 未傳送 `camera`，coordinator 也未接受 restore；圖層讀取省略 `visible` 的格式亦未同步。

## 補修

契約 metadata 加入裁切 action、相機 camera，重新生成三份命令詞彙；coordinator 僅增補封閉的 read、restore 及圖層讀取格式。相機復原限制有限數值、位置與距離上限、正交方向基底、投影欄位相依及焦點距離一致。

三類命令仍沿用原 primary/runtime lease、source client 與 session lifecycle authority；不改 command mutation 分類，不增加任意 transform 或 camera attribute 授權。

## 基線與驗證範圍

補修前新增回歸重現：Kit 裁切 context 遺失 action（1 failed），coordinator 六個合法 CP8 context 均被拒。補修後的相關測試涵蓋合法讀取/復原、混合與未知欄位拒絕、數值/投影/基底檢查，及旁觀者、失效租約、錯誤 client、關閉 session 拒絕。完整檢查與部署後 Chrome 驗收結果待記錄，尚未宣稱修正後真站通過。

本機完整檢查：coordinator **2,528 passed**；streaming/root **2,327 passed、8 skipped、20 warnings**（平台跳過與既有 IFC 釋放警告不算通過）；viewer **2,920 passed**。coordinator build/contract check、viewer typecheck/session-first/struct-log（23 tests）/build、三份詞彙生成檢查、安全檢查單元測試（8 tests）及 canonical deploy DryRun 均 exit 0。第一次 viewer 完整檢查指出生成器仍期待舊 context 欄位，更新該回歸期望後完整重跑通過；coordinator 測試表格的 tuple 型別編譯錯誤修正後 targeted tests 100 與 build/contract check 通過。另一次以 Node runner 執行 Vitest 檔案屬測試工具使用錯誤，未算成通過或改動產品補救。

## 大小與效能限制

同一真站七剖面 artifact 為 **28,186,047 bytes**，超過 P5 約 25 MB 目標；舊 baseline 為 **14,486,728 bytes**。單次暖載入到 Kit ACK 為舊 **344 ms**、新 **372 ms**，增加 **28 ms**，低於附加 5 秒目標，但不能推論冷啟動、任意 GPU 或最大十三剖面效能。

本機分析確認七剖面的座標/速度頂點全部唯一，無法靠合併完全重複頂點減少大小；獨立診斷複本的精確顏色索引僅降到 **25,741,280 bytes**，因此此補修不引入該編碼。保持完整取樣及七剖面，不縮小計算域、不覆寫 ready artifact。**大小目標未達；最大十三剖面的真實模型效能尚未驗證。**

資料與畫面包含私有專案資訊，原 console 含租約識別；僅數值與去識別化結果入版控。原 BIM、CFD 外殼、近壁薄膜及切面取樣的精度限制仍為 screening/design comparison。
