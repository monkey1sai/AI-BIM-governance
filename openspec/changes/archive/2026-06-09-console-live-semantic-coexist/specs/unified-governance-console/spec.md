## ADDED Requirements

### Requirement: 取得真實 Kit 幀後語意面板 SHALL 與 live 3D 並存（不消失），且 banner 誠實表態

primary 治理 viewer 的「模型」分頁，於取得真實 WebRTC/Kit 視訊幀（`_hasRemoteVideoFrame()` 為真）後，語意檢視面板（①模型資訊 ②IFC語意 ③結構 ④對構表 ⑥空間）SHALL 持續存在並與中央 `<video>` live 3D **並存**（呈現為左側語意側欄，對齊 AI-BIM-Geo Viewer 範本：面板環繞中央 3D），SHALL NOT 因出幀而整片卸載/消失。側欄 SHALL NOT 覆蓋中央 live 3D，亦 SHALL NOT 與右側 A1–A10 治理 overlay 水平重疊。

出幀後語意側欄的 banner SHALL 誠實標示「live 3D 已出幀」狀態，SHALL NOT 仍宣稱「no-GPU / deterministic」（誠實鐵律：不得在 GPU 實際出畫面時謊稱無 GPU）。未出幀時 SHALL 維持中央 deterministic·no-GPU 資訊濃密佔位（非空白、非壞掉）。

②④⑥ 之資料 SHALL 仍經 coordinator `:8004` 的 for-session / element-mapping proxy 取得（不直連 :49101/:49102）；⑤幾何/材質與分類碼無 pipeline 來源時 SHALL 誠實標 roadmap/N/A，SHALL NOT 捏造。

#### Scenario: 真實 session 出 live 3D 後，點對構表構件仍可見 ②IFC語意 + ⑥空間

- **WHEN** 真人開啟有真實 Kit 幀的 session（GPU 出畫面）並停在「模型」分頁
- **THEN** 中央 SHALL 顯 live 3D `<video>`，左側 SHALL 同時呈現語意側欄（①③ + ④對構表 row），語意面板 SHALL NOT 因出幀而消失
- **AND** 側欄 banner SHALL 顯「live 3D 已出幀」（誠實），SHALL NOT 顯「no-GPU」
- **AND** 點④對構表第一列構件 SHALL 於 ②IFC語意 顯該構件真實 Type/Property（經 for-session proxy），⑥空間顯容納鏈，⑤幾何/分類碼誠實標 roadmap
- **AND** SHALL 具 browser E2E 證據（點構件 live 驗）+ 截圖（左側語意側欄 + 中央 live 3D + 右側治理 overlay 並存）

### Requirement: viewer 前端入口 SHALL 為 :5173 docker viewer，其前端改動 MUST 重建 viewer image 始生效

`coordinator :8004 /ui/open` SHALL 以 302 轉址至 `viewer :5173`（docker `web-viewer-sample` 服務，`vite dev` 跑 baked source、無 bind-mount）。因此 viewer 前端（Window/MockViewport/console 等）之改動 MUST 重建 docker `viewer` image 後始於 `/ui/open` 入口生效；僅重建 `:8004/ui/` dist-ui console（`npm run build:ui`）SHALL NOT 視為已部署 viewer 入口改動。`scripts/deploy.ps1` golden path SHALL 涵蓋 viewer image build，使 merge 後一鍵部署即反映。

#### Scenario: viewer 前端改動經重建 image 後在 /ui/open 入口生效

- **WHEN** 修改 viewer 前端碼並欲於 `/ui/open` 入口驗證
- **THEN** SHALL 重建 docker `viewer` image 並 `up -d viewer`，SHALL NOT 以「只 build dist-ui」當作已部署
- **AND** 驗證 SHALL 針對 `/ui/open` 實際轉址之 `:5173` 入口（或等價最新碼 dev server），SHALL NOT 誤針對陳舊 baked 容器而得「改了沒效」之假象
