# 轉換事實與用途紀錄

第五刀建立 Streaming → Coordinator 的後端切片。沒有新增 HTTP route／回覆欄位、產品環境變數、migration 或部署入口；正式線上／PDF／CSV 與來源授權由第六刀交付。Pipeline 內部回傳 validation_record 發布結果（stored / replayed / not_recorded），既有 HTTP ingest 不轉傳此欄位；發布失敗不回滾已完成的 conversion/outbox。

## Producer 與來源綁定

- host-native adapter 的一般、fallback 與 ifcopenshell_openusd_identity 路徑共用 metadata 完成 hook。程序控制、轉換 authority 與既有 ready gate 不變。
- source_fingerprint / ifc-source-fingerprint/v1 保存實際 IFC SHA256、檔案大小、model version 及讀取前後一致性觀測；ETag 不當 SHA256。
- conversion_validation / conversion-validation-facts/v1 保存實際 source inventory、分型統計、expectedElements、missing/excluded、USDC/mapping SHA256、逐 GUID/prim correspondence、單位觀測、檢查狀態、validator版本與實際檢查時間。
- source inventory 直接枚舉 IFC IfcProduct：有 Representation 者列為預期構件，沒有者逐 GUID 記 non_renderable。重複／無效 GUID 不去重冒充完整；失敗／不支援但有 Representation 的構件仍在分母。分母不由成功 mapping 或 USD prim 反推。
- USD只檢查本地產物：外部 layer reference 不作已驗證資產；mesh 檢查包含有限座標／變換與面索引。mapping 要同時符合來源 GUID、實際 prim、自訂 IFC identity 及可渲染 mesh；有 GUID 宣告不等於已對應。
- 檢查前後重核來源與產物；metadata 原子寫入後由既有 authority 計算 artifact digest。Coordinator 只讀固定 configured origin/job/metadata URL，禁止 redirect，10秒與4MiB上限，核對metadata bytes SHA、tenant/project/model/job/correlation、內含 source/artifact hashes。這是 Streaming 事實的信任邊界，不是第三方認證。

## 用途判定

結果為 usable / usable_with_limits / not_usable / not_validated。任何必要 check 明確 fail 優先產生 not_usable；unknown / not_run / execution_failed 不當模型失敗，也不放行。沒有全域覆蓋率門檻。

用途的技術必要條件由 versioned server-owned baseline 定義；必要構件透過 createCoordinatorApp 的內部 conversionValidationScopes 設定，綁 tenant/project/model version/source SHA、用途、scope id/version 與明確 requiredGuids。設定不可來自 HTTP 或 converter metadata。未配置時 required_components=not_run；未核准代表 IFC／用途必要構件前不會自動授予 usable。

- view_3d：source、有效USD、mesh、座標對齊、完整度與必要構件。
- locate_highlight：source、有效USD、mesh、座標對齊、mapping與必要構件。
- distance_measurement：另須單位及已核准參考距離／容差。
- ifc_rules：使用 source inventory 與 IFC rule authority 結果，不以 USD/mapping 失敗全域阻擋；必要構件依來源 GUID 存在判定。

validator v2 另執行獨立 IFC world-coordinate tessellation，逐 mapped GUID 比對實際 USD points 經 world transform 與 metersPerUnit 換算後的 AABB；方法為 ifc-usd-world-aabb/v1，固定絕對容差 0.001 m。成功僅為 coordinates=pass_with_limits：包圍盒一致不能證明曲面、地理參考、Viewer 操作或工程量測精度。任何已比對 GUID 超限為 fail；缺參考為 unknown，例外為 execution_failed；未知單位、非 Z-up frame 不推定成功。未轉出的 GUID 仍留在來源分母與用途必要構件 gate。

optional coordinateEvidence 保存方法、容差、mapped/checked 數、最大偏差、mismatch/unavailable GUID；Coordinator 交叉核對 correspondence 與 check 狀態。舊 v1 facts 可讀，v2 的座標成功必須附證據。identity profile 保留 mesh-local Float32 points，新增 double placement transform；root-frame bbox 用轉換後完整頂點計算，不重複套 IFC 單位。

量測 reference 與 IFC rule authority 在本 producer 未執行，標 not_run。production 預設不配置用途 scope；本次使用者指定許良宇圖書館 IFC 並委託撰寫用途，範圍與實測見 [圖書館用途驗證](../evidence/conversion-purpose-validation/library-validation.md)。驗證 tenant/project 是隔離 context，不構成正式環境授權或 MinIO enrollment。

## 持久化與相容性

沿既有 conversion-ledger/v2 保存 conversion-validation-record/v1，不新增第二份 ledger。每份record綁 source/artifact identity、producer facts、scope/policy snapshot與判定；相同ID相同內容重送可replay，異內容衝突拒絕，重新檢查或scope改版新增record。重讀時驗schema、來源／facts／policy一致並重算判定，拒絕被改寫的結論。

terminal status與artifact一起原子保存；persist失敗回復記憶體狀態，不能留下只存在記憶體的成功。v1 ledger讀取時不信任validation history；壞檔或未知版本保持不可寫。publicConversionRecord排除internal history與ready descriptor；第六刀才能提供受來源權限保護的歷史報表。

## 驗證與限制

- 既有host-native轉換、fallback、identity、containment測試；新增fingerprint與真CPU IfcOpenShell/OpenUSD分析幾何fixture。
- 檢查獨立分母、缺漏、mapping偽造、source drift、單位未知、可開啟但壞mesh、scope租戶／版本漂移、record竄改、持久化失敗與restart/replay。
- 解析幾何 fixture 驗證非零位移、巢狀旋轉、公分單位、mesh-local extent/root-frame bbox，另有故意移位、錯誤尺度、來源 geometry 失敗與不支援 frame 負向案例。真圖書館 IFC 執行全量轉換、座標 bounds、HTTP metadata 與持久化驗證；均不包含 Kit/WebRTC/GPU 或前端驗收。
- GitNexus 1.6.9 exact worktree stale 重建遇 Invalid UTF-8，維持 UNKNOWN；依新增 flow 的限定 reviewer sign-off，以 source/regression/真模型驗證補強，不標為 GitNexus pass。
