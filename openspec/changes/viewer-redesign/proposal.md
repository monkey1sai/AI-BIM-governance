# viewer-redesign — 3D viewer 重設計規格提案（含 viewer origin 解凍 + A1 rvt↔ifc↔usdc 治理交叉比對檢視）

> 狀態：**提案（spec-only，待使用者核准）**。本 change 只補規格與契約草案，不動 production code、不動 visual baseline、不 thaw `rvt-ifc-usdc-lineage` 實作。
> 依 `design-canon-change-control` R-A1：手寫正本 4 檔的改寫文字一律放 `drafts/`，由使用者審核後自行套用；AI 不直接編輯正本、本 PR 不 auto-merge。

## Why

使用者要重新設計 3D viewer（含 :5173 viewer origin 頁內 UI），並把 rvt↔ifc↔usdc 治理結果（交叉比對）納入 A1 使用面。規格盤點（2026-07-21）發現正本已有三欄版面、WebRTC 拓撲/lease、互動閉環、design token，但缺八類規格，其中三類阻塞 viewer 重設計：

1. **DataChannel 訊息 schema**：§04 只列訊息名，除 `openStageRequest` 外無欄位定義；`commandRejected` 零定義；`tests/contracts/` 無任何 DataChannel 契約檔。
2. **viewer origin（:5173）頁內 UI 規格**：正本只描述進場方式與職責（凍結黑箱），版面/HUD/角色差異/embedded 模式全部無規格。
3. **EmbeddedViewer 跨-origin iframe 契約（vg01）**：已在實碼落地（`EmbeddedViewer.tsx`）但未文件化，CH-I（Workspace 內嵌 viewport）缺前置契約。

另有高/中優先缺口：失敗態 visible states、斷線/heartbeat 逾時行為、鏡頭控制與工具列語意、效能 SLO、ViewportLayer 元件職責表。

同時，`rvt-ifc-usdc-lineage`（deferred）的 `lineage-governance-console` spec 明定設計 gate：「`docs/plans/*.html` 尚未定義 Alignment/Attempts/Audit 的 approved screen/state → `reference_missing`、full design completion=no」。本提案補齊該 UI 設計面（A1 治理摘要卡 + `#lineage` 交叉比對頁 screens），正是該 change 未來解凍的前置條件。

## What Changes

- **新增 capability spec × 4**（`specs/`）：
  - `viewer-viewport`：viewer 重設計規格——內嵌持久 viewport、失敗態矩陣、鏡頭控制/工具列/fullscreen、效能 SLO、元件職責表、viewer origin 頁內 UI（解凍範圍聲明：`/ui/open` 302 進場與 CI guard 不動）。
  - `kit-datachannel-protocol`：DataChannel 全訊息 schema 正本化（OUT×11 + IN×11，其中 runtime mutator ×9，含 `commandRejected` 全新定義與 runtime authority envelope）。
  - `embedded-viewer-bridge`：vg01 postMessage / iframe URL 契約（CH-I 前置）。
  - `a1-lineage-crosscheck-view`：A1 Dock 治理摘要卡 + `#lineage` 交叉比對頁（五 surfaces；資料規格權威=`rvt-ifc-usdc-lineage`，本 spec 只定 UI/IA 與誠實 provenance）。
- **新增契約草案**（`contracts/`）：`kit-datachannel-v1.schema.json`、`vg01-postmessage-v1.schema.json` + examples。落地實作時遷入 `tests/contracts/` 並接 CI；在那之前依 §04 現行條款，payload 權威=本 change 文字+實碼。
- **新增手寫正本增補 drafts**（`drafts/`，供使用者審核後自行套用）：
  - `design-doc-viewer-spec-draft.html`：設計文件 §03/§04/§06 增補 fragment（DataChannel schema 卡、viewer 失敗態矩陣、SLO、EmbeddedViewer 契約卡、A1 lineage 摘要卡與 `#lineage` route 列）。
  - `hifi-viewer-states-draft.html`：Hi-Fi 失敗態 screens（lease 被佔/斷線重連/GPU 不可用）fragment。
  - `hifi-lineage-page-draft.html`：Hi-Fi `#lineage` 頁 screen fragment（Alignment 表 + 3 ratio KPI + 六態 badge）。

## Non-Goals（明確排除）

- 不動 production code（web-viewer-sample / coordinator / streaming / governance 零 diff）。
- 不動 `/ui/open` 302 handoff、其參數白名單與 CI guard（§01 鐵律 3）。
- 不 thaw `rvt-ifc-usdc-lineage` 實作；不實作 RVT 收檔（watcher 仍只認 `*/model.ifc`）、alignment 計算、六態 outbox。
- 不動 visual baseline / manifest（R-A2）；不動 `support.js`（R-A3）。
- 不改 governance-service 職責邊界（lineage orchestration 歸 coordinator、conversion/mapping/alignment 歸 streaming）。

## 與既有 change 的關係

- `rvt-ifc-usdc-lineage`（deferred）：本提案為其 `lineage-governance-console` 設計 gate 的補位；三 ratios、10 fixed counts、六態 outbox、差異集合、capability 授權模型全部**引用不重定義**。實作解凍另行裁決。
- `align-frontend-design-system-reference`：本提案不動 manifest/baseline；未來實作 PR 落地 `#lineage` 與 viewer 失敗態畫面時，須依該 change 的 capture 雙旗標流程 rebaseline。
- CH-I（§07 Workspace 內嵌 viewport）：`viewer-viewport` + `embedded-viewer-bridge` 兩 spec 即 CH-I 的正式規格前置。

## Impact

- Affected specs：新增 4 個 capability（無既有 spec 的 MODIFIED/REMOVED）。
- Affected code：無（spec-only）。
- 落地順序建議（供未來實作 change 引用，非本 change 承諾）：①內嵌持久 viewport（A1/A2 接入）→ ②A3 內嵌 + A4 接線 → ③`#lineage` 頁（等 `rvt-ifc-usdc-lineage` 解凍後接真資料，先期可只落 IFC↔USDC 兩軸現成資料）。
