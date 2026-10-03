# 明選原面相對高度取樣：第一刀

本刀交付來源綁定的取樣位置生成與離線 CLI；不接產品 UI/API、不讀 U/p、不提交 CFD job、不改舊結果或求解邊界。

## 算法與拒絕語意

- 輸入為同一個已核對 SHA-256 的 Z-up USD 原三角面。沿用原面 world metres／transform，不再套單位或旋轉。
- 每個請求 XY 在原面投影內，以重心座標取得 `z_surface(x,y)`；目標為 `(x,y,z_surface+1.5)`，垂直高差，不沿坡面法向。顯示抬高獨立，輸出 `display_lift_m=0`，不加預覽的 0.01 m。
- 零命中為 `uncovered`；多命中為 `ambiguous`，包括上下重疊、同高重複、相鄰共邊／共頂點。此保守策略會拒絕部分可用邊界，後續去重須另證明相鄰關係。
- 浮點邊界不確定帶內的可能命中也納入歧義計數；單面邊界及靠邊不確定位置為 `precision_unsupported`，不向內吸附。權重不確定下限為 `1e-12`，另按請求及全部頂點世界 XY 的四倍 ULP（可表示間距）、乘積相減及分母的不確定性傳播誤差；分母可能包含零時拒絕原面。極端 affine 拉伸的相減損失也只擴大拒絕帶，不能生成面外點。
- 不對面外權重 clamp，不填補孔洞、不取最高／最低／第一面。拒絕統計只針對請求格點，不能推論整個區域無孔洞或重疊。
- XY 分母的絕對下限為 `1e-12 m²`，並拒絕分母不大於最長 XY 邊平方的 `1e-12` 倍、非有限值或不可保留 1.5 m 高差的情況。數值拒絕不輸出假位置或零風速。
- 最多 100 面、10,000 個請求點（最多 1,000,000 次面測試），在配置／迴圈前檢查。CLI identity JSON 最多 512 KiB、Mesh path 最多 1024 字元、輸出最多 8 MiB；來源 snapshot 沿用 512 MiB 上限。

## 離線操作

先用既有 catalog／選取來源取得身分；本機 identity 清單只含：

```json
{
  "model_usdc_sha256": "<64 hex>",
  "faces": [{
    "ifc_guid": "<IFC GUID>",
    "mesh_prim_path": "/World/Elements/IfcSlab/G_<GUID>/Body_000",
    "polygon_face_index": 7,
    "face_id": "<64 hex>",
    "geometry_sha256": "<64 hex>"
  }]
}
```

```powershell
cd tools/cfd
& <repo>/.venv/Scripts/python.exe -m bimcfd ground-sample-points `
  --model-usdc <local>/model.usdc --model-sha256 <expected-sha> `
  --selection <local>/identities.json `
  --bounds <xmin> <ymin> <xmax> <ymax> --spacing 0.5 --out <new>/sample-points.json
```

CLI fresh snapshot 重讀本機模型，逐一比對 `face_id` 與 `geometry_sha256`，不信任 JSON 頂點、不宣稱此清單為 coordinator 已核准版本。輸出 `selection_authority=local_identity_list` 與輸入清單 SHA；資料只來自 fresh 原面。

格網包含 xmin/ymin；使用整數索引步進，只有剛好到達時包含 xmax/ymax，絕不超出 bounds。非正／不可表示的格距、逆向或非有限範圍、過量格點，在配置前拒絕。

有界的兩個軸先逐步檢查嚴格遞增及實際步長（誤差不超過 `max(1e-9 m, spacing×1e-9)`），才建立笛卡兒格網；大座標下的中途重複或粗化步長也拒絕。

exit 0：所有請求格點產生位置；exit 2：已寫有界拒絕報告但部分或全部位置拒絕；exit 4：輸入、來源或 IO 失敗。三者均不代表真地面或有效流體。輸出 exclusive-create，已有檔案一律拒絕，不能覆寫模型、清單或既有結果。IO 中斷可能留下不完整的新檔，非 exit 0/2 不得使用，沒有自動重試。

## 完成與後續門檻

本刀確定性測試涵蓋平面、坡面、多高程、負高程、缺面、重疊、邊界、投影退化、來源變化、點數／格距預算、非 1 單位與父 transform，以及真 CLI 入口。原面 identity 演算法共用，舊來源身分必須保持。

输出固定 `actual_ground_verified=false`、`fluid_region_verified=false`、`velocity_sampled=false`。下一刀才將 server-owned 保存版本接入流程；還需人工核對可行走面、solver ground/inlet/座標、fluid cell／域外／缺值與 terrain 入網格。原地形未納入求解時，重取樣不能修正繞流邊界。新網格／求解另列資源、時間、停止及重試計畫，取得新預算後才執行。
