# canonical-linux live DOM audit — tasks 1.7, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2

Captured live against `http://<canonical-host>:8004/ui` (redacted; see
`task-6.2-6.5-deidentification-map.json` for the placeholder legend（P5 FH 更正：digest 對照已依 owner Q1a 於 2026-09-01 剝除）), 2026-08-31
~11:44Z-11:47Z, evidenceHead `d04de191ec48d4e34c6744f9201d5e37a4f11b6c` (bound product HEAD
assigned to this evidence-only closeout round). **Correction (round-2 verification F1):** the
actual deployment observed is task 6.1's `deploy-20260831-639237709604722760-001` tag, deployed
commit `a0ab7065131914e548e1d79a1c683c8b14b07de4` — not `d04de191` itself, which is a later,
unmerged branch-local evidence-only commit. The binding still holds in substance: `git diff
a0ab7065131914e548e1d79a1c683c8b14b07de4 d04de191ec48d4e34c6744f9201d5e37a4f11b6c -- .
":(exclude)docs/**" ":(exclude)openspec/**"` is empty, so this audit was captured against the
deployment at `a0ab7065`, whose product tree is byte-identical to evidenceHead `d04de191`. **Reachability correction (PR #734 review T4, 2026-09-01):** `d04de191` was a branch-local working SHA later removed by the privacy re-root (leaky history was never pushed), so it is NOT resolvable from a fresh clone. The reachable anchors are: deployed commit `a0ab7065` (deploy tag `deploy-20260831-639237709604722760-001`, on `main`) and the published PR branch history (`ba9084f`…). The product-tree-identity claim is reproducible today as `git diff a0ab7065...<PR-head> -- . ":(exclude)docs/**" ":(exclude)openspec/**"` = empty on the PR branch. References to `d04de191` below are historical capture-time labels, not resolvable objects. Queries
ran in-page via `document.querySelectorAll('[data-action]')` etc. against the live DOM — this is a
supplement to the screenshot+JSON pairing in `task-6.2-screenshot-vs-json-correlation.md`,
targeting the DOM-attribute-level claims (`data-action`, `data-prov`, `aria-describedby`) that a
static screenshot pixel comparison cannot verify by itself.

## #home — task 2.1 (button inventory), 2.3 (badge prov)

- `[data-action]` total: 9, all `nav` (the A1-A10 launcher grid + design-doc link). No `api` or
  `disabled` controls on this screen (expected — #home is a KPI/launcher screen, not a
  control-heavy one).
- `[data-prov]` value counts: `asbuilt: 13`, `demo: 1`, `fixture: 1`. No `LIVE` enum value present
  (canonical seven-value set: `asbuilt`/`artifact`/`demo`/`p1`/`p15`/`p3`/`p4` — confirms task
  2.3's "移除寫死 LIVE" for the A1-A10 badge system). The one residual `fixture` value is
  consistent with tasks.md's own disclosed carve-out ("i18n／導覽／style helper 保留"). **更正（Q3a，2026-09-01）：此歸因不充分（該子句是保留 helper「模組」，非 prov「值」白名單）；正確依據是 owner Q3a 明示 carve-out——`fixture`/`live`/`redirect` 屬容器（非 badge）prov 值白名單。**
- Literal substring `LIVE` (uppercase, uppercase check only, case-sensitive): **not present** on
  `#home`.

## #pipeline — task 2.4 (IP-gated action disclosure)

- `[data-action]` total: 6 (`nav: 5`, `disabled: 1`).
- The one `disabled` control is "觸發轉檔" (trigger conversion): `data-prov="p1"`,
  `aria-describedby` resolves to the text **"需 allowlist 來源：瀏覽器授權（D2＝T4 operator
  token，tasks §4.2）落地前停用；請至 #minio 由 allowlist 來源觸發。"** — this is a live,
  word-for-word match of task 2.4's required disclosure ("需 allowlist 來源").

## #a1 — tasks 1.7 (no literal 82%), 2.1, 3.1 (offline viewport honesty)

- `[data-action]` total: 14 (`nav: 12`, `api: 1` ["清除疊加"/clear overlay], `disabled: 1`).
- Offline-viewport label found verbatim in the rendered page: **"no-GPU
  示意／示範圖（非即時渲染）"** — matches task 3.1's required wording exactly.
- No fabricated streaming/FPS pattern (regex `\d+\s*ms\s*[·,]\s*\d+\s*FPS`) found anywhere in the
  page text — confirms the previously-reported fabricated `Streaming · 28 ms · 60 FPS` metric is
  gone.
- No active `a[href*="/ui/open"]` handoff link rendered (consistent — `runtime/status` shows
  `sessions.count=0` at capture time, so there is correctly no session to hand off to; task 3.1's
  "有 session 時 anchor" branch is not exercised by this idle system, not a defect).
- One `LIVE` substring found: `"LIVE 後端 · 治理檢核"` inside `A1DockLive.tsx:89` — this is the
  named live-mode indicator component's own honest "connected to a real backend" caption (source:
  `web-viewer-sample/src/console/unified/A1DockLive.tsx:89`), semantically the opposite of the
  fixture-badge problem task 2.3 targeted (a caption asserting genuine backend liveness, not a
  hardcoded provenance badge on non-live data). Documented here for full disclosure since the
  substring superficially matches "LIVE"; it does not represent a regression of task 2.3's actual
  target (`fixtures.ts:156-165`'s A1-A10 badge `data-prov` values, confirmed canonical-enum above).

## #a2 — task 2.2 (A2 dock real-page nav, no fake toast)

- "計算差異" (compute diff) button: `data-action="nav"` (navigates to a real page), no toast
  element (`[data-testid*="toast"]`/`.toast`/`[role="status"]`) present in the DOM.
- "啟動即時視圖": `data-action="disabled"`, `data-prov="demo"` (correctly disabled/labeled, not a
  live claim).
- Note: "完整工具 ↗" carries `data-prov="live"` — this is the pre-existing legacy Edge Console
  link explicitly out of this change's scope per owner ruling 0.5 ("完整工具只是保留之前的功能");
  it is not part of the A1-A10 canonical-badge set task 2.3 targets, and `"live"` here is a
  distinct, longstanding indicator unrelated to `fixtures.ts:156-165`.

## #a3 — task 2.2 (A3 dock real-page nav, no fake toast)

- "Build Federated USD" button: `data-action="nav"`, no toast element present. Same shape as #a2.

## #a4 — task 3.2 (header content)

- Page text includes purpose/context copy ("語意查詢"), input-source references (ifc-ready /
  llm-status), and an empty/disabled-state explanation (`unconfigured`/`disabled`-type wording) —
  consistent with task 3.2's "用途／輸入來源／空表原因／下一步" requirement. (No `[data-action]`
  elements matched here — A4's query controls are text inputs/pills, not the button-inventory
  surface task 2.1 targets.)

## #runtime — task 1.7 (no literal 82%)

- `document.body.innerText.includes('82%')` → **false**.
- GPU chip text: `"GPU 未取得"` (honest not-obtained state, not a fabricated percentage).
- `[data-action]` total: 5 (`nav: 4`, `disabled: 1` — "事件流" event-stream control,
  `data-prov="p1"`, consistent with the "structLog 事件流未提供" honest-disabled note already in
  tasks.md).
