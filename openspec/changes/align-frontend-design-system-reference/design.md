# Design: 可攜 design snapshot 與雙閘驗收

## Authority split

1. 上游唯讀 `C:\Repos\design\desigin-system` 決定 2D UX、IA、視覺 token、元件位置與互動狀態。
2. `docs/plans/design-system-reference.manifest.json`＋goldens 是 CI 可攜的 approved snapshot，記錄 source/baseline hashes、screen/state、viewport 與量測契約。
3. TARGET/contracts、程式碼與 executable tests 決定 route、API、enum、安全、資料、runtime lifecycle 與建成現況。
4. legacy prototypes 只保留歷史 IA 與 viewer/runtime companion 身分。

## Gate flow

```text
explicit origin verify/rebaseline
  -> tracked manifest + golden hashes
  -> classify changed paths with stricter base/head manifest union
  -> passed | mixed | partial_reference_missing | unknown_fail_closed
  -> production capture at subject commit
  -> pixel comparison at 1440x900 and 1920x1080
  -> branch-protected Playwright executes exact manifest semantic cases
  -> CI-output visual-result.json + independent PNG recomputation

functional browser flow
  -> route/button/fixture/real API
  -> loading/success/failure/retry/runtime ID
  -> trace/network evidence
  -> Kit first-frame/stage/DataChannel ack when applicable
```

兩條 flow 均通過才可宣告 user-facing built。PR body／外部 semantic JSON 不是 gate input；missing/skipped/blocked case 一律失敗。`mixed` 必須跑全部 approved screens並揭露 missing scopes；pure `partial_reference_missing` 不偽造 result，兩者 full=no。gate-infrastructure-only 只跑 schema/negative tests；unknown candidate path fail closed。

## Token projection

上游 token 以 `primitive → semantic → component` 投影到 production `--ec-*`／app styles；accessibility/security 不得為像素對齊而移除。production CSS 不是平行 authority。

## Rebaseline

一般 CI 永遠只驗 tracked snapshot。只有明確確認的 `--rebaseline --confirm-rebaseline` 可更新來源 hash、goldens 與 aggregate digest；origin drift 不自動接受。

## Environment limits

Visual gate 使用 Windows runner、Chromium、DPR1、locale `zh-TW`、timezone `Asia/Taipei`、dark scheme、font-ready、animations disabled。live WebRTC frame、GPU render 與未核准 dynamic regions不納入 pixel baseline；它們由 runtime gate裁決。
