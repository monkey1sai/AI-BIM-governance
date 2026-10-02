# 明選原面、預覽與不可變版本

本刀接續 `cfd-ground-selected-face-source.md`。它完成來源綁定的選取流程，不宣稱實際地面、有效流體或 CFD 數值已修復。

## 使用流程與產品語意

1. 在 primary viewer 或模型結構選取構件。Kit 的 prim/GUID 選取只限制候選範圍，沒有原 polygon face picking 證據。
2. 展開「行人參考面：明選與預覽」，讀取原面候選。每頁最多 100 個向上候選、檢視最多 5000 個原面；拒絕原因是本頁計數。cursor 綁 exact source SHA、構件及原始排序，讀到末頁才表示此範圍完整。最多 256 Mesh；超過直接拒絕，不默默截斷。
3. 查看原 GUID／Mesh／face index、法向、面積、三個世界公尺座標與高程，明選最多 100 面。屋頂、地下及斜坡向上不等於可行走；不自動補面或推斷地面。
4. 預覽暫時只顯示 primary BIM 與獨立粉紅選取標記。preview 位於 `/GroundSelections`，不是 `/World/Overlays/Cfd`，不產生風場／圖例／run。原面保存原高程，顯示 lift 固定 0.01 m 並明示。每面用局部 float3 頂點加 double anchor，preview 根不繼承 `/World` transform；世界還原誤差超過 1e-4 m、非有限值或退化直接拒絕。
5. 收到 exact preview artifact、非空 binding revision 及 Kit secondary layer 讀回，才啟用確認保存。coordinator 再以 caller 的 active primary lease／current binding 查驗，不能靠 browser 自封 ACK。
6. 保存後重讀同一 immutable selection ID/hash。可貼上 ID 再讀回並重新預覽。不同選面或名稱得到另一內容定址版本；相同內容重播原版本。這是不可變快照集合，沒有「同名最新版本」或覆寫／自動遷移語意。

`selection_confirmed_by_user=true` 只表示使用者明確保存選取；`actual_ground_verified=false` 始終保留。後續需核對場地與可行走語意，建立 `z_ground(x,y)+1.5m` 取樣及 fluid/solid/holes/overlap 檢查。沒有修改舊 run 的 unknown/false；若地形未進求解器，仍須新的 mesh/solver 計畫與預算。

## 資料與信任邊界

- streaming conversion authority 從登錄、ready 的 `model_usdc` artifact 取得 path 與 SHA；browser 不提供 URL/path/vertices/verified。每次讀取私有 snapshot，來源、選面及預覽 checksum 都重新驗證。
- 新 internal catalog/preview/selection 路由要求已配置 `X-Internal-Conversion-Token`，未配置拒絕服務。preview artifact GET 僅讀已登錄版本，回傳 checksum 核對過的同一份 bytes，不建立檔案。延續既有 host-native loopback artifact 邊界。
- coordinator 四個 browser 路由為 `/api/review-sessions/{sessionId}/ground-surfaces/{catalog|previews|selections/{selectionId}}`；沿用 operator guard、user principal、primary lease、active binding。每次要求 `X-Viewer-Source-Client-Id`（現有 lease ID）、`X-Viewer-Lease-Token` 與 `X-User-Token`；比對 active binding client，spectator／同 principal 另一頁／過期 credential 均拒絕。parent viewer pane 以私有 closure 使用已持有的授權；面板不取得 token getter。await 後再核對來源／lease；固定 URL 由可信 public artifacts base 構成。
- preview 與 manifest 在 streaming `_ground-selections/ground_<selection_sha>` 以同 filesystem private draft 目錄原子發佈。streaming 只作幾何來源驗證，不保存使用者確認。coordinator 等待來源讀回後再次核對 exact lease／binding，在無 await 的同步生效點以 atomic ledger 保存 immutable 使用者確認版本；檔案位於既有 `cfdRunLedgerStorePath` 父目錄的 `ground-selection-versions`，無新增環境變數。失效請求不留下 confirmed 記錄。每個服務均為既有單 process writer，不宣稱跨 process 協調。
- selection hash：SHA256(`ground-selection/v1\0` + canonical UTF-8 JSON `[conversion_job_id, model_sha, verbatim_region_name, sorted_face_ids]`)；JSON 無 whitespace，face IDs 已包含原面與 geometry 身分。名稱字串不正規化。確認 provenance 另保存 server-owned principal、session 與已觀察 binding revision。
- 換 session/source/primary lease、逾時或 partial ACK 不顯示已預覽。pane 的非秘密 source key（session、lease ID、handoff／runtime 預期來源）讓同 session 換模型也清除選取與舊預覽操作；此 key 只控制 UI 失效，不能供 API 授權。Kit 回覆後仍須 Viewer 就緒。重新組合會清除 CFD panel 舊呈現狀態。移除預覽需 Kit empty-secondary 讀回。舊 immutable 版本保留，不刪原模型或 CFD artifact。
- 工作預算：來源 snapshot 最多 512 MiB（整檔成本獨立於 page）；每 Mesh 最多 200000 points／200000 faces／600000 indices，每 scope 最多 1000000／1000000／3000000，在 NumPy 世界陣列前拒絕。holeIndices 在 Python list 配置前限於原 face 數，重複 hole index 拒絕，沿用 face 的總量界限。Sdf 原始 layer 及 attr 解碼仍有來源成本，不能將每頁 5000 次原面分類說成 parser CPU/RAM 硬上限；不支援 Mesh 原因須明示。

## 驗收

確定性：原面回歸、同 GUID 多 Mesh/高程、scope/cursor/SHA、拒絕原因、整組選取、units/祖先 transform、來源與 face stale、token failclosed、unregistered/tampered preview、不可變重播、current lease/binding、await race、late ACK/session、partial ACK、移除讀回、固定狀態區。

真站：可見 Chrome 原 session 明選兩個已核對構件的不同高程面；側視與俯視預覽、至少三個來源頂點／高程讀回、exact artifact/binding/Kit ACK、明選保存與重讀、取消／切 session 清除確認、舊 CFD run 仍 unknown 且無新 solver。尚未真站操作前不得稱可用或地面修復完成。
