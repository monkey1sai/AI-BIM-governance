# CP9b 周邊量體幾何與共同域估算：第一刀

承接 [D1／D2 決策](cfd-v1-context-decision-2026-10-02.md) 與 [CP9a 身分契約](cfd-context-contract.md)。此刀提供唯讀幾何／估算；CP9b 的編輯、Kit 預覽與實際求解幾何整合仍待後續。不能把估算成功、顯示方塊或 hash 相符當成已計算周邊風場。

## 入口及來源

既有 `POST /api/cfd/estimates`（coordinator）／`POST /api/cfd-estimates`（streaming）新增 optional `context`，格式完整沿用 `cfd-context/v1`，必須帶 canonical hash。舊 request／response 保持相容。沒有 ledger／worker／網格／求解寫入。Streaming 的既有唯讀 estimate 在 CFD writes disabled 時仍可用；public coordinator 入口維持既有 enabled／operator gate，關閉時回 503。

Streaming 核對 conversion ID、實際 `model.usdc` SHA、context canonical SHA，再開啟該 USDC 讀取 `upAxis`／`metersPerUnit`。目前 identity-authored IFC 模型及 solver 管線是 Z-up；宣告與實際軸不同回 409 `context_frame_mismatch`，實際 Y-up 回 409 `context_frame_not_supported`，模型無法讀取或 metadata 非法回 409 `context_frame_unavailable`。Y-up draft 的身分驗證仍合法，這不表示 solver 支援。

位置、尺寸已是模型世界座標的 m；不再乘 stage `metersPerUnit`。主棟已有 loader／bbox index 負責其單位。旋轉沿 +Z 右手方向，位置是底面中心，高度由底部向 +Z。

## 共用幾何與識別

每量體固定 8 頂點／12 個朝外三角面，依 ID 排序。所有手動方塊在主棟 class／outlier／largest-shell 過濾之後納入估算，包含遠處、高於主棟及空情境，不靜默剔除。

`context_geometry` 回應 `cfd-context-geometry/v1`，包含來源模型 SHA、情境 canonical SHA、實際 source frame、每量體 ID／頂點／面、m 單位、bbox、頂點捨入誤差及 `solver_submission_enabled:false`。顶點是 binary32（USD mesh／STL 的表示），身分仍用 CP9a binary64。捨入造成面塌縮或失去朝外體積的方塊回 409 `context_geometry_unrepresentable`；不默默改尺寸或座標。最大捨入誤差以 m 揭露。

`geometry_sha256` 只識別方塊幾何，**不是主棟＋周邊的完成求解外殼或網格 hash**。精確 bytes 為 ASCII `cfd-context-geometry/v1\0Z\0binary32\0`，後接排序量體：4 bytes big-endian ID 長度、ASCII ID、8×3 big-endian binary32 頂點（負零正規化）、12×3 big-endian unsigned32 面索引；沒有數量歧義，ID 長度及固定幾何長度劃分量體。來源註記改變情境 hash，幾何相同則幾何 hash 不變。

## 共同域與成本

主棟來源沿用相同 preprocess 的歷史 shell（context estimate 另要求精確主 USDC SHA），或 conversion bbox index 的 class／outlier 過濾。任何 request 已帶 context 的歷史 shell 不作 main-only 來源，避免重複加入周邊；歷史校準也排除 context run。

估算點集合是主棟點＋每個方塊的實際 8 頂點。逐風向沿用既有 solver rotation、domain、blockage、background cell、refinement region 與 cap 規則，最高量體和間距會改變共同域。回應增加 `geometry_bbox_m`（估算來源的共同 bbox）、每風向 `blockage_ratio`；`geometry_source` 為 `previous_run_shell_with_context` 或 `bbox_index_profile_filter_with_context`，basis run 只識別主棟來源。bbox index 仍是近似來源，不能稱精確主棟外殼。

`limits.exceeds_hard_cap` 和 confirmation 旗標保留；超限仍可查看估算，但 context run 提交維持 503 `context_not_supported`，包含空情境，不能因估算成功而越過 gate。沒有降低格距、修改 cap 或刪鄰棟。

Refinement／耗時係數仍來自主棟、其他歷史 run 或既有 defaults，未證明適用此情境；notes 明確揭露。尚未驗證地形、地面高程、量體交疊／重要通道、場地資料來源與覆蓋充分性。solver 地面目前仍 z=0。此刀不提供記憶體／磁碟硬上限，也不批准新求解。

## 驗證及後續

測試涵蓋旋轉公式、面朝外／封閉與體積、m 單位不重複縮放、軸向／hash／來源負向、極小尺寸塌縮、清單排序／註記識別、遠處鄰棟／共同高度域成本及 cap、空情境、歷史混料、唯讀不排程與舊 API。OpenAPI／JSON Schema 保留精確 3 座標、8 頂點、12 面及面索引界限。

合併後依既有 canonical 路徑部署，於可見 Chrome 同源 API 核對 source／geometry／估算，以及原 session 的 BIM／Kit／CFD 回歸；這些是軟體證據。後續 CP9b 編輯與 Kit 預覽使用同一頂點資料，實際求解幾何整合保存另一份真正計算外殼 hash。新的 181 mesh／solver 仍先依 D1 決策 §6 提出具體計畫及取得新預算，舊探針不適用。

無新增依賴、服務、環境變數、部署流程、排程或 migration。回滾以正常 revert PR 撤回 optional estimate 擴充／生成物後 canonical 部署；此刀沒有情境持久化或新 run，不需資料遷移。
