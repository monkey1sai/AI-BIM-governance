## Why

`unified-console-semantic-viewer`（CH-H1/H2）把範本 6 面板語意 viewer（①模型資訊 ②IFC語意 ③結構 ④對構 ⑤幾何/分類碼 ⑥空間）放進中央 `MockViewport`，但其 gate 為 `viewerTab==="model" && !_hasRemoteVideoFrame()` —— **取得真實 Kit 幀後即卸載**，讓出中央給 `<video>` live 3D。

在「有 GPU、Kit 真的出幀」的環境（本機 RTX 4060 Ti，實測 1920×1080 frame）下，這導致：真人開真實 session → live 3D 一出現 → ②③④⑥ 語意面板**整片消失**，無法「點構件看語意」。這既不符北極星範本（AI-BIM-Geo Viewer：語意面板**環繞**中央 3D 並存，非二選一），也讓 `element-semantics` browser E2E 在 GPU 環境恆紅（中央被 live 3D 取代、對構表 row 消失無從點擊）。

附帶釐清一條部署真相：`coordinator :8004 /ui/open` 是 **302 轉址**到 `viewer :5173`（docker `web-viewer-sample` 服務，`vite dev` 跑 **baked source**，無 bind-mount）。故 viewer 前端改動 MUST 重建 viewer image 才會反映在 `/ui/open` 入口；只 `npm run build:ui`（更新 `:8004/ui/` dist-ui console）不會更新 `:5173` 入口。此前因建錯目標導致「改了卻沒效」的假象。

## What Changes

- **`MockViewport.tsx`**：新增 `liveMode?: boolean` prop。`liveMode=true`（已出真 Kit 幀）時 banner 誠實標「語意側欄 · live 3D 已出幀」（**不再宣稱 no-GPU**），並套 `gv-mock--live` 改為左側語意側欄；`liveMode=false` 維持既有中央 deterministic·no-GPU 佔位。reserved padding 僅 non-live 套用。
- **`Window.tsx`**：MockViewport mount gate 移除 `!_hasRemoteVideoFrame()`（取得真幀後**不卸載**），改傳 `liveMode={this._hasRemoteVideoFrame()}`。`viewerTab==="model"` 與 session/expectedStageUrl 條件不變；問題分頁（`viewerTab!=="model"`）仍不掛載。
- **`viewer.css`**：新增 `.gv-mock--live`（左緣 400px 半透明語意側欄、單欄 grid、z-index 26 —— 高於左側 USD 樹 dock(25) 與治理 overlay(20)，確保語意內容恆可見不被既有左側 dock 蓋住〔reviewer P1〕；模型置中不受遮蔽、與右側 340px 治理 overlay 水平不重疊）。完整 reserved-space（側欄與 live 3D 完全並排不疊放 video 左緣、且不蓋 stage-truth 尾端）版面列為後續 follow-up（reviewer P2，非本 change 範圍）。
- **部署**：重建 docker `viewer` image 使 `:5173`（`/ui/open` 入口）反映上述前端改動。
- E2E：`element-semantics`（點對構表 row → ②IFC語意/⑥空間/⑤roadmap，與 live 3D 並存）+ `issues-tab`（模型↔問題切換）+ `gov-viewer-layout`（harness 不空白）三支 live 驗綠。

## Capabilities

### New Capabilities

- None。

### Modified Capabilities

- `unified-governance-console`：新增可驗收 requirement（取得真 Kit 幀後語意面板 SHALL 與 live 3D 並存為側欄、不消失；banner 誠實表態；viewer 前端入口為 `:5173` docker viewer，改動須重建 image）。

## Impact

- Owner：`web-viewer-sample/src/Window.tsx`（先 gitnexus_impact；additive：移 gate 條件 + 傳 liveMode）、`console/viewer/MockViewport.tsx`（+liveMode/banner/pad）、`console/viewer/viewer.css`（+.gv-mock--live）。
- API/boundary：**無變更**（前端只打 :8004；②④⑥ 仍走既有 coordinator for-session / element-mapping proxy；不新增 prod 依賴；不直連 :49101/:49102）。
- 部署：重建 docker `viewer` image（`compose.runtime-manager.yml + compose.host-kit.yml`，project `ai-bim-web-plane-host-kit`）；deploy.ps1 golden path 已含 viewer build，merge 後一鍵部署即反映。
- 驗證：viewer tsc + vitest（MockViewport 周邊單元）+ Playwright 全 15 支綠（含 element-semantics 由紅轉綠、issues-tab 去 flaky）；真實 session live e2e + 截圖佐證。
- Non-goals：不改 GovernanceOverlay 內部 A1–A10 邏輯；不改 streaming/coordinator data shape；⑤幾何/材質 + 分類碼仍誠實 roadmap（pipeline 無來源，不捏造）。
