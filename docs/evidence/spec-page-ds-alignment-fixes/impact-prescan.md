# F0 / Task P1 — GitNexus upstream impact 前置安全門結論

- spec: `docs/superpowers/specs/2026-06-24-spec-page-ds-alignment-fixes-design.md`
- plan: `docs/superpowers/plans/2026-06-24-spec-page-ds-alignment-fixes.md`
- slug: `spec-page-ds-alignment-fixes`
- 執行時間: 2026-06-30
- branch: `worktree-spec-page-ds-alignment-fixes`（worktree；不動 main）
- 依據: spec §4 line 119「改 `pages.tsx`/`EdgeConsole.tsx` symbol **前**跑 `impact(upstream)`」+ CLAUDE.md §4「HIGH/CRITICAL 先回報再繼續」

## 0. 為什麼是「前置」安全門（非事後補驗）

本門在**任何編輯（含 Task 0 純 CSS）落地前**先跑完並確認 LOW 才放行。任一回 **HIGH/CRITICAL → 立即停手、回報、不進入任何編輯/commit**。本批會改的 code symbol：

- `SpecPage`（`pages.tsx`，Task 1：lead i18n 字串）
- `EdgeConsole`（`EdgeConsole.tsx` nav render：`title` 屬性取值，Task 2，**未動 `navText`**）

Task 0（純 CSS `.ec-lead` margin token）、Task 3（純 `.md` 手冊現況補記）不含 code symbol，本身不需 impact；但本前置門仍在它們之前先跑完。

## 1. 使用的索引（兩份同名索引的選擇）

GitNexus 對本 repo 有兩份索引（同名 `AI-BIM-governance`）：

| 索引路徑 | branch | edges | embeddings | indexedAt | 落後 |
|---|---|---|---|---|---|
| `C:\Repos\active\iot\AI-BIM-governance`（主 checkout） | main | 32729 | 11729 | 2026-06-30T02:55Z | 在 HEAD |
| `…\.claude\worktrees\spec-page-ds-alignment-fixes`（worktree） | worktree-… | 21629 | 0 | 2026-06-30T04:36Z | 1 commit |

安全門採**主 checkout 索引**（caller 圖最完整、edges 多 ~51%），對 pre-edit gate 是降低 false-negative 的保守選擇。`SpecPage` / `EdgeConsole` 兩 symbol 在兩 commit 間結構相同（本 branch 目前只新增 plan/spec 文件，未動這兩個 symbol），故主索引的 caller 真實反映待改 symbol。

## 2. SpecPage — upstream impact

```
target: Function web-viewer-sample/src/console/pages.tsx:SpecPage
direction: upstream
risk: LOW   epistemic: exact   impactedCount: 2
```

| depth | caller | file | relation | conf |
|---|---|---|---|---|
| 1（WILL BREAK） | `renderBody` | EdgeConsole.tsx | CALLS | 0.85 |
| 2 | `EdgeConsole` | EdgeConsole.tsx | CALLS | 0.85 |

- affected_modules: `Console`（direct，2 hits）
- affected_processes: `renderBody`(2)、`EdgeConsole`(1)
- 與 spec 預期一致：「`SpecPage` 僅被 `renderBody`/route switch 引用」。`renderBody`(EdgeConsole.tsx:50-88) 即 route switch；Task 1 只改 `SpecPage` 內 lead 的 i18n 字串、不改回傳結構/簽名 → `renderBody` 的 route 對應不受影響。**LOW，放行。**

## 3. EdgeConsole — upstream impact

```
target: Function web-viewer-sample/src/console/EdgeConsole.tsx:EdgeConsole
direction: upstream
risk: LOW   epistemic: exact   impactedCount: 0
```

- callgraph 無 upstream caller。`EdgeConsole` 是 `export default function EdgeConsole()`、shell 入口。
- 與 spec 預期一致：「`EdgeConsole` 為 shell 入口、無上游 caller 受字串/tooltip 影響」。Task 2 只改 nav `<button title={p.label}>` → `title={navText(p.key, p.label)}`（render 內 JSX 字串屬性），不改簽名 / 不改 default export / 不改回傳 JSX 結構 → 任何掛載端不受影響。**LOW，放行。**

## 4. [xref] 雙圖譜交叉確認（codebase-memory，advisory · 不翻 gate）

（memory `spec-to-done-dual-graph-advisory`：GitNexus 對前端 symbol 偶有假陰漏報，故並列 codebase-memory 佐證 impact 不漏報。）

`search_graph(project=C-Repos-active-iot-AI-BIM-governance, query="SpecPage EdgeConsole navText", limit=10)` 回 9 筆，三目標 symbol 全部命中、`file_path` 與本 plan 一致：

| symbol | codebase-memory file_path | 與 plan 一致 |
|---|---|---|
| `navText` | web-viewer-sample/src/console/EdgeConsole.tsx | ✓ |
| `SpecPage` | web-viewer-sample/src/console/pages.tsx | ✓ |
| `EdgeConsole` | web-viewer-sample/src/console/EdgeConsole.tsx | ✓ |

- 並列也回 `renderBody`(EdgeConsole.tsx)，**佐證 GitNexus 對 `SpecPage` 的 d1 caller `renderBody` 無漏報**。
- 行號差異（codebase-memory `SpecPage` 1138–1151 / `EdgeConsole` 163–251 / `navText` 169 vs 現檔 `SpecPage` 1328 / `EdgeConsole` 164 / `navText` 176）＝索引快照時間差；依 memory 規約**以 symbol + 檔路徑比對、非 file:line**，不影響判定。

### 4.1 [xref] 一個 advisory 漏報（benign，不翻 gate）

GitNexus 對 `EdgeConsole` upstream 回 0 caller，但實際掛載點為：

- `web-viewer-sample/src/main.tsx:15` — `import EdgeConsole from "./console/EdgeConsole";`
- `web-viewer-sample/src/main.tsx:40` — `useOperatorConsole ? <EdgeConsole /> : <App />`

JSX element 掛載 + default-export import 未被 callgraph 計為 upstream CALLS edge＝memory 所載的前端假陰漏報型態。**不翻 gate**：Task 2 僅改 render 內 JSX 字串屬性，未改 `EdgeConsole` 簽名 / default export / 回傳 JSX 結構 → `main.tsx` 掛載端結構性不受影響，risk 仍 LOW。已記入 PR concerns 作 advisory。

## 5. 最終判定

| symbol | risk | epistemic | 判定 |
|---|---|---|---|
| `SpecPage` | LOW | exact | 放行 |
| `EdgeConsole` | LOW | exact | 放行 |

**兩者皆 LOW（epistemic exact）、無 HIGH/CRITICAL → 安全門 PASS，放行進入 Task 0–3 編輯。** 唯一 advisory `[xref]`（`EdgeConsole` 的 `main.tsx` JSX 掛載未進 callgraph）對本批字串-only / token-only 改動為 benign，已記入 concerns。

> 註：本批 `detect_changes`（scope 外溢確認）依 spec「commit 前 detect_changes」原意留在 PR 前的 Task 4 執行；本前置門只負責 before-edit 的 upstream 風險判定。
