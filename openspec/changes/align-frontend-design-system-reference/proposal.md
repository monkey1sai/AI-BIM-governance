# Change: 對齊 desigin-system 前端設計權威與 dual gate

## Why

現行正典文件與 PR gate 仍把兩份 legacy prototype／任意 screenshot 當成前端視覺依據，無法機器判定使用者要求的 99% 對齊，也會把 production CSS、browser E2E 與 design fidelity 混成同一權威。

## What Changes

- 將唯讀 `C:\Repos\design\desigin-system` 定義為 2D authoring authority；CI/PR/merge 只讀 repo 內已 pin 的 manifest 與 golden baselines。
- 將 99% 定義為 Windows runner 上的 Chromium DPR1、1440×900＋1920×1080、每 viewport pixel diff `<=1%`，且所需 semantic states 100%。
- 由 changed paths 與 base/head manifest 聯集機器推導 `passed`／`mixed`／`partial_reference_missing`；後兩者允許誠實 partial work，但禁止 99%／full-completion claim，unknown path fail closed。
- semantic evidence 只由 branch-protected Playwright 對 current checkout 產出；PR body、外部 JSON、手填 boolean 或既有 artifact 不得作 gate input。state variants/cases 不完整時 frontend product gate fail closed。
- 將 design fidelity 與 functional/runtime E2E 分為兩個獨立、均必須通過的 gate。
- 將 legacy shell/viewer prototypes 降為 IA／OpenUSD runtime companion，不再作 production 2D pass/fail 或 API/coding 權威。
- 將 production token 定義為上游 primitive→semantic→component 的受控投影。

## Ownership

- `docs/plans/`：設計 reference、TARGET/PROCESS/TRUTH/BACKLOG 正典語意。
- `web-viewer-sample/`：visual comparison lane 與 production frontend evidence。
- `scripts/tests/`、`.github/`：PR/merge/CI machine gate。
- `openspec/`：文件分工與 user-facing completion capability delta。

## Boundary Impact

不變更 public API、event、DB schema、MinIO layout、session/conversion lifecycle、backend authority、Kit/WebRTC protocol 或 GPU ownership。前端仍只打 coordinator `:8004`。design source 中的 demo API、數值與狀態不得覆寫 runtime contracts。

## Non-goals

- 不回寫或初始化外部 `desigin-system`。
- 不在本 change 擴充 Kit OpenUSD Web Viewer 或 OpenUSD extensions。
- 不以 design screenshot 取代真 IFC、Kit first-frame、stage truth 或 DataChannel ack。
- 不對 live WebRTC/GPU frame 做 `<=1%` pixel assertion。
- 不在本 change 偽造缺少的 semantic state variants，也不把 gate infrastructure 完成寫成 production 99% 已通過。
