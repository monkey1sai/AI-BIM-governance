## Context

舊 plans 同時混合「現在建到哪」「要做成什麼」「如何驗收」，導致同一狀態在多檔重複。這次只重設文件 ownership；runtime/product truth 仍由 code＋tests/contracts 決定，TRUTH 是需隨 evidence 同步的快照，不凌駕 runtime。

## Goals / Non-Goals

### Goals

- 用七個核心檔建立單向 ownership，避免同類資訊跨檔互相裁決。
- 保留 13 條 backend freeze、4 筆例外、22 正典 routes、9 aliases＋`#review` 獨立保留頁、30 張 IX、21 viewer AC 與 12 項 NOT BUILT。
- 讓所有 active consumers 可從新入口找到 owning source。
- 對新 built DoD 採保守校正：缺 tracked screenshot＋trace 時降為 PARTIAL，不以 backend-only test 抵充。

### Non-Goals

- 不更動任何 runtime route/API/schema/status enum（session enum 僅更正舊文件誤植以對齊機器真相）。
- 不把 prototype demo data 當 runtime evidence。
- 不回寫 `openspec/changes/archive/`、歷史 Superpowers specs/plans 或 evidence。

## Decisions

1. **壽命正交三分**：TRUTH（短壽現況）／TARGET（長壽需求）／PROCESS（長壽紀律）；BACKLOG 只排序未完成 gap。
2. **兩份 prototype**：殼層與 viewer 各自為樣貌錨；TARGET 文字解決 prototype 與 repo contract 的不一致。
3. **zero-loss gate**：精確計數與 active-reference scan 在刪檔前執行；歷史引用保留，但 README §7 提供去向。
4. **formal contract 同 PR**：本 branch 名稱遵循 `codex/openspec/<change-id>`，active change delta 與 docs implementation 一起 review；merge 後再依 OpenSpec 流程 archive。
5. **無 runtime evidence 不升級**：PROCESS §2 要求 browser screenshot＋trace；TRUTH 依該門檻降級，不修改 runtime。

## Risks / Mitigations

- **壓縮造成語意遺失**：以舊正本逐項比對 freeze／exceptions／IX／AC，雙軸 review 再反證。
- **active workflow 斷鏈**：對六舊檔名做全 repo scan，歷史路徑 allowlist 明示。
- **TARGET 偷渡現況**：中文 zero-hit＋英文 positive-built allowlist audit。
- **TRUTH 變 stale**：PROCESS 要求產品 route/API PR 同步 TRUTH；自動 wiring 另列 BACKLOG，不在本 change 偷渡。

## Validation

- OpenSpec strict validation（change 與 all）。
- 兩個 workflow JavaScript syntax check。
- plans 計數、line budget、active links、tracked evidence 與 TARGET purity checks。
- `git diff --check`、GitNexus `detect_changes`（workflow 檔未索引時誠實揭露 UNKNOWN，不能當 pass）。
