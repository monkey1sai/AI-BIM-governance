# 架構調整差異對齊筆記

## 本次決策版摘要

新版架構不是單純整理 UI，而是重新分配「轉檔、部署、session、streaming」的 ownership。

最關鍵的使用者決策是 **B 方案**：

```txt
bim-streaming-server = IFC→USDC conversion job authority
_worker              = RVT→IFC export bridge only
```

這代表 `_worker` 不再是完整 IFC→USDC conversion facade；它只把 Revit / RVT 前段橋接到 IFC，然後以 webhook 把 `ifc_ready` 事件交給 `bim-streaming-server`。

## 與現行 repo source-of-truth 的主要差異

### 0. 套用前 source-of-truth baseline（2026-05-14）

本 baseline 記錄套用 `architecture-rework-2026-05-14` 前，repo 主要 source-of-truth 文件仍採用的舊邊界，避免後續文件對齊時把「已驗證的現況」與「B 方案目標狀態」混在一起。

| 文件 | 套用前 baseline |
|---|---|
| `AGENTS.md` | `_worker` 是 artifact + conversion facade，負責接收 IFC/RVT/DWG 或 signed upload reference、建立 conversion job、產出 USDC / index / mapping / metadata；`bim-streaming-server` 是 Omniverse Kit runtime / WebRTC / USD scene runtime，載入並渲染 `_worker` 提供的 USD / USDC。 |
| `README.md` | demo 步驟 ① 上傳建模與 ② 自動轉換都指向 `_worker`；服務邊界表把 `_worker` 描述為 Artifact + Conversion Boundary，把 `bim-streaming-server` 描述為載入 USD / USDC、WebRTC streaming 與 DataChannel runtime。 |
| `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` | workflow v3 把「檔案 + 轉檔邊界」歸給 `_worker`，並在 Phase 1 / IFC→USD 品質管線中描述 `_worker` conversion job、USDC、mapping、lineage 與 callback workflow；`bim-streaming-server` 仍是 Kit + WebRTC + USD stage runtime。 |
| `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` | roadmap baseline 以 `_worker` 作為 artifact + conversion facade，並記錄 `worker-real-conversion-quality` 已把 real IFC→USDC adapter、USDC openability hard gate、mapping quality metrics 與 single Kit/browser evidence 歸入現行 specs；本次 B 方案會改變這個 conversion authority 敘述。 |
| `openspec/specs/` | 現行 specs 包含 `worker-artifact-pipeline`、`worker-dev-ifc-source-selection`、`worker-demo-upload-convert-ui`、`legacy-storage-conversion-retirement`、`review-session-request-lifecycle`、`multi-artifact-kit-routing`、`streaming-multi-layer-payload-loading`、`session-first-review-viewer`、`runtime-verification-evidence`、`runtime-verification-task-status`、`documentation-source-of-truth`；其中 `worker-artifact-pipeline` 仍是 worker-owned IFC→USDC conversion / mapping / quality / lineage 的正式規格來源。 |

### 1. `_bim-control` 擴成 fake Revit intake facade

現行：fake BIM metadata authority。

新版：保留 metadata authority，同時新增 fake Revit Plugin / RVT intake API。它接收 `.rvt` 或 signed upload reference，建立 source artifact metadata，並通知 `_worker` 開始 RVT→IFC export。

重要限制：

```txt
_bim-control 不執行 Revit。
_bim-control 不持有 Revit license runtime。
_bim-control 不做 IFC→USDC。
```

### 2. `_worker` 縮成 RVT→IFC bridge

現行：artifact + conversion facade；曾承接 IFC→USDC、mapping、quality、lineage。

新版：Docker 化、internal queue、Revit license boundary、RVT→IFC export，成功後送 `ifc_ready` webhook 給 `bim-streaming-server`。

重要限制：

```txt
_worker 不再管理 USDC conversion job。
_worker 不再宣告 model.usdc ready。
_worker 仍可保存 RVT source 與 IFC output 的 artifact metadata / local object layout。
```

### 3. `bim-streaming-server` 成為 IFC→USDC conversion authority

這是 B 方案核心。

新版：`bim-streaming-server` 對外提供 IFC→USDC conversion job API / webhook intake，建立 job id，管理 queued/running/succeeded/failed 狀態，產出 `model.usdc`、`element_mapping.json`、`entity_index.json`、quality metrics，再回寫 `_bim-control`。

但規格同時要求：

```txt
conversion authority 屬於 bim-streaming-server service boundary；
actual execution SHOULD use headless converter app / subprocess / worker lane；
live WebRTC viewport runtime MUST NOT be blocked by heavy conversion work。
```

### 4. `bim-review-platform` 是部署邊界，不是 nested repo

新版 HTML 把 coordinator / streaming-server / web-viewer 整合成 `bim-review-platform`。

本草案解讀為：

```txt
bim-review-platform = root repo 內的 deployment boundary / compose profile / integration module
不是新 Git repo
不是 submodule
不是把三個 service 源碼硬塞成單一 process
```

### 5. `bim-review-coordinator` 變薄

新版：coordinator 管 session lifecycle、多 Kit / viewport sharing、primary/secondary artifact binding，不管理 conversion job，不直接操作 USD stage，不保存大型檔案。

### 6. `web-viewer-sample` 保持 browser client

新版：可和 streaming-server 同 compose / 同平台部署，但仍是 client。它只讀 session / stream config / issue list，送 DataChannel command，不做轉檔與資料權威。

### 7. USD composition 變成正式架構語意

新版引入：

```txt
primary_model_A.usdc = root layer / primary model
session layer        = runtime review layer
secondary_model_B/C  = subLayers
```

coordinator 決定 primary 與 subLayer ordering；streaming-server 依 DataChannel payload 建 stage composition；web-viewer 顯示結果與狀態。

## 需要 OpenSpec 保障的高風險點

1. B 方案會改現行 repo 邊界，必須同步 `AGENTS.md / README / workflow / roadmap / OpenSpec specs`。
2. `bim-streaming-server` 不能把 heavy CAD converter dependency 直接塞進 live streaming runtime thread。
3. mapping / lineage / quality metrics 不可因 ownership 遷移而消失。
4. `placeholder model.usdc` 不可被標記為 ready。
5. `bim-review-platform` 不得造成 nested git / submodule。
6. Revit license 必須被標示為 external prerequisite，不可假裝 repo 可自行 build Revit runtime。
