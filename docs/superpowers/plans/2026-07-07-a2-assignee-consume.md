# A2 收尾（assignee 消費端）Implementation Plan（Spec-2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec：`docs/superpowers/specs/2026-07-07-a2-assignee-consume-design.md`
> 前置：A1 plan Task 2（from-diff optional assignee body）與 Task 5（`IssueRow.assignee` 型別）已 merge。

**Goal:** VersionDiffPage「從 diff 建 Issue」支援帶指派；建立後可見指派狀態。

**Architecture:** 後端零改動（A1 plan 已交付 from-diff body）；本 plan 只動 governanceClient 一個函式簽名（additive optional 參數）與 VersionDiffPage UI。

**Tech Stack:** React 18 + Vitest（web-viewer-sample console）。

## Global Constraints

- **不做**：`apply-overlay` 維持 501·p15（pages.tsx:2015-2021 不動）；A2 頁禁出現成本影響塊；`change_type` enum 逐字 echo；不動 diff_engine。
- 誠實鐵律：證據型更新；建立失敗顯錯不樂觀。
- 驗證：`cd web-viewer-sample && npm run verify`；GitNexus impact/detect_changes。分支：`feat/a2-assignee-consume`。

---

### Task 1: `issuesFromDiff` 帶指派 ＋ VersionDiffPage UI

**Files:**
- Modify: `web-viewer-sample/src/console/governanceClient.ts`（`issuesFromDiff` :208-209）
- Modify: `web-viewer-sample/src/console/pages.tsx`（`VersionDiffPage` :1805；建 Issue 鈕 :2008）
- Test: `web-viewer-sample/src/console/governanceClient.test.ts` ＋ `web-viewer-sample/src/console/A2AssignOnCreate.test.tsx`（新檔）

**Interfaces:**
- Produces: `issuesFromDiff(diffId: string, assignee?: string | null)` — 有 assignee 才送 JSON body `{"assignee": ...}`；無參數時**完全維持現行為**（無 body），確保零回歸。

- [ ] **Step 1: 寫失敗測試（client 層）** — `issuesFromDiff("d1")` 不帶 body（與現行相同）；`issuesFromDiff("d1", "機電組")` 送 `{"assignee":"機電組"}`、`Content-Type: application/json`。
- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/console/governanceClient.test.ts`。
- [ ] **Step 3: 實作（client）**：

```ts
issuesFromDiff: (diffId: string, assignee?: string | null) =>
  jsonFetch<{ created: number; issue_ids: string[] }>(`/api/governance/issues/from-diff/${diffId}`, {
    method: "POST",
    ...(assignee != null
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignee }) }
      : {}),
  }),
```

- [ ] **Step 4: 寫失敗測試（頁面層）** — 掛載 VersionDiffPage（mock 完成一次 diff 的 state 前置：mock `createDiff`/`getDiff`/`getDiffItems`），在 `data-testid="a2-assignee-input"` 輸入「機電組」→ 點「變更構件建 issue」→ 斷言 `issuesFromDiff` 以 `("<diffId>", "機電組")` 被呼叫；輸入留空 → 以 `("<diffId>")` 或 `(id, undefined)` 呼叫。
- [ ] **Step 5: 實作（頁面）** — 建 Issue 鈕（:2008）左側加輸入框，鈕的 onClick 改帶值：

```tsx
<input className="ec-input" style={{ width: 110 }} data-testid="a2-assignee-input"
  placeholder={t("指派（可空）", "assignee (optional)")} ref={a2AssigneeRef} />
<Btn caption={t("POST from-diff（綁 ifc_guid；可帶指派）", "POST from-diff (bound to ifc_guid; optional assignee)")}
  disabled={!diffId || items.length === 0}
  onClick={async () => {
    if (!diffId) return;
    const v = a2AssigneeRef.current?.value.trim();
    try {
      const r = await governanceClient.issuesFromDiff(diffId, v ? v : undefined);
      setIssueNote(t(`已建立 ${r.created} 筆 issue${v ? `（指派：${v}）` : ""}`, `Created ${r.created} issue(s)${v ? ` (assignee: ${v})` : ""}`));
    } catch (e) { setErr(String(e)); }
  }}>
  {t("變更構件建 issue", "Create issue from changed elements")}
</Btn>
{issueNote ? <p className="ec-note" data-testid="a2-issue-note">{issueNote}</p> : null}
```

（`a2AssigneeRef = useRef<HTMLInputElement>(null)`、`issueNote` state 新增；建立成功訊息=證據型（用回應 `created` 數），不預先樂觀顯示。）

- [ ] **Step 6: 顯示指派（spec §1.2）** — VersionDiffPage 若有渲染 diff 相關 issue 清單／連結（`diffIssueImpact` 區塊，run() :1876-1903 後的呈現區），該處每筆 issue 加 `assignee` 顯示（`issue.assignee ?? t("未指派", "unassigned")`）；該區塊若目前只顯計數不列 issue 明細，則在建立成功 note（Step 5 `a2-issue-note`）保留指派資訊即可，並在 PR body 註明「清單明細顯示待 issue 中心頁」——不為此新造清單 UI（YAGNI）。
- [ ] **Step 7: 全測試通過＋`npm run verify`**；肉眼確認 A2 頁無新增任何成本相關 UI。
- [ ] **Step 8: Commit** — `feat(a2): 從 diff 建 Issue 支援指派（消費 O7）`。

### Task 2: E2E evidence ＋ PR

- [ ] **Step 1: E2E** — 選 base/target→Run Diff→輸入指派→建 Issue→`#issues`（IssuesRuleCenterPage）或 `GET /api/governance/issues` 確認 assignee 落值；截圖落 `artifacts/e2e/a2-assignee/`（`git add -f`）。同時截 `#a2` 全頁一張作「無成本影響塊」佐證。
- [ ] **Step 2: spec 補實作狀態行**（`2026-07-07-a2-assignee-consume-design.md`）＋開 PR `feat(a2): assignee 消費端（Spec-2）`，body 填 Frontend Verification 七列；`gh pr merge --squash --auto --delete-branch`。
