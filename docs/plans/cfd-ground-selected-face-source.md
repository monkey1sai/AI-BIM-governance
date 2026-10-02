# 可行走面來源基礎：原 USD 三角面讀取

承接 [計算地面與行人取樣來源](cfd-ground-reference-contract.md)。此切片提供 streaming／離線 `bimcfd` 共用的原面來源 primitive；沒有新增 API、UI、算例設定、部署流程、migration 或依賴，也未將它接入 solver 或既有結果。後續候選目錄、使用者選面、區域／選取版本、相對高度取樣與有效流體檢查仍待交付。

## 來源與面身分

`cfd_pipeline/ground_surfaces.py` 的 `read_selected_ground_faces(path, expected_sha256, selections)` 讀取明選的面，全部成功才回傳；任何選面不合格即整組拒絕，不靜默補面或減少選取。Caller 後續仍須由 conversion ledger 取得正確註冊來源與預期 SHA；本函式驗證解析 bytes，不提供來源存取授權或 conversion ID 配對。

讀取以 1 MiB chunk 複製到任務私有暫存，計算 SHA 並與預期模型 SHA 比對，再從同一 snapshot 建立 fresh anonymous Sdf layer。原路徑被替換後仍讀所綁定的 snapshot；不開啟／Reload 原共享 layer，也不改 Kit 持有的 stage。函式結束正常或失敗皆清理自有暫存，結果只包含純數值與面來源。

首刀限單檔、靜態、明定 Z up／正有限 metersPerUnit；sublayer、authored reference／payload／clips 在 Stage composition 前拒絕（含內部 reference，暫不支援 instancing）。缺座標 metadata 不套用預設值。Mesh 或祖先動畫不以 default time 冒充靜態地面。

每片面保留模型 SHA、IFC GUID／type、Mesh prim path、原 `polygon_face_index`、三個原 point indices、world metres 頂點、向上法向與面積。多 Mesh、重疊位置、屋頂／地下平台、不同高程均保留不同來源；面被標為 hole 後，其他面仍使用原索引，不重新編號。

## 幾何與拒絕條件

只處理原 USD authored triangle geometry；非三角形（含 concave polygon）拒絕，不套用既有 fan triangulation。先核對 Mesh schema 及 authored Sdf property stack 型別：points 為 Point3fArray、counts／indices／hole indices 為 IntArray、orientation／subdivision 為 Token，不以 schema fallback 掩蓋 authored 型別，也不把小數拓撲截成整數。再核對整 Mesh counts／indices／hole indices 邊界、選取面、有限坐標、非退化三角形與可逆 affine transform。向下或垂直面拒絕，不用法向絕對值把底面翻成上表面。

法向按 world 頂點 cross product、Mesh orientation 及 local-to-world determinant 符號處理；world 坐標含祖先 transform 並轉成公尺。此規則沿用 [OpenUSD 的 winding 與鏡射定義](https://openusd.org/dev/api/usd_geom_page_front.html)。法向 Z 大於 `1e-12`、cross length 大於 `1e-12 m²` 僅是此 primitive 的數值退化檢查，不是坡度／可行走標準或 CFD 格距。

回傳 `geometry_representation=authored_triangle`、`actual_ground_verified=false` 及原 subdivision scheme。現有 identity writer 未明寫 scheme 時可能為 USD fallback `catmullClark`；本函式不把控制拓撲宣稱為 renderer limit surface，也不以該 fallback 拒絕原三角面。幾何「向上」不能證明道路、可行走、terrain 已納算、或上方存在流體 cell。

`geometry_sha256` 使用前綴 `cfd-ground-authored-triangle/v1`、NUL、保留原 vertex order 的九個 world 公尺值及三個法向值，以 big-endian binary64 打包；`-0` 正規化為 `+0`，無四捨五入。`face_id` 使用 `cfd-ground-face/v1`、模型 SHA、GUID、Mesh prim path、原 face index 與幾何 hash，以 NUL 分隔 UTF-8 後 SHA256。幾何內容 hash 不能代替來源身分。

## 驗證與接續

確定性 USD fixtures 涵蓋同 GUID 多 Mesh／多高程、原 face index、holes、slope、parent translation／rotation、非 1 單位、right／left-handed × mirror、非均勻縮放、向下／垂直／退化／NaN、非法拓撲、缺來源與坐標、動畫／奇異 transform、SHA mismatch、duplicate selection、相同路徑被替換但原 stage 仍存活，以及 snapshot 後來源變更與 external composition 前拒絕。既有 preprocess／ground_reference／CFD tests仍須通過。

此 primitive 的驗證不代替真站選面工作流程與側視／俯視高程核對。下一切片須先接 source-bound 候選與明選預覽，再保存區域／版本／情境雜湊；之後才做 `z_ground(x,y)+1.5m` 和有效 fluid sampling。原計算若漏地形，重取樣不能補回，新的 mesh／solver 仍須另提資源、全階段時間與停止條件並取得新預算。舊 run／artifact、profile、取樣高度與求解字典保持原值；回滾用正常 revert PR。
