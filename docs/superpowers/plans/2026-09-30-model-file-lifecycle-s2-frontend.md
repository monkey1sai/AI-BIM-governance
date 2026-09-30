# 模型檔案生命週期 S2（前端）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `web-viewer-sample` console 落地契約 §5：3D 工作區以「模型檔案」清單為統一入口（取代兩個下拉）、session 身分檔名優先、`#sessions` 的「清理舊紀錄」流程、已封存與模型資料頁的移除動作、`#demo-control` 降為進階工具，並補齊 S1 的兩項已知殘留。

**Architecture:** 顯示規則、列狀態與清理候選集中在純函式模組 `console/modelFiles/modelFileView.ts`；ready-review 的建立／重試／停止流程從 `ReadyReviewSessions` 逐字移入 `useReadyReviewRequest` hook；本機 IFC 進件的註冊與輪詢抽成 `classifyIntakeJob` 純函式加 `useIfcIntakeRegistration` hook；元件只組裝。所有刪除都經 `IntentDialog` 確認、走 `coordinatorClient` 的兩個新方法，409 的原因欄位以 `lifecycleConflict()` 解析後照實顯示。

**Tech Stack:** React 18、TypeScript、vitest（`createRoot`＋`act`、`vi.spyOn(coordinatorClient, …)`、`fx` 契約假資料）、Playwright（行程內真 coordinator fixture）、設計系統視覺 gate（Chromium、pixelmatch）。

**Spec:** `docs/plans/model-file-session-lifecycle-contract.md` §5（含 Task 1 的修訂）、§4.3／§4.4（錯誤碼）、§7 S2 完成條件；owner 2026-09-30 裁決：MinIO 紀錄主標籤＝`專案顯示名 · 種類 · 版本`，檔名第二行；其他紀錄檔名優先；清理天數預設 14。

## Global Constraints

- 前端只打 coordinator `:8004`（`coordinatorClient`／`coordinatorUrl`）；不新增後端路由；不改 `bim-review-coordinator/`（S1 已提供全部 API）。
- console 檔案只從 `./coordinatorClient`／`../coordinatorClient`（`console/coordinatorClient.ts` re-export）import client、錯誤類別與型別；不直接 import `src/coordinatorClient/errors.ts`。
- 每個 `coordinatorClient` 方法都要在 `coordinatorClient/routes.ts` 有同名 route（`coordinatorClient.contract.test.ts` 逐一比對）；契約 operation 用 `serves("<operationId>")`，`/api/dev/*` 用 `"non_contract"`。
- 誠實標示：未接通或不可用的動作一律 `<Btn disabled caption=…>`，dev routes 關閉時整段本機 IFC 區塊不顯示並以 `ProvTag prov="p1"` 說明；不得出現假成功；409／403／404 照實顯示 server 的 `error_code` 與附帶欄位。
- 契約 §5.5 的 test id：`model-file-list`、`model-file-row-<key>`、`model-file-convert-<source_id>`、`model-file-open-<key>`、`model-file-create-<key>`、`model-file-remove-<key>`、`session-purge-<id>`、`cleanup-open`、`cleanup-days`、`cleanup-preview`、`cleanup-confirm`、`cleanup-result-row-<id>`、`conversion-record-remove-<key>`（模型資料頁的移除鈕）、`conversion-records-include-removed`（模型資料頁「顯示已移除」切換）。列級 id 一律帶鍵或 id 後綴。
- `unified/fixtureNotInProduction.test.ts` 禁止 production 檔 import `__testdata__`，且新文案不得撞到它的禁字（「套用疊加」「由差異開單」「Federated Stage」等）。
- 新增 UI 文案一律 `t("中文", "English")`；新檔不在 module 層級呼叫 `t()`（既有字典如 `MINIO_CHIP_LABEL` 已在 module 層級用 `t()`，補項時沿用該檔模式）。
- 產品路徑（`web-viewer-sample/src/console/**`）變更會觸發設計 gate：`workspace.a1.default` 基線必須以成對 product-surface 流程重錄（Task 10），PR body 要有 Frontend Verification 表與 11 個 legacy route 的 Known gaps。
- 每個 commit 前 `git diff --cached --check`；commit 訊息結尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 工作區：`C:\Repos\active\iot\AI-BIM-governance.worktrees\model-file-lifecycle-s2`（branch `feat/model-file-lifecycle-s2`，基底 `4a69838`）；`web-viewer-sample/node_modules` 以 junction 借主 checkout；清理只能用 PowerShell 驗 ReparsePoint 後 `[IO.Directory]::Delete`，禁 `Remove-Item -Recurse`，拆完 junction 才 `git worktree remove`。

## Review Focus

1. 「使用者在清單上按了開啟，3D 卻沒切換」：開啟只在 coordinator 回 created／active 後才呼叫 `onSelected`；Task 5 測試 `open existing calls onSelected only after the coordinator confirms` 釘住。
2. 「清理把還有人在看的 session 結束掉」：候選只收 `viewer_leases` 為空且 `primary_viewer_lease_id` 為 null 的 active session；Task 2 測試 `stale active excludes sessions with a lease` 釘住。
3. 「409 被吞掉，使用者不知道為什麼不能移除」：`lifecycleConflict` 把 `sessions`／`intake_status`／`status` 帶進訊息；Task 3 測試與 Task 6 的 `has_descendants` 測試釘住。
4. 「dev routes 關閉時清單一直轉」：`listIfcSources` 404 `dev_routes_disabled` 進入 `disabled` 狀態不再重試；Task 4 測試 `dev routes disabled stops the local section` 釘住。
5. 「MinIO 紀錄全部顯示 model.ifc」：`modelFileLabel` 對 `mw_` 鍵用專案·種類·版本；Task 2 測試 `minio records use project · category · version` 釘住。

## File Structure

| 動作 | 路徑 | 責任 |
|---|---|---|
| 修改 | `docs/plans/model-file-session-lifecycle-contract.md` | §5.1 顯示名稱規則與 test id 後綴、§5.4 改掛模型資料頁、§8 已裁決 |
| 建立 | `web-viewer-sample/src/console/modelFiles/modelFileView.ts` | 純函式：鍵判定、顯示標籤、列狀態、未註冊來源、清理候選 |
| 建立 | `web-viewer-sample/src/console/modelFiles/modelFileView.test.ts` | 上述純函式測試 |
| 修改 | `web-viewer-sample/src/coordinatorClient/routes.ts`、`client.ts`、`types.ts`、`errors.ts` | 兩條 DELETE、dev 進件兩條 non_contract、`include_removed`、`removed` 狀態、409 解析 |
| 建立 | `web-viewer-sample/src/coordinatorClient/lifecycle.test.ts` | 新方法與 409 解析測試 |
| 建立 | `web-viewer-sample/src/console/modelFiles/intakeProgress.ts` | `classifyIntakeJob` 純函式與常數 |
| 建立 | `web-viewer-sample/src/console/modelFiles/useIfcIntakeRegistration.ts` | 本機 IFC 來源載入、註冊、輪詢 hook |
| 建立 | `web-viewer-sample/src/console/modelFiles/intake.test.tsx` | 純函式與 hook 測試 |
| 修改 | `web-viewer-sample/src/console/RealIfcConsolePage.tsx` | 輪詢改用 `classifyIntakeJob`；頁首「操作工具」標示 |
| 建立 | `web-viewer-sample/src/console/modelFiles/useReadyReviewRequest.ts` | 建立／開啟／重試／停止流程（自 `ReadyReviewSessions` 移入） |
| 建立 | `web-viewer-sample/src/console/modelFiles/ModelFileList.tsx` | 模型檔案清單元件 |
| 建立 | `web-viewer-sample/src/console/modelFiles/ModelFileList.test.tsx` | 元件測試 |
| 刪除 | `web-viewer-sample/src/console/ReadyReviewSessions.tsx`、`ReadyReviewSessions.test.tsx` | 被取代 |
| 修改 | `web-viewer-sample/src/console/A1GovernanceWorkbenchPage.tsx`、`unified/operator-workflow.css`、`A1ViewerEmbed.test.tsx` | 換元件、CSS selector、測試改用新 id |
| 修改 | `web-viewer-sample/src/console/sessionIdentity.ts`、`SessionIdentityCard.tsx`、`ClosedSessionRecovery.tsx` 與三個測試檔 | 檔名優先、已封存列檔名欄與移除 |
| 建立 | `web-viewer-sample/src/console/SessionCleanupDialog.tsx`、`SessionCleanupDialog.test.tsx` | 清理舊紀錄流程 |
| 修改 | `web-viewer-sample/src/console/pages.tsx`、`SessionManagementPage.test.tsx` | 清理入口與重載 |
| 修改 | `web-viewer-sample/src/console/modelData/useConversionData.ts`、`conversionShared.tsx`、`ObjectDetailPane.tsx` 與其測試 | `include_removed=1`、`removed` chip、停用觸發、移除紀錄 |
| 建立 | `web-viewer-sample/e2e/model-file-lifecycle.spec.ts` | 真 coordinator 的清單→建立→關閉→移除→清理 E2E |
| 修改 | `web-viewer-sample/e2e/ready-review-session-intent.spec.ts`、`ready-review-isolated.spec.ts` | 改用新 test id |
| 修改 | `docs/plans/design-system-baseline/workspace.a1.default/*.png`、`docs/plans/design-system-reference.manifest.json` | 成對重錄 A1 基線 |

---

### Task 0: Worktree 與環境

**Files:**
- 無程式變更。

- [ ] **Step 1: 確認 worktree（controller 已建立）**

```powershell
cd C:\Repos\active\iot\AI-BIM-governance.worktrees\model-file-lifecycle-s2
git status --short; git log --oneline -1
```

Expected: 乾淨；HEAD 為本計畫的 commit（基底 `4a69838`）。

- [ ] **Step 2: junction 借 node_modules**

```powershell
$wt = "C:\Repos\active\iot\AI-BIM-governance.worktrees\model-file-lifecycle-s2"
$main = "C:\Repos\active\iot\AI-BIM-governance"
New-Item -ItemType Junction -Path "$wt\web-viewer-sample\node_modules" -Target "$main\web-viewer-sample\node_modules"
New-Item -ItemType Junction -Path "$wt\bim-review-coordinator\node_modules" -Target "$main\bim-review-coordinator\node_modules"
```

coordinator 的 junction 只給 E2E fixture（`ready-review-fixture.ts` 直接 import coordinator 原始碼）用。

- [ ] **Step 3: 基線**

```powershell
cd "$wt\web-viewer-sample"; npm test; npx tsc --noEmit
```

Expected: 全綠；記下檔數／測試數作為 Task 11 的對照基線。

---

### Task 1: 契約文件修訂（顯示名稱、§5.4 改掛、§8）

**Files:**
- Modify: `docs/plans/model-file-session-lifecycle-contract.md`

- [ ] **Step 1: §5.1 顯示名稱規則**

在 §5.1「每列固定顯示：檔名……」那一段之前加一段：

```
顯示名稱（owner 2026-09-30 裁決）：`idempotency_key` 符合 `^mw_[a-f0-9]{16}$` 的 MinIO 紀錄，主標籤＝`專案顯示名 · 種類 · 版本`（與 session 身分卡的 `sessionTitle` 同格式），第二行為檔名；其他紀錄主標籤＝`source_ifc_filename`，null 時顯示「來源未知」加鍵的短碼，第二行為 `專案 · 版本`。session 身分同規則：MinIO 來源用專案·種類·版本，其他來源檔名優先。列級 test id 一律帶鍵或 id 後綴（`model-file-row-<key>`、`model-file-open-<key>`、`model-file-create-<key>`、`model-file-remove-<key>`、`model-file-convert-<source_id>`、`session-purge-<id>`、`cleanup-result-row-<id>`、`conversion-record-remove-<key>`）。
```

- [ ] **Step 2: §5.4 改掛模型資料頁**

把 §5.4 整段替換為：

```
### 5.4 模型資料頁的移除

`modelData/ConversionHistoryPanel.tsx` 列的是 streaming 轉檔 job 歷史（`/api/dev/conversions`），不是 coordinator 紀錄，S1 的移除不作用在它身上，維持不變。移除紀錄掛在模型資料頁的物件詳情（`modelData/ObjectDetailPane.tsx`「轉檔動作」區）：按鈕「移除紀錄」（`conversion-record-remove-<key>`，經 `IntentDialog` 確認）對該物件對帳到的 ledger 紀錄呼叫 §4.4；被進行中 session 引用時停用並列出 session；server 回 409 `record_in_flight` 時照實顯示 `intake_status`。chips 一律以 `include_removed=1` 取紀錄，`removed` 顯示「已移除」，此時「觸發轉檔」停用，caption 指向第②步的重派（重派以新鍵建立紀錄）。
```

- [ ] **Step 3: §8 命名風險改為已裁決**

把 §8「MinIO 紀錄都叫 `model.ifc`」那條的最後一句「屬 owner 裁決，S1 未決定」改為「owner 2026-09-30 已裁決，規則見 §5.1」。

- [ ] **Step 4: 狀態行**

第 3 行狀態改為 `狀態：**S1 已合併（PR #980）；S2 實作中（分支 \`feat/model-file-lifecycle-s2\`）；S3 未開始**`。

- [ ] **Step 5: Commit**

```powershell
git add docs/plans/model-file-session-lifecycle-contract.md
git diff --cached --check; git commit -m "docs(plans): S2 display-name rule, model-data removal placement, test id suffixes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `modelFileView.ts` 純函式

**Files:**
- Create: `web-viewer-sample/src/console/modelFiles/modelFileView.ts`
- Modify: `web-viewer-sample/src/console/sessionIdentity.ts`（加 `MINIO_KEY_RE`、`isMinioKey`，放在最底層避免循環 import）
- Test: `web-viewer-sample/src/console/modelFiles/modelFileView.test.ts`

**Interfaces:**
- Produces: `isMinioKey(key)`, `keyShortCode(key)`, `modelFileLabel(record): { title, subtitle }`, `activeSessions(record)`, `closedSessionCount(record)`, `preferredOpenTarget(record)`, `removalState(record): { allowed: true } | { allowed: false; reason: string }`, `unregisteredSources(sources, records)`, `cleanupCandidates(input): CleanupCandidates`, type `RecordSession`.

- [ ] **Step 1: 寫失敗測試**

`web-viewer-sample/src/console/modelFiles/modelFileView.test.ts`：

```ts
// 契約 §5.1 顯示名稱（owner 2026-09-30）、§5.3 清理候選、§4.4 移除條件的純函式測試。
import { describe, expect, it } from "vitest";
import { fx } from "../__testdata__/contractFixtures";
import type { ClosedReviewSessionItem, ConversionRecord, RuntimeSessionSummary } from "../coordinatorClient";
import {
  activeSessions, cleanupCandidates, closedSessionCount, isMinioKey, keyShortCode, modelFileLabel,
  preferredOpenTarget, removalState, unregisteredSources,
} from "./modelFileView";

const MW = "mw_0123456789abcdef";
const session = (over: Partial<ConversionRecord["sessions"][number]>) => ({
  session_id: "review_session_a", status: "active" as const, created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z", link: "ready_model" as const, ...over,
});
const record = (over: Partial<ConversionRecord>) => fx.conversionRecord({
  idempotency_key: MW, project_id: "proj_a", project_display_name: "專案A", category: "建築",
  external_model_version_id: "v1", status: "ready", source_ifc_filename: "model.ifc", sessions: [], ...over,
});

describe("modelFileLabel", () => {
  it("minio records use project · category · version, filename second", () => {
    expect(modelFileLabel(record({}))).toEqual({ title: "專案A · 建築 · 版本 v1", subtitle: "model.ifc" });
  });
  it("other records use the filename first, project · version second", () => {
    expect(modelFileLabel(record({ idempotency_key: "idem_devreg_1", source_ifc_filename: "villa.ifc" })))
      .toEqual({ title: "villa.ifc", subtitle: "專案A · 版本 v1" });
  });
  it("never invents a filename", () => {
    const label = modelFileLabel(record({ idempotency_key: "idem_devreg_1", source_ifc_filename: null }));
    expect(label.title).toBe(`來源未知 ${keyShortCode("idem_devreg_1")}`);
    expect(isMinioKey("idem_devreg_1")).toBe(false);
    expect(isMinioKey(MW)).toBe(true);
  });
});

describe("sessions and removal", () => {
  it("splits active and closed sessions and prefers the first active one", () => {
    const r = record({ sessions: [session({ session_id: "s_new", created_at: "2026-09-03T00:00:00.000Z" }), session({ session_id: "s_closed", status: "closed" }), session({ session_id: "s_closing", status: "closing" })] });
    expect(activeSessions(r).map((s) => s.session_id)).toEqual(["s_new", "s_closing"]);
    expect(closedSessionCount(r)).toBe(1);
    expect(preferredOpenTarget(r)?.session_id).toBe("s_new");
  });
  it("blocks removal while a session is active or the record is already removed", () => {
    expect(removalState(record({ sessions: [session({})] }))).toEqual({ allowed: false, reason: "被 1 筆進行中審查佔用：review_session_a" });
    expect(removalState(record({ status: "removed" }))).toEqual({ allowed: false, reason: "已移除" });
    expect(removalState(record({ sessions: [session({ status: "closed" })] }))).toEqual({ allowed: true });
  });
  it("lists only local sources whose filename no record knows", () => {
    const sources = [{ source_id: "a", filename: "villa.ifc" }, { source_id: "b", filename: "new.ifc" }];
    expect(unregisteredSources(sources, [record({ source_ifc_filename: "villa.ifc" })]).map((s) => s.source_id)).toEqual(["b"]);
  });
});

describe("cleanupCandidates", () => {
  const now = Date.parse("2026-09-30T00:00:00.000Z");
  const old = "2026-09-01T00:00:00.000Z";
  const fresh = "2026-09-29T00:00:00.000Z";
  const live = (over: Partial<RuntimeSessionSummary>) => fx.runtimeSessionSummary({ status: "active", updated_at: old, viewer_leases: [], primary_viewer_lease_id: null, ...over });
  const closed = (over: Partial<ClosedReviewSessionItem>): ClosedReviewSessionItem => ({
    session_id: "review_session_c", status: "closed", project_id: "p", model_version_id: "m", created_at: old, updated_at: old,
    recreated_from_session_id: null, source_ifc_filename: null, rebuildability: { state: "ready", reason: null, checked_at: old }, ...over,
  });
  it("groups closed, stale active and unused records older than the cutoff", () => {
    const out = cleanupCandidates({ now, days: 14,
      live: [live({ session_id: "stale" }), live({ session_id: "fresh", updated_at: fresh }), live({ session_id: "failed_old", status: "failed" })],
      closed: [closed({}), closed({ session_id: "recent", updated_at: fresh })],
      records: [record({ updated_at: old }), record({ idempotency_key: "mw_ffffffffffffffff", updated_at: old, sessions: [session({})] }), record({ idempotency_key: "idem_x", updated_at: fresh })] });
    expect(out.closedSessions.map((s) => s.session_id)).toEqual(["review_session_c", "failed_old"]);
    expect(out.staleActive.map((s) => s.session_id)).toEqual(["stale"]);
    expect(out.records.map((r) => r.idempotency_key)).toEqual([MW]);
    expect(out.cutoffIso).toBe("2026-09-16T00:00:00.000Z");
  });
  it("stale active excludes sessions with a lease", () => {
    const withLease = live({ session_id: "leased", primary_viewer_lease_id: "lease_1", viewer_leases: [fx.publicViewerLease({})] });
    expect(cleanupCandidates({ now, days: 14, live: [withLease], closed: [], records: [] }).staleActive).toEqual([]);
  });
});
```

`fx.publicViewerLease` 與 `fx.runtimeSessionSummary` 來自 `console/__testdata__/contractFixtures.ts`（`fx` 物件，line ~356）。

- [ ] **Step 2: 跑測試確認失敗**

```powershell
cd web-viewer-sample; npx vitest run src/console/modelFiles/modelFileView.test.ts
```

Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作**

`sessionIdentity.ts` 在 `UUID_RE` 之後加：

```ts
/** MinIO 進件的 ready-model 身分（契約 §5.1 顯示名稱規則以此分流）。 */
export const MINIO_KEY_RE = /^mw_[a-f0-9]{16}$/;
export function isMinioKey(key: string | null | undefined): boolean { return typeof key === "string" && MINIO_KEY_RE.test(key); }
```

`web-viewer-sample/src/console/modelFiles/modelFileView.ts`：

```ts
// 模型檔案清單的純函式（契約 §5.1 顯示名稱、§5.3 清理候選、§4.4 移除條件）。無 React、無 I/O。
// 在途判定不在前端重算：server 的 409 record_in_flight 是權威，前端只擋能確定的情況。
import type { ClosedReviewSessionItem, ConversionRecord, RuntimeSessionSummary } from "../coordinatorClient";
import { t } from "../i18n";
import { isMinioKey, shortVersion } from "../sessionIdentity";

export { isMinioKey };
export type RecordSession = ConversionRecord["sessions"][number];

export function keyShortCode(key: string): string { return key.length <= 12 ? key : `…${key.slice(-8)}`; }

export interface ModelFileLabel { title: string; subtitle: string }
type LabelSource = Pick<ConversionRecord, "idempotency_key" | "project_display_name" | "project_id" | "category" | "external_model_version_id" | "source_ifc_filename">;

/** owner 2026-09-30：MinIO 紀錄主標籤＝專案·種類·版本；其他紀錄檔名優先；查無檔名不猜。 */
export function modelFileLabel(record: LabelSource): ModelFileLabel {
  const project = record.project_display_name || record.project_id;
  const version = `${t("版本", "version")} ${shortVersion(record.external_model_version_id)}`;
  const filename = record.source_ifc_filename || `${t("來源未知", "source unknown")} ${keyShortCode(record.idempotency_key)}`;
  if (isMinioKey(record.idempotency_key)) {
    return { title: `${project} · ${record.category || t("種類未取得", "category unavailable")} · ${version}`, subtitle: filename };
  }
  return { title: filename, subtitle: `${project} · ${version}` };
}

const ACTIVE = new Set<RecordSession["status"]>(["created", "active", "closing"]);
export function activeSessions(record: Pick<ConversionRecord, "sessions">): RecordSession[] { return record.sessions.filter((s) => ACTIVE.has(s.status)); }
export function closedSessionCount(record: Pick<ConversionRecord, "sessions">): number { return record.sessions.filter((s) => s.status === "closed" || s.status === "failed").length; }
/** sessions[] 已由 server 依 created_at 降冪；取第一個進行中者。 */
export function preferredOpenTarget(record: Pick<ConversionRecord, "sessions">): RecordSession | null { return activeSessions(record)[0] ?? null; }

export type RowRemoval = { allowed: true } | { allowed: false; reason: string };
export function removalState(record: Pick<ConversionRecord, "sessions" | "status">): RowRemoval {
  const active = activeSessions(record);
  if (active.length > 0) {
    const ids = active.map((s) => s.session_id).join("、");
    return { allowed: false, reason: t(`被 ${active.length} 筆進行中審查佔用：${ids}`, `In use by ${active.length} active review(s): ${ids}`) };
  }
  if (record.status === "removed") return { allowed: false, reason: t("已移除", "already removed") };
  return { allowed: true };
}

export function unregisteredSources<T extends { filename: string }>(sources: readonly T[], records: readonly Pick<ConversionRecord, "source_ifc_filename">[]): T[] {
  const known = new Set(records.map((r) => r.source_ifc_filename).filter((name): name is string => Boolean(name)));
  return sources.filter((s) => !known.has(s.filename));
}

export interface CleanupInput { now: number; days: number; live: readonly RuntimeSessionSummary[]; closed: readonly ClosedReviewSessionItem[]; records: readonly ConversionRecord[] }
export interface CleanupCandidates { cutoffIso: string; closedSessions: Array<Pick<ClosedReviewSessionItem, "session_id" | "status" | "updated_at" | "source_ifc_filename">>; staleActive: RuntimeSessionSummary[]; records: ConversionRecord[] }

/** §5.3 三組候選：已關閉／失敗、無人連線的舊 active、無進行中 session 的舊紀錄。 */
export function cleanupCandidates(input: CleanupInput): CleanupCandidates {
  const cutoff = input.now - input.days * 86_400_000;
  const older = (iso: string) => { const ms = Date.parse(iso); return Number.isFinite(ms) && ms < cutoff; };
  const closedSessions: CleanupCandidates["closedSessions"] = [
    ...input.closed.filter((s) => s.status === "closed" && older(s.updated_at)),
    ...input.live.filter((s) => s.status === "failed" && older(s.updated_at))
      .map((s) => ({ session_id: s.session_id, status: s.status, updated_at: s.updated_at, source_ifc_filename: s.origin?.source_ifc_filename ?? null })),
  ];
  const staleActive = input.live.filter((s) => (s.status === "created" || s.status === "active") && older(s.updated_at)
    && s.viewer_leases.length === 0 && s.primary_viewer_lease_id === null);
  const records = input.records.filter((r) => r.status !== "removed" && older(r.updated_at) && activeSessions(r).length === 0);
  return { cutoffIso: new Date(cutoff).toISOString(), closedSessions, staleActive, records };
}
```

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run src/console/modelFiles/modelFileView.test.ts src/console/sessionIdentity.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/console/modelFiles/modelFileView.ts src/console/modelFiles/modelFileView.test.ts src/console/sessionIdentity.ts
git diff --cached --check; git commit -m "feat(console): model file view rules (display name, removal state, cleanup candidates)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: coordinatorClient：兩條 DELETE、dev 進件路由、`include_removed`、`removed`、409 解析

**Files:**
- Modify: `web-viewer-sample/src/coordinatorClient/routes.ts`（`COORDINATOR_ROUTES`）、`client.ts`（`getConversionRecords` 附近）、`types.ts`（型別匯出與 `CONVERSION_LEDGER_STATUSES`）、`errors.ts`
- Test: `web-viewer-sample/src/coordinatorClient/lifecycle.test.ts`

**Interfaces:**
- Produces: `coordinatorClient.purgeReviewSession(sessionId, reason = "manual")`, `coordinatorClient.removeConversionRecord(key)`, `coordinatorClient.getConversionRecords(limit = 50, { includeRemoved })`, `coordinatorClient.listIfcSources()`, `coordinatorClient.registerIfcSource(sourceId, body)`; types `PurgeReviewSessionResponse`, `ConversionRecordRemovalResponse`, `ConversionRecordSession`, `IfcSource`, `IfcSourceRegistration`; `lifecycleConflict(error)`; `narrowConversionStatus("removed") === "removed"`.

- [ ] **Step 1: 寫失敗測試**

```ts
// coordinatorClient/lifecycle.test.ts — 契約 §4.3／§4.4 的瀏覽器端呼叫與 409 解析。
import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient } from "./index";
import { CoordinatorHttpError, lifecycleConflict } from "./errors";
import { narrowConversionStatus } from "./types";

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("lifecycle client methods", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("purgeReviewSession sends DELETE with the reason query", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, {
      session_id: "review_session_a", status: "purged", purged_at: "2026-09-30T00:00:00.000Z", removed: { session_file: true, events_file: true },
    }));
    const out = await coordinatorClient.purgeReviewSession("review_session_a", "stale_cleanup");
    expect(out.status).toBe("purged");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/review-sessions\/review_session_a\?reason=stale_cleanup$/);
    expect(init.method).toBe("DELETE");
  });

  it("removeConversionRecord sends DELETE to the record key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, {
      idempotency_key: "mw_0123456789abcdef", status: "removed", removed_at: "2026-09-30T00:00:00.000Z", intake_jobs_removed: 1,
    }));
    await coordinatorClient.removeConversionRecord("mw_0123456789abcdef");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/conversion\/records\/mw_0123456789abcdef$/);
    expect(init.method).toBe("DELETE");
  });

  it("getConversionRecords adds include_removed=1 only when asked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, { count: 0, items: [] }));
    await coordinatorClient.getConversionRecords(100);
    await coordinatorClient.getConversionRecords(100, { includeRemoved: true });
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/limit=100$/);
    expect(String(fetchSpy.mock.calls[1][0])).toMatch(/limit=100&include_removed=1$/);
  });

  it("lifecycleConflict extracts the 409 fields and ignores other errors", () => {
    const inUse = new CoordinatorHttpError("/api/conversion/records/k", 409, "record_in_use", "record_in_use", { error_code: "record_in_use", sessions: ["review_session_a"] });
    expect(lifecycleConflict(inUse)).toEqual({ code: "record_in_use", sessions: ["review_session_a"], intakeStatus: undefined, status: undefined });
    const inFlight = new CoordinatorHttpError("/api/conversion/records/k", 409, "record_in_flight", "record_in_flight", { error_code: "record_in_flight", intake_status: "dispatched" });
    expect(lifecycleConflict(inFlight)?.intakeStatus).toBe("dispatched");
    expect(lifecycleConflict(new CoordinatorHttpError("/x", 403, "caller ip not in allowlist"))).toBeNull();
    expect(lifecycleConflict(new Error("boom"))).toBeNull();
  });

  it("narrowConversionStatus accepts removed", () => {
    expect(narrowConversionStatus("removed")).toBe("removed");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run src/coordinatorClient/lifecycle.test.ts src/coordinatorClient/coordinatorClient.contract.test.ts
```

Expected: FAIL（方法不存在；`narrowConversionStatus("removed")` 回 null）。

- [ ] **Step 3: 實作**

`routes.ts` 在 `sessionClose` 之後加：

```ts
  purgeReviewSession: { method: "DELETE", path: "/api/review-sessions/{sessionId}", tag: serves("purgeReviewSession") },
```

在 `readyReviewSession` 之後加：

```ts
  removeConversionRecord: { method: "DELETE", path: "/api/conversion/records/{key}", tag: serves("removeConversionRecord") },
```

在 `getConversionsHistory` 之前加：

```ts
  listIfcSources: { method: "GET", path: "/api/dev/ifc-sources", tag: "non_contract" },
  registerIfcSource: { method: "POST", path: "/api/dev/ifc-sources/{sourceId}/register", tag: "non_contract" },
```

`types.ts`：在既有 `components["schemas"]` 型別別名區加：

```ts
export type PurgeReviewSessionResponse = components["schemas"]["PurgeReviewSessionResponse"];
export type ConversionRecordRemovalResponse = components["schemas"]["ConversionRecordRemovalResponse"];
export type ConversionRecordSession = components["schemas"]["ConversionRecordSession"];
/** `/api/dev/ifc-sources` 是 non-contract dev 路由：欄位照 coordinator `app.ts` ifc-sources 回應。 */
export interface IfcSource { source_id: string; filename: string; relative_path: string; size_bytes: number; modified_at: string }
/** `/api/dev/ifc-sources/{id}/register` 的回應＝intake job 摘要加 lineage 起點；只列前端會讀的欄位。 */
export interface IfcSourceRegistration {
  ifc_ready_job_id?: string | null; external_model_version_id?: string | null; download_status?: string | null;
  conversion_status?: string | null; source_ifc_filename?: string | null; error_code?: string | null;
}
```

（`components` 的 import 名稱依檔案既有寫法；若檔案以 `import type { components } from "../generated/coordinator-api"` 匯入就直接用。）`CONVERSION_LEDGER_STATUSES` 陣列加 `"removed"`。

`client.ts`：`getConversionRecords` 改為

```ts
    getConversionRecords: (limit = 50, options: { includeRemoved?: boolean } = {}) =>
      transport.request<{ count: number; items: ConversionRecord[] }>(ROUTES.getConversionRecords, {
        query: options.includeRemoved ? `limit=${limit}&include_removed=1` : `limit=${limit}`,
      }),
```

在 `readyReviewSession` 之後加：

```ts
    // model-file-session-lifecycle-contract §4.4：墓碑化一筆轉檔紀錄（server 端檢查 in-use／in-flight）。
    removeConversionRecord: (key: string) =>
      transport.request<ConversionRecordRemovalResponse>(ROUTES.removeConversionRecord, { params: { key } }),
```

在 `sessionClose` 之後加：

```ts
    // model-file-session-lifecycle-contract §4.3：purge 已結束 session；reason 只用於稽核。
    purgeReviewSession: (sessionId: string, reason: "manual" | "stale_cleanup" = "manual") =>
      transport.request<PurgeReviewSessionResponse>(ROUTES.purgeReviewSession, { params: { sessionId }, query: `reason=${reason}` }),
```

在 `getIfcReadyJob` 之後加：

```ts
    listIfcSources: () => transport.request<{ items: IfcSource[] }>(ROUTES.listIfcSources),
    registerIfcSource: (sourceId: string, body: { project_id: string; model_version_id: string }) =>
      transport.request<IfcSourceRegistration>(ROUTES.registerIfcSource, { params: { sourceId }, body }),
```

並在檔頭 type import 補 `PurgeReviewSessionResponse, ConversionRecordRemovalResponse, IfcSource, IfcSourceRegistration`；`index.ts` 若逐一 re-export 型別，補上這四個與 `ConversionRecordSession`。

`errors.ts` 末尾加：

```ts
/** 生命週期路由的 409 body（契約 §4.3／§4.4）：console 照實顯示的欄位。非 409 或無 error_code 回 null。 */
export function lifecycleConflict(error: unknown): { code: string; sessions?: string[]; intakeStatus?: string; status?: string } | null {
  if (!(error instanceof CoordinatorHttpError) || error.status !== 409 || !error.errorCode) return null;
  const body = (error.body && typeof error.body === "object" ? error.body : {}) as Record<string, unknown>;
  const sessions = Array.isArray(body.sessions) ? body.sessions.filter((v): v is string => typeof v === "string") : undefined;
  return {
    code: error.errorCode, sessions,
    intakeStatus: typeof body.intake_status === "string" ? body.intake_status : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
  };
}
```

`src/coordinatorClient/index.ts` :31-37 的 `export { … } from "./errors"` 區塊加入 `lifecycleConflict`（console 端只能從這個 barrel 取得）。

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run src/coordinatorClient; npx tsc --noEmit
```

Expected: PASS；契約漂移測試的「members 與 routes 同名」通過。

- [ ] **Step 5: Commit**

```powershell
git add src/coordinatorClient
git diff --cached --check; git commit -m "feat(coordinator-client): purge session, remove record, include_removed, dev intake routes, 409 conflict parsing" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 進件輪詢純函式與 `useIfcIntakeRegistration`

**Files:**
- Create: `web-viewer-sample/src/console/modelFiles/intakeProgress.ts`
- Create: `web-viewer-sample/src/console/modelFiles/useIfcIntakeRegistration.ts`
- Modify: `web-viewer-sample/src/console/RealIfcConsolePage.tsx`（`startPoll` 的 tick 改用 `classifyIntakeJob`；頁首加標示）
- Test: `web-viewer-sample/src/console/modelFiles/intake.test.tsx`

**Interfaces:**
- Produces: `classifyIntakeJob(job, attempt, max?)`, `INTAKE_POLL_MS = 5000`, `INTAKE_MAX_ATTEMPTS = 36`, `type IntakeOutcome`; hook `useIfcIntakeRegistration(onReady)` 回 `{ sources, devRoutes, loadError, progress, loadSources, register }`。

- [ ] **Step 1: 寫失敗測試**

```tsx
// 契約 §5.1 本機未轉檔 IFC：註冊→輪詢→終態；dev routes 關閉時整段隱藏且不再重試。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "../coordinatorClient";
import { classifyIntakeJob } from "./intakeProgress";
import { useIfcIntakeRegistration } from "./useIfcIntakeRegistration";

describe("classifyIntakeJob", () => {
  it("follows RealIfcConsolePage's terminal rules", () => {
    expect(classifyIntakeJob({ viewer_url: "/ui/open?session=s", web_view_session_id: "s" }, 1)).toEqual({ kind: "ready", viewerUrl: "/ui/open?session=s", sessionId: "s" });
    expect(classifyIntakeJob({ download_status: "failed" }, 1)).toEqual({ kind: "download_failed" });
    expect(classifyIntakeJob({ conversion_status: "failed" }, 1)).toEqual({ kind: "conversion_failed" });
    expect(classifyIntakeJob({ conversion_status: "runtime_blocked" }, 1)).toEqual({ kind: "blocked" });
    expect(classifyIntakeJob({ conversion_status: "queued" }, 36)).toEqual({ kind: "timeout", status: "queued" });
    expect(classifyIntakeJob({ conversion_status: null }, 2)).toEqual({ kind: "converting", status: "queued" });
  });
});

describe("useIfcIntakeRegistration", () => {
  let container: HTMLDivElement; let root: Root;
  let latest: ReturnType<typeof useIfcIntakeRegistration> | null = null;
  function Probe({ onReady }: { onReady: (sessionId: string) => void }) { latest = useIfcIntakeRegistration(onReady); return null; }
  beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); latest = null; });
  const flush = async () => { await act(async () => { await Promise.resolve(); }); };

  it("dev routes disabled stops the local section", async () => {
    vi.spyOn(coordinatorClient, "listIfcSources").mockRejectedValue(new CoordinatorHttpError("/api/dev/ifc-sources", 404, "dev routes disabled", "dev_routes_disabled"));
    await act(async () => { root.render(<Probe onReady={() => {}} />); });
    await flush();
    expect(latest!.devRoutes).toBe("disabled");
    expect(latest!.sources).toEqual([]);
  });

  it("registers a source, polls until ready and reports the session id", async () => {
    vi.spyOn(coordinatorClient, "listIfcSources").mockResolvedValue({ items: [{ source_id: "src1", filename: "villa.ifc", relative_path: "villa.ifc", size_bytes: 10, modified_at: "2026-09-30T00:00:00.000Z" }] });
    vi.spyOn(coordinatorClient, "registerIfcSource").mockResolvedValue({ ifc_ready_job_id: "ifcready_1", download_status: "pending", conversion_status: null });
    const getJob = vi.spyOn(coordinatorClient, "getIfcReadyJob")
      .mockResolvedValueOnce({ conversion_status: "queued" } as never)
      .mockResolvedValueOnce({ conversion_status: "ready", viewer_url: "/ui/open?session=review_session_x", web_view_session_id: "review_session_x" } as never);
    const onReady = vi.fn();
    await act(async () => { root.render(<Probe onReady={onReady} />); });
    await flush();
    expect(latest!.devRoutes).toBe("enabled");
    await act(async () => { await latest!.register(latest!.sources[0]); });
    expect(latest!.progress.src1).toEqual({ kind: "converting", status: "queued" });
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await flush();
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(latest!.progress.src1).toEqual({ kind: "ready", viewerUrl: "/ui/open?session=review_session_x", sessionId: "review_session_x" });
    expect(onReady).toHaveBeenCalledWith("review_session_x");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run src/console/modelFiles/intake.test.tsx
```

Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作**

`intakeProgress.ts`：

```ts
// 本機 IFC 進件的終態判定（自 RealIfcConsolePage 的輪詢規則抽出，兩處共用避免漂移）。純函式。
export const INTAKE_POLL_MS = 5000;
export const INTAKE_MAX_ATTEMPTS = 36; // 5 s × 36 ≈ 180 s，與 #demo-control 相同

export type IntakeOutcome =
  | { kind: "converting"; status: string }
  | { kind: "ready"; viewerUrl: string; sessionId: string | null }
  | { kind: "download_failed" }
  | { kind: "conversion_failed" }
  | { kind: "blocked" }
  | { kind: "timeout"; status: string };

export interface IntakeJobView {
  viewer_url?: string | null; web_view_session_id?: string | null;
  download_status?: string | null; conversion_status?: string | null;
}

export function classifyIntakeJob(job: IntakeJobView, attempt: number, maxAttempts = INTAKE_MAX_ATTEMPTS): IntakeOutcome {
  if (job.viewer_url) return { kind: "ready", viewerUrl: job.viewer_url, sessionId: job.web_view_session_id ?? null };
  if (job.download_status === "failed") return { kind: "download_failed" };
  const status = String(job.conversion_status ?? "").toLowerCase();
  if (status === "failed") return { kind: "conversion_failed" };
  if (status.includes("block")) return { kind: "blocked" };
  if (attempt >= maxAttempts) return { kind: "timeout", status: job.conversion_status ?? "pending" };
  return { kind: "converting", status: job.conversion_status ?? "queued" };
}
```

`useIfcIntakeRegistration.ts`：

```ts
// 本機未轉檔 IFC（契約 §5.1）：載入來源、註冊、輪詢。dev routes 關閉＝整段隱藏，不重試。
import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorClient, isDevRoutesDisabled, type IfcSource } from "../coordinatorClient";
import { INTAKE_MAX_ATTEMPTS, INTAKE_POLL_MS, classifyIntakeJob, type IntakeOutcome } from "./intakeProgress";

export type IntakeProgress = IntakeOutcome | { kind: "registering" } | { kind: "error"; message: string };

export interface IfcIntakeRegistration {
  sources: IfcSource[];
  devRoutes: "unknown" | "enabled" | "disabled";
  loadError: string | null;
  progress: Record<string, IntakeProgress>;
  loadSources(): Promise<void>;
  register(source: IfcSource): Promise<void>;
}

export function useIfcIntakeRegistration(onReady?: (sessionId: string) => void): IfcIntakeRegistration {
  const [sources, setSources] = useState<IfcSource[]>([]);
  const [devRoutes, setDevRoutes] = useState<IfcIntakeRegistration["devRoutes"]>("unknown");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, IntakeProgress>>({});
  const alive = useRef(true);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => () => { alive.current = false; for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);

  const loadSources = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await coordinatorClient.listIfcSources();
      if (!alive.current) return;
      setDevRoutes("enabled");
      setSources(response.items ?? []);
    } catch (error) {
      if (!alive.current) return;
      if (isDevRoutesDisabled(error)) { setDevRoutes("disabled"); setSources([]); return; }
      setDevRoutes("enabled");
      setLoadError(String(error));
    }
  }, []);
  useEffect(() => { void loadSources(); }, [loadSources]);

  const setOne = (sourceId: string, value: IntakeProgress) => setProgress((current) => ({ ...current, [sourceId]: value }));

  const poll = useCallback((sourceId: string, jobId: string, attempt: number) => {
    const timer = setTimeout(async () => {
      timers.current.delete(sourceId);
      try {
        const job = await coordinatorClient.getIfcReadyJob(jobId);
        if (!alive.current) return;
        const outcome = classifyIntakeJob(job, attempt, INTAKE_MAX_ATTEMPTS);
        setOne(sourceId, outcome);
        if (outcome.kind === "converting") poll(sourceId, jobId, attempt + 1);
        else if (outcome.kind === "ready" && outcome.sessionId) onReadyRef.current?.(outcome.sessionId);
      } catch (error) {
        if (alive.current) setOne(sourceId, { kind: "error", message: String(error) });
      }
    }, INTAKE_POLL_MS);
    timers.current.set(sourceId, timer);
  }, []);

  const register = useCallback(async (source: IfcSource) => {
    setOne(source.source_id, { kind: "registering" });
    const modelVersionId = `mv_realifc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    try {
      const reply = await coordinatorClient.registerIfcSource(source.source_id, { project_id: "project_real_ifc_demo", model_version_id: modelVersionId });
      if (!alive.current) return;
      if (!reply.ifc_ready_job_id) { setOne(source.source_id, { kind: "error", message: reply.error_code ?? "register_rejected" }); return; }
      const first = classifyIntakeJob(reply, 1);
      setOne(source.source_id, first);
      if (first.kind === "converting") poll(source.source_id, reply.ifc_ready_job_id, 2);
      else if (first.kind === "ready" && first.sessionId) onReadyRef.current?.(first.sessionId);
    } catch (error) {
      if (!alive.current) return;
      if (isDevRoutesDisabled(error)) { setDevRoutes("disabled"); setSources([]); setProgress({}); return; }
      setOne(source.source_id, { kind: "error", message: String(error) });
    }
  }, [poll]);

  return { sources, devRoutes, loadError, progress, loadSources, register };
}
```

`RealIfcConsolePage.tsx`：`startPoll`（:121）tick 內 :136-142 的 `const cs = …` 與 if 鏈改為（`j`、`n`、`enrich`、`pollGeneration`、`pollGenerationRef`、`stop`、`setRuntime` 沿用既有名稱）：

```ts
        const outcome = classifyIntakeJob(j, n);
        if (outcome.kind === "ready") { setRuntime("runtime: ready"); await enrich(j, pollGeneration); if (pollGeneration === pollGenerationRef.current) stop(); }
        else if (outcome.kind === "download_failed") { setRuntime("runtime: download_failed"); stop(); }
        else if (outcome.kind === "conversion_failed") { setRuntime("runtime: conversion_failed"); stop(); }
        else if (outcome.kind === "blocked") { setRuntime("runtime: runtime_blocked"); stop(); }
        else if (outcome.kind === "timeout") { setRuntime("runtime: conversion_timeout (still " + outcome.status + " after ~180s)"); stop(); }
        else { setRuntime("runtime: converting (" + outcome.status + ")"); }
```

並 import `classifyIntakeJob`。頁面最上方（`return (` 後第一個容器內）加 `<p className="ec-note" data-testid="demo-control-tool-note">{t("操作工具：正式流程請用 3D 工作區的「模型檔案」清單（#a1）。", "Operator tool: the product flow is the Model files list in the 3D workspace (#a1).")}</p>`。

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run src/console/modelFiles/intake.test.tsx src/console/RealIfcConsolePage.test.tsx
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/console/modelFiles/intakeProgress.ts src/console/modelFiles/useIfcIntakeRegistration.ts src/console/modelFiles/intake.test.tsx src/console/RealIfcConsolePage.tsx
git diff --cached --check; git commit -m "feat(console): local IFC intake registration hook with shared terminal-state rules" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `useReadyReviewRequest` 與 `ModelFileList`，取代 A1 面板的兩個下拉

**Files:**
- Create: `web-viewer-sample/src/console/modelFiles/useReadyReviewRequest.ts`
- Create: `web-viewer-sample/src/console/modelFiles/ModelFileList.tsx`
- Create: `web-viewer-sample/src/console/modelFiles/ModelFileList.test.tsx`
- Delete: `web-viewer-sample/src/console/ReadyReviewSessions.tsx`、`ReadyReviewSessions.test.tsx`
- Modify: `A1GovernanceWorkbenchPage.tsx`（import 與 Panel 內元件、進階區連結）、`unified/operator-workflow.css:27-28`、`A1ViewerEmbed.test.tsx`（三處；`A1Delivery.test.tsx` 經查無 `ready-review` 引用，不動）

**Interfaces:**
- Consumes: Task 2、3、4 的匯出。
- Produces: `ModelFileList` props 與 `ReadyReviewSessions` 相同：`{ sessions, onSelected, onSessionsRefreshed, onModelsReloaded?, currentSessionId? }`；test id 見 Global Constraints，另有 `model-file-refresh`、`model-file-empty`、`model-file-error`、`model-file-local-section`、`model-file-local-disabled`、`model-file-session-<key>`（同鍵多筆進行中審查時的選單）、`model-file-pending`、`model-file-retry`、`model-file-stop`、`model-file-confirm-stop`、`model-file-stopped`、`model-file-result`、`model-file-current`、`model-file-convert-status-<source_id>`、`model-file-remove-error`。

- [ ] **Step 1: 寫失敗測試**

`ModelFileList.test.tsx`：

```tsx
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fx } from "../__testdata__/contractFixtures";
import { CoordinatorHttpError, coordinatorClient, type ConversionRecord, type RuntimeSessionSummary, type RuntimeStatus } from "../coordinatorClient";
import { ModelFileList } from "./ModelFileList";

const MW = "mw_0123456789abcdef";
const SESSION_ID = "review_session_existing";
const session: RuntimeSessionSummary = fx.runtimeSessionSummary({ ready_model_id: MW, session_id: SESSION_ID, status: "created", project_id: "project-a", model_version_id: "v1", created_at: "2026-09-20T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z" });
const minioRecord: ConversionRecord = fx.conversionRecord({
  idempotency_key: MW, project_id: "project-a", project_display_name: "Project A", category: "architecture", external_model_version_id: "v1",
  status: "ready", source_ifc_filename: "model.ifc",
  sessions: [{ session_id: SESSION_ID, status: "created", created_at: "2026-09-20T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z", link: "ready_model" }],
});
const devRecord: ConversionRecord = fx.conversionRecord({
  idempotency_key: "idem_devreg_1", project_id: "project_real_ifc_demo", project_display_name: "project_real_ifc_demo", category: "", external_model_version_id: "mv_realifc_1",
  status: "ready", source_ifc_filename: "villa.ifc", sessions: [],
});
const response = { ready_model_id: MW, review_session_id: SESSION_ID, session_status: "created" as const, session_replay: false };

function Harness({ onSelected, currentSessionId }: { onSelected: (s: RuntimeSessionSummary) => void; currentSessionId?: string }) {
  const [sessions, setSessions] = useState([session]);
  return <ModelFileList sessions={sessions} onSessionsRefreshed={setSessions} onSelected={onSelected} currentSessionId={currentSessionId} />;
}

describe("ModelFileList", () => {
  let container: HTMLDivElement; let root: Root;
  const selected = vi.fn();
  const q = <T extends Element>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`);
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear(); selected.mockReset();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 2, items: [minioRecord, devRecord] });
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [session] } } as RuntimeStatus);
    vi.spyOn(coordinatorClient, "listIfcSources").mockResolvedValue({ items: [
      { source_id: "src_villa", filename: "villa.ifc", relative_path: "villa.ifc", size_bytes: 1, modified_at: "" },
      { source_id: "src_new", filename: "new.ifc", relative_path: "new.ifc", size_bytes: 1, modified_at: "" },
    ] });
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); sessionStorage.clear(); vi.restoreAllMocks(); });
  const render = async (currentSessionId?: string) => { await act(async () => { root.render(<Harness onSelected={selected} currentSessionId={currentSessionId} />); }); await act(async () => { await Promise.resolve(); }); };
  const click = async (id: string) => { await act(async () => { q<HTMLButtonElement>(id)!.click(); }); };

  it("renders rows with the display-name rule and a local section for unregistered sources only", async () => {
    await render();
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("Project A · architecture · 版本 v1");
    expect(q(`model-file-row-${MW}`)?.textContent).toContain("model.ifc");
    expect(q("model-file-row-idem_devreg_1")?.textContent).toContain("villa.ifc");
    expect(q("model-file-convert-src_new")).not.toBeNull();
    expect(q("model-file-convert-src_villa")).toBeNull();
    expect(q(`model-file-create-${MW}`)?.hasAttribute("disabled")).toBe(false);
    expect(q("model-file-create-idem_devreg_1")?.hasAttribute("disabled")).toBe(true);
  });

  it("open existing calls onSelected only after the coordinator confirms", async () => {
    const open = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(response);
    await render();
    await click(`model-file-open-${MW}`);
    expect(open).toHaveBeenCalledWith(MW, { mode: "open_existing", session_id: SESSION_ID });
    expect(selected).toHaveBeenCalledWith(session);
  });

  it("opens a non-minio record's active session without calling the ready-review endpoint", async () => {
    const open = vi.spyOn(coordinatorClient, "readyReviewSession");
    vi.mocked(coordinatorClient.getConversionRecords).mockResolvedValue({ count: 1, items: [{ ...devRecord, sessions: [{ session_id: SESSION_ID, status: "created", created_at: "", updated_at: "", link: "intake_job" }] }] });
    await render();
    await click("model-file-open-idem_devreg_1");
    expect(open).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledWith(session);
  });

  it("creates a new review with a persisted request and keeps the pending flow", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(response);
    await render();
    await click(`model-file-create-${MW}`);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1]).toMatchObject({ mode: "create_new" });
    expect(sessionStorage.getItem("ai-bim.ready-review-request.v1")).toBeNull();
    expect(q("model-file-result")?.textContent).toContain(SESSION_ID);
  });

  it("shows the persisted pending request after a reload and retries it", async () => {
    sessionStorage.setItem("ai-bim.ready-review-request.v1", JSON.stringify({ readyModelId: MW, requestId: "review-abc" }));
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue({ ...response, session_replay: true });
    await render();
    expect(q("model-file-pending")).not.toBeNull();
    await click("model-file-retry");
    expect(submit).toHaveBeenCalledWith(MW, { mode: "create_new", request_id: "review-abc" });
    expect(q("model-file-pending")).toBeNull();
  });

  it("removes a record after confirmation and shows the server's 409 reason otherwise", async () => {
    const remove = vi.spyOn(coordinatorClient, "removeConversionRecord")
      .mockRejectedValueOnce(new CoordinatorHttpError("/api/conversion/records/idem_devreg_1", 409, "record_in_flight", "record_in_flight", { error_code: "record_in_flight", intake_status: "dispatched" }))
      .mockResolvedValueOnce({ idempotency_key: "idem_devreg_1", status: "removed", removed_at: "2026-09-30T00:00:00.000Z", intake_jobs_removed: 1 });
    await render();
    expect(q(`model-file-remove-${MW}`)?.hasAttribute("disabled")).toBe(true); // 進行中 session 佔用
    await click("model-file-remove-idem_devreg_1");
    await click("intent-confirm");
    expect(q("model-file-remove-error")?.textContent).toContain("record_in_flight");
    expect(q("model-file-remove-error")?.textContent).toContain("dispatched");
    await click("intent-confirm");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(coordinatorClient.getConversionRecords).toHaveBeenCalledTimes(2); // 成功後重載
  });

  it("hides the local section when dev routes are disabled", async () => {
    vi.mocked(coordinatorClient.listIfcSources).mockRejectedValue(new CoordinatorHttpError("/api/dev/ifc-sources", 404, "dev routes disabled", "dev_routes_disabled"));
    await render();
    expect(q("model-file-local-section")).toBeNull();
    expect(q("model-file-local-disabled")).not.toBeNull();
  });

  it("marks the row of the current session", async () => {
    await render(SESSION_ID);
    expect(q(`model-file-row-${MW}`)?.getAttribute("data-current")).toBe("true");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run src/console/modelFiles/ModelFileList.test.tsx
```

Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 `useReadyReviewRequest.ts`**（邏輯自 `ReadyReviewSessions.tsx:8-16、90-136、213-229` 逐字移入，只改成 hook 形狀）

```ts
// ready-review 建立／開啟／重試／停止流程（自 ReadyReviewSessions 移入；sessionStorage key 不變，既有 pending 可續用）。
import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorClient, type ReadyReviewSessionResponse, type RuntimeSessionSummary } from "../coordinatorClient";
import { t } from "../i18n";

export const PENDING_KEY = "ai-bim.ready-review-request.v1";
export type PendingCreate = { readyModelId: string; requestId: string };
export function readPending(): PendingCreate | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as PendingCreate | null;
    return value && /^mw_[a-f0-9]{16}$/.test(value.readyModelId) && /^[A-Za-z0-9._:-]{1,128}$/.test(value.requestId) ? value : null;
  } catch { return null; }
}

export interface ReadyReviewRequest {
  pending: PendingCreate | null; busy: boolean; error: string | null; result: ReadyReviewSessionResponse | null;
  confirmStop: boolean; stoppedRequest: PendingCreate | null;
  create(readyModelId: string): void;
  openExisting(readyModelId: string, sessionId: string): Promise<void>;
  retry(): void; requestStop(): void; cancelStop(): void; confirmStopTracking(): void; clearFeedback(): void;
}

export function useReadyReviewRequest(onSelected: (session: RuntimeSessionSummary) => void): ReadyReviewRequest {
  const [pending, setPending] = useState<PendingCreate | null>(readPending);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stoppedRequest, setStoppedRequest] = useState<PendingCreate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadyReviewSessionResponse | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const onSelectedRef = useRef(onSelected);
  onSelectedRef.current = onSelected;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const submit = useCallback(async (target: PendingCreate | { readyModelId: string; sessionId: string }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await coordinatorClient.readyReviewSession(target.readyModelId,
        "requestId" in target ? { mode: "create_new", request_id: target.requestId } : { mode: "open_existing", session_id: target.sessionId });
      if (response.session_status === "created" || response.session_status === "active") {
        const runtime = await coordinatorClient.runtimeStatus();
        const selected = runtime.sessions.items.find((session) => session.session_id === response.review_session_id);
        if (!selected || !["created", "active"].includes(selected.status)) {
          throw new Error(t("審查狀態已變更，請重試以重新確認。", "The review state changed. Retry to verify it."));
        }
        if (!alive.current) return;
        onSelectedRef.current(selected);
      }
      if (!alive.current) return;
      if ("requestId" in target) { sessionStorage.removeItem(PENDING_KEY); setPending(null); }
      setResult(response);
    } catch (failure) {
      if (alive.current) setError(String(failure));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const create = useCallback((readyModelId: string) => {
    if (pending || inFlight.current) return;
    try {
      const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const next = { readyModelId, requestId: "review-" + randomPart };
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(next)); // 先持久化再送：回應遺失或重載後可重試
      setPending(next);
      void submit(next);
    } catch {
      setError(t("無法保存建立請求；請允許此頁使用瀏覽器儲存空間後重試。", "The request could not be saved. Allow browser storage and retry."));
    }
  }, [pending, submit]);

  return {
    pending, busy, error, result, confirmStop, stoppedRequest,
    create,
    openExisting: (readyModelId, sessionId) => submit({ readyModelId, sessionId }),
    retry: () => { if (pending) void submit(pending); },
    requestStop: () => setConfirmStop(true),
    cancelStop: () => setConfirmStop(false),
    confirmStopTracking: () => {
      try { sessionStorage.removeItem(PENDING_KEY); setStoppedRequest(pending); setPending(null); setConfirmStop(false); setError(null); }
      catch { setError(t("無法移除待確認請求；請保留原請求重試。", "Cannot clear the pending request. Keep the original request and retry.")); }
    },
    clearFeedback: () => { setResult(null); setError(null); },
  };
}
```

- [ ] **Step 4: 實作 `ModelFileList.tsx`**

```tsx
// 3D 工作區「模型檔案」清單（契約 §5.1）：以檔案為中心，一列一個 IFC；動作依狀態出現，缺條件停用並說明。
import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, ProvTag } from "../components";
import { coordinatorClient, lifecycleConflict, type ConversionRecord, type RuntimeSessionSummary } from "../coordinatorClient";
import { t } from "../i18n";
import { IntentDialog } from "../IntentDialog";
import { lifecycleLabel } from "../modelData/conversionShared";
import { SessionIdentity } from "../SessionIdentityCard";
import { activeSessions, closedSessionCount, isMinioKey, modelFileLabel, preferredOpenTarget, removalState, unregisteredSources } from "./modelFileView";
import { useIfcIntakeRegistration, type IntakeProgress } from "./useIfcIntakeRegistration";
import { useReadyReviewRequest } from "./useReadyReviewRequest";

function progressText(progress: IntakeProgress | undefined): string {
  if (!progress) return "";
  switch (progress.kind) {
    case "registering": return t("註冊中…", "Registering…");
    case "converting": return t(`轉檔中（${progress.status}）`, `Converting (${progress.status})`);
    case "ready": return t("轉檔完成，審查已建立", "Converted; review created");
    case "download_failed": return t("下載失敗", "Download failed");
    case "conversion_failed": return t("轉檔失敗", "Conversion failed");
    case "blocked": return t("runtime 受阻", "Runtime blocked");
    case "timeout": return t(`逾時（仍為 ${progress.status}）`, `Timed out (still ${progress.status})`);
    case "error": return t(`錯誤：${progress.message}`, `Error: ${progress.message}`);
  }
}

export function ModelFileList({ sessions, onSelected, onSessionsRefreshed, onModelsReloaded, currentSessionId = "" }: {
  sessions: RuntimeSessionSummary[];
  onSelected: (session: RuntimeSessionSummary) => void;
  onSessionsRefreshed: (sessions: RuntimeSessionSummary[]) => void;
  onModelsReloaded?: () => void;
  currentSessionId?: string;
}) {
  const [records, setRecords] = useState<ConversionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosenSession, setChosenSession] = useState<Record<string, string>>({});
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [response, runtime] = await Promise.all([coordinatorClient.getConversionRecords(100), coordinatorClient.runtimeStatus()]);
      if (!alive.current) return;
      setRecords(response.items);
      onSessionsRefreshed(runtime.sessions.items.filter((session) => session.status === "created" || session.status === "active"));
    } catch (failure) {
      if (alive.current) setLoadError(String(failure));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [onSessionsRefreshed]);
  useEffect(() => { void load(); }, [load]);

  const review = useReadyReviewRequest(onSelected);
  const intake = useIfcIntakeRegistration(() => { void load(); });

  // 目前審查換了才對齊一次並捲到該列；之後使用者自行瀏覽不被輪詢拉回。
  const reflected = useRef("");
  useEffect(() => {
    if (!currentSessionId || reflected.current === currentSessionId) return;
    const row = document.querySelector<HTMLElement>(`[data-testid="model-file-list"] [data-current="true"]`);
    if (row) { reflected.current = currentSessionId; row.scrollIntoView?.({ block: "nearest" }); }
  }, [currentSessionId, records]);

  const openRow = async (record: ConversionRecord) => {
    setOpenError(null);
    const target = chosenSession[record.idempotency_key] ?? preferredOpenTarget(record)?.session_id;
    if (!target) return;
    if (isMinioKey(record.idempotency_key)) { await review.openExisting(record.idempotency_key, target); return; }
    // 非 MinIO 紀錄沒有 ready-model 身分：直接選取既有進行中審查（不偽造 mw_ id）。
    const summary = sessions.find((session) => session.session_id === target);
    if (!summary) { setOpenError(t("該審查目前不在進行中清單，請重新整理。", "That review is not in the active list; refresh and retry.")); return; }
    onSelected(summary);
  };

  const confirmRemove = async () => {
    if (!removeKey || removeBusy) return;
    setRemoveBusy(true); setRemoveError(null);
    try {
      await coordinatorClient.removeConversionRecord(removeKey);
      if (!alive.current) return;
      setRemoveKey(null);
      await load();
    } catch (failure) {
      if (!alive.current) return;
      const conflict = lifecycleConflict(failure);
      setRemoveError(conflict
        ? `${conflict.code}${conflict.intakeStatus ? ` · intake ${conflict.intakeStatus}` : ""}${conflict.sessions?.length ? ` · ${conflict.sessions.join("、")}` : ""}`
        : String(failure));
    } finally {
      if (alive.current) setRemoveBusy(false);
    }
  };

  const localSources = unregisteredSources(intake.sources, records);
  const current = currentSessionId ? sessions.find((session) => session.session_id === currentSessionId) ?? null : null;

  return <section data-testid="model-file-list" aria-label={t("模型檔案", "Model files")}>
    <p className="ec-note">{t("每列是一個 IFC 檔。開啟審查後再按左側「啟動 A1 3D Session」；這裡的選取不代表 3D 畫面已切換。", "Each row is one IFC file. Open a review, then press Start A1 3D Session on the left; selecting here does not switch the 3D view.")}</p>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Btn data-testid="model-file-refresh" disabled={loading || review.busy} onClick={() => { void load(); void intake.loadSources(); onModelsReloaded?.(); }}>{t("重新整理", "Refresh")}</Btn>
      {loading && <span role="status">{t("讀取模型檔案…", "Loading model files…")}</span>}
    </div>
    {loadError && <p role="alert" data-testid="model-file-error">{loadError}</p>}
    {!loading && !loadError && records.length === 0 && localSources.length === 0 && (
      <p data-testid="model-file-empty">{t("尚無可審查模型；請先完成轉檔。", "No models are ready for review. Complete conversion first.")} <a href="#pipeline">{t("前往轉檔", "Open pipeline")}</a></p>
    )}

    {intake.devRoutes === "disabled" && (
      <p className="ec-note" data-testid="model-file-local-disabled"><ProvTag prov="p1" /> {t("本機 IFC 轉檔入口已關閉（ENABLE_DEV_ROUTES=false）；MinIO 進件不受影響。", "Local IFC conversion is disabled (ENABLE_DEV_ROUTES=false); MinIO intake is unaffected.")}</p>
    )}
    {intake.devRoutes === "enabled" && localSources.length > 0 && (
      <div data-testid="model-file-local-section" style={{ marginTop: 8 }}>
        <strong>{t("本機未轉檔 IFC", "Local IFC files not converted yet")}</strong>
        <table className="ec-table"><tbody>{localSources.map((source) => {
          const progress = intake.progress[source.source_id];
          const running = progress?.kind === "registering" || progress?.kind === "converting";
          return <tr key={source.source_id} data-testid={`model-file-local-${source.source_id}`}>
            <td>{source.filename}</td>
            <td><span className="ec-note" data-testid={`model-file-convert-status-${source.source_id}`}>{progressText(progress)}</span></td>
            <td><Btn data-testid={`model-file-convert-${source.source_id}`} disabled={running} caption="POST /api/dev/ifc-sources/{id}/register" onClick={() => { void intake.register(source); }}>{t("轉檔", "Convert")}</Btn></td>
          </tr>;
        })}</tbody></table>
      </div>
    )}
    {intake.loadError && <p className="ec-warn-note">{t("本機 IFC 清單載入失敗：", "Local IFC list failed: ")}{intake.loadError}</p>}

    {records.length > 0 && (
      <table className="ec-table" style={{ marginTop: 8 }}>
        <thead><tr><th>{t("檔案", "File")}</th><th>{t("轉檔", "Conversion")}</th><th>{t("審查", "Reviews")}</th><th>{t("動作", "Actions")}</th></tr></thead>
        <tbody>{records.map((record) => {
          const key = record.idempotency_key;
          const label = modelFileLabel(record);
          const active = activeSessions(record);
          const isCurrent = Boolean(currentSessionId) && record.sessions.some((session) => session.session_id === currentSessionId);
          const minio = isMinioKey(key);
          const ready = record.status === "ready";
          const removal = removalState(record);
          const openTarget = chosenSession[key] ?? preferredOpenTarget(record)?.session_id ?? "";
          return <tr key={key} data-testid={`model-file-row-${key}`} data-current={isCurrent ? "true" : undefined}>
            <td><div style={{ fontWeight: 600 }}>{label.title}</div><div className="ec-note">{label.subtitle}</div></td>
            <td><span className="ec-prov ec-artifact">{lifecycleLabel(record.status)}</span></td>
            <td>
              <div className="ec-note">{t(`進行中 ${active.length} · 已關閉 ${closedSessionCount(record)}`, `active ${active.length} · closed ${closedSessionCount(record)}`)}</div>
              {active.length > 1 && <select data-testid={`model-file-session-${key}`} value={openTarget} onChange={(event) => setChosenSession((cur) => ({ ...cur, [key]: event.target.value }))}>
                {active.map((session) => <option key={session.session_id} value={session.session_id}>{session.session_id}（{session.status}）</option>)}
              </select>}
            </td>
            <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Btn primary data-testid={`model-file-open-${key}`} disabled={!ready || active.length === 0 || review.busy || loading}
                caption={active.length === 0 ? t("此檔尚無進行中審查", "No active review for this file") : undefined}
                onClick={() => { void openRow(record); }}>{t("開啟審查", "Open review")}</Btn>
              <Btn data-testid={`model-file-create-${key}`} disabled={!minio || !ready || review.busy || loading || Boolean(review.pending)}
                caption={!minio ? t("僅 MinIO 進件可建立新審查；本機 IFC 請重新轉檔", "Only MinIO intake can create a new review; reconvert local IFC files") : !ready ? t("轉檔尚未完成", "Conversion not finished") : undefined}
                onClick={() => review.create(key)}>{t("建立新的審查", "Create a new review")}</Btn>
              <Btn data-testid={`model-file-remove-${key}`} disabled={!removal.allowed || loading} caption={removal.allowed ? "DELETE /api/conversion/records/{key}" : removal.reason}
                onClick={() => { setRemoveError(null); setRemoveKey(key); }}>{t("移除", "Remove")}</Btn>
            </td>
          </tr>;
        })}</tbody>
      </table>
    )}

    {current && <p className="ec-note" data-testid="model-file-current">{t("目前審查：", "Current review: ")}<SessionIdentity session={current} compact /></p>}
    {openError && <p role="alert">{openError}</p>}
    {review.pending && <div className="ec-note" data-testid="model-file-pending">
      {t("上次建立請求尚待確認；重試會取回同一筆審查。", "The previous creation is awaiting confirmation. Retrying retrieves the same review.")}
      <Btn data-testid="model-file-retry" disabled={review.busy} onClick={review.retry}>{t("重試建立請求", "Retry creation")}</Btn>
      <Btn data-testid="model-file-stop" disabled={review.busy} onClick={review.requestStop}>{t("停止追蹤此請求", "Stop tracking this request")}</Btn>
      {review.confirmStop && <div role="group" aria-label={t("確認停止追蹤", "Confirm stopping tracking")}>
        <p>{t("前次請求可能已建立審查。停止追蹤不會刪除它；請先查看既有審查，再決定是否另建。", "The previous request may have created a review. Stopping tracking does not delete it. Check existing reviews before creating another.")}</p>
        <p>{review.pending.readyModelId} / {review.pending.requestId}</p>
        <Btn disabled={review.busy} onClick={review.cancelStop}>{t("繼續追蹤", "Keep tracking")}</Btn>
        <Btn data-testid="model-file-confirm-stop" disabled={review.busy} onClick={review.confirmStopTracking}>{t("確認停止追蹤", "Confirm stopping tracking")}</Btn>
      </div>}
    </div>}
    {review.stoppedRequest && <p className="ec-note" data-testid="model-file-stopped">{t("已停止追蹤，前次結果仍未確認：", "Tracking stopped; the previous result is still unconfirmed: ")}{review.stoppedRequest.readyModelId} / {review.stoppedRequest.requestId}</p>}
    {review.busy && <p role="status">{t("正在確認審查…", "Confirming review…")}</p>}
    {review.error && <p role="alert" data-testid="model-file-error">{review.error}</p>}
    {review.result && <p role="status" data-testid="model-file-result">
      {["created", "active"].includes(review.result.session_status) ? t("審查已選取：", "Review selected: ") : t("此請求對應的審查已結束，請從封存清單重建：", "This request belongs to a closed review. Recreate it from the archive: ")}
      <strong>{review.result.review_session_id}</strong>
    </p>}

    <IntentDialog open={removeKey !== null} showReason={false} busy={removeBusy} actionErr={removeError}
      title={t("移除轉檔紀錄", "Remove conversion record")}
      cost={t("紀錄會變成墓碑並隱藏；同鍵的進件工作一併刪除；同鍵再送進件會被拒絕。streaming 的轉檔 artifact 不在此清理範圍。", "The record becomes a hidden tombstone; its intake jobs are deleted; re-sent intake with the same key is refused. Streaming artifacts are not cleaned here.")}
      onConfirm={confirmRemove} onCancel={() => { setRemoveKey(null); setRemoveError(null); }} />
    {removeError && removeKey === null && <p role="alert" data-testid="model-file-remove-error">{removeError}</p>}
    {removeError && removeKey !== null && <span data-testid="model-file-remove-error" hidden>{removeError}</span>}
  </section>;
}
```

`model-file-error` 同時給載入錯誤與建立錯誤（兩者不會同時出現：載入失敗時沒有列可操作）。`IntentDialog` 內已顯示 `actionErr`，隱藏的 `model-file-remove-error` 只供測試讀取訊息。

- [ ] **Step 5: 替換 A1 面板、CSS、刪舊元件、改測試**

`A1GovernanceWorkbenchPage.tsx`：`import { ReadyReviewSessions } from "./ReadyReviewSessions";` 改為 `import { ModelFileList } from "./modelFiles/ModelFileList";`；Panel 內 `<ReadyReviewSessions …/>` 改為 `<ModelFileList …/>`（props 原樣）；Panel 的 `sub` 改為 `t("選檔 → 開啟審查（同檔多筆時可選）→ 左側「啟動 A1 3D Session」。本機 IFC 可直接在清單轉檔。", "Choose a file → open its review → Start A1 3D Session on the left. Local IFC files can be converted from the list.")`；進階 `<details data-testid="a1-review-advanced">` 的 `<summary>` 之後加：

```tsx
          <p className="ec-note"><a data-testid="a1-demo-control-link" href="#demo-control">{t("操作工具：真實 IFC 進件頁（#demo-control）→", "Operator tool: real IFC intake page (#demo-control) →")}</a></p>
```

`unified/operator-workflow.css:27-28` 的 `[data-testid="ready-review-sessions"]` 改為 `[data-testid="model-file-list"]`，並在其後加一條 `tr[data-current="true"]` 的強調列規則（沿用該檔既有 selector 前綴與已有的強調色變數；不新增變數）。刪除 `ReadyReviewSessions.tsx` 與 `ReadyReviewSessions.test.tsx`。

`A1ViewerEmbed.test.tsx`：三處改法：
- :336-347 的 for 迴圈與 `ready-review-open` 點擊改為：先不做任何選取（瀏覽列不切換 viewer 的斷言保留：渲染後 `expect(slot!.activeSessionId).toBe(previousSession)`），再 `await act(async () => q<HTMLButtonElement>(\`model-file-open-${readyModelId}\`)!.click())`；
- :466-471 `openReadyReview` 改為只點 `model-file-open-${MINIO_IDEMPOTENCY_KEY}`；
- :532 `ready-review-refresh` 改為 `model-file-refresh`。
測試 :317-321 與 :455-459 的 `getConversionRecords` mock 紀錄需補 `sessions: [{ session_id: <該測試的 review session id>, status: "active", created_at: "", updated_at: "", link: "ready_model" }]`，否則開啟鈕停用。

- [ ] **Step 6: 跑測試確認通過**

```powershell
npx vitest run src/console/modelFiles src/console/A1ViewerEmbed.test.tsx src/console/A1GovernanceWorkbenchPage.devRoutes.test.tsx src/console/unified; npx tsc --noEmit
```

Expected: PASS；`grep -rn "ready-review" src` 只剩 `generated/coordinator-api.ts` 與 `useReadyReviewRequest.ts` 的 sessionStorage key。

- [ ] **Step 7: Commit**

```powershell
git add -A src/console/modelFiles src/console/A1GovernanceWorkbenchPage.tsx src/console/unified/operator-workflow.css src/console/A1ViewerEmbed.test.tsx
git rm -q src/console/ReadyReviewSessions.tsx src/console/ReadyReviewSessions.test.tsx
git diff --cached --check; git commit -m "feat(console): model file list replaces the review dropdowns in the 3D workspace" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: session 身分檔名優先；已封存列的檔名欄與移除

**Files:**
- Modify: `sessionIdentity.ts`（新增 `sessionPrimaryLabel`、`sessionSecondaryLabel`；`sessionOptionLabel` 不動，`A4SemanticSearchPage` 仍用它）、`SessionIdentityCard.tsx`、`ClosedSessionRecovery.tsx`
- Modify tests: `sessionIdentity.test.ts`、`SessionIdentityCard.test.tsx`、`ClosedSessionRecovery.test.tsx`

- [ ] **Step 1: 寫失敗測試（追加到三個既有測試檔）**

`sessionIdentity.test.ts` 追加（import 加入 `sessionPrimaryLabel, sessionSecondaryLabel`）：

```ts
describe("filename-first labels (contract §5.2, owner 2026-09-30)", () => {
  it("minio sessions keep project · category · version and put the filename second", () => {
    // 檔內既有 helper：origin() 預設 kind auto_conversion_ready／intake_source minio_watch／專案·種類·model.ifc；s() 包 fx.runtimeSessionSummary。
    const minio = s({ ready_model_id: "mw_0123456789abcdef", project_id: "p", model_version_id: "v1", origin: origin({ project_display_name: "專案A", category: "建築" }) });
    expect(sessionPrimaryLabel(minio)).toBe("專案A · 建築 · 版本 v1");
    expect(sessionSecondaryLabel(minio)).toBe("model.ifc");
  });
  it("other sessions lead with the filename and never invent one", () => {
    const named = s({ ready_model_id: null, origin: origin({ kind: "api_explicit", intake_source: null, source_ifc_filename: "villa.ifc" }) });
    expect(sessionPrimaryLabel(named)).toBe("villa.ifc");
    const unknown = s({ ready_model_id: null, origin: origin({ kind: "api_explicit", intake_source: null, source_ifc_filename: null }) });
    expect(sessionPrimaryLabel(unknown)).toBe("來源未知");
    expect(sessionSecondaryLabel(named)).toBe(sessionTitle(named));
  });
});
```

`ClosedSessionRecovery.test.tsx` 追加（沿用檔內 `ready` 物件、inline `act` 與 `flush()`；import 加 `CoordinatorHttpError` 自 `./coordinatorClient`）：

```ts
  const clickTestId = async (id: string) => {
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid='${id}']`)!.click(); });
    await flush();
  };

  it("shows the filename column and purges a closed session after confirmation", async () => {
    const list = vi.spyOn(coordinatorClient, "listClosedReviewSessions").mockResolvedValue({ items: [{ ...ready, source_ifc_filename: "villa.ifc" }], next_cursor: null });
    const purge = vi.spyOn(coordinatorClient, "purgeReviewSession").mockResolvedValue({ session_id: ready.session_id, status: "purged", purged_at: "2026-09-30T00:00:00.000Z", removed: { session_file: true, events_file: true } });
    await act(async () => { root.render(<ClosedSessionRecovery />); });
    await flush();
    expect(container.querySelector(`[data-testid='closed-session-file-${ready.session_id}']`)?.textContent).toBe("villa.ifc");
    await clickTestId(`session-purge-${ready.session_id}`);
    await clickTestId("intent-confirm");
    expect(purge).toHaveBeenCalledWith(ready.session_id, "manual");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("shows has_descendants sessions verbatim and keeps the dialog open", async () => {
    vi.spyOn(coordinatorClient, "listClosedReviewSessions").mockResolvedValue({ items: [ready], next_cursor: null });
    vi.spyOn(coordinatorClient, "purgeReviewSession").mockRejectedValue(new CoordinatorHttpError("/api/review-sessions/x", 409, "review_session_has_descendants", "review_session_has_descendants", { error_code: "review_session_has_descendants", sessions: ["review_session_child"] }));
    await act(async () => { root.render(<ClosedSessionRecovery />); });
    await flush();
    await clickTestId(`session-purge-${ready.session_id}`);
    await clickTestId("intent-confirm");
    expect(container.querySelector("[data-testid='intent-action-error']")?.textContent).toContain("review_session_child");
    expect(container.querySelector("[data-testid='intent-dialog']")).not.toBeNull();
  });
````SessionIdentityCard.test.tsx` 追加一例：MinIO 來源 session 的 `session-identity-title` 為專案·種類·版本、`session-identity-subtitle` 為檔名；非 MinIO 來源 title 為檔名。

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run src/console/sessionIdentity.test.ts src/console/SessionIdentityCard.test.tsx src/console/ClosedSessionRecovery.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 實作**

`sessionIdentity.ts` 在 `sessionOriginLabel` 之前加：

```ts
type PrimarySource = Pick<RuntimeSessionSummary, "project_id" | "model_version_id"> & { ready_model_id?: string | null; origin?: OriginMaybe };
function isMinioSession(s: PrimarySource): boolean { return isMinioKey(s.ready_model_id) || originOf(s)?.intake_source === "minio_watch"; }
/** §5.2（owner 2026-09-30）：MinIO 來源用專案·種類·版本；其他來源檔名優先，查無檔名顯「來源未知」。 */
export function sessionPrimaryLabel(s: PrimarySource): string {
  if (isMinioSession(s)) return sessionTitle(s);
  return originOf(s)?.source_ifc_filename || t("來源未知", "source unknown");
}
export function sessionSecondaryLabel(s: PrimarySource): string {
  if (isMinioSession(s)) return originOf(s)?.source_ifc_filename || "";
  return sessionTitle(s);
}
```

`SessionIdentityCard.tsx`：title 改用 `sessionPrimaryLabel(session)`；在 title 之後加 `{sessionSecondaryLabel(session) && <span data-testid="session-identity-subtitle" className="ec-note">{sessionSecondaryLabel(session)}</span>}`。

`ClosedSessionRecovery.tsx`（`lifecycleConflict` 與 `IntentDialog` 分別自 `./coordinatorClient`、`./IntentDialog` import）：
- 表頭在 `session` 之後加 `<th>{t("檔案", "file")}</th>`，每列在 session id 之後加 `<td data-testid={`closed-session-file-${item.session_id}`}>{item.source_ifc_filename ?? t("來源未知", "source unknown")}</td>`。
- 動作欄在重建鈕之後加 `<Btn data-testid={`session-purge-${item.session_id}`} caption="DELETE /api/review-sessions/{id}" onClick={() => { setPurgeErr(null); setPurgeTarget(item.session_id); }}>{t("移除", "Remove")}</Btn>`。
- 新 state：`purgeTarget: string | null`、`purgeBusy`、`purgeErr`；`confirmPurge`：

```ts
  const confirmPurge = async () => {
    if (!purgeTarget || purgeBusy) return;
    setPurgeBusy(true); setPurgeErr(null);
    try {
      await coordinatorClient.purgeReviewSession(purgeTarget, "manual");
      if (!aliveRef.current) return;
      setPurgeTarget(null);
      await load();
    } catch (error) {
      if (!aliveRef.current) return;
      const conflict = lifecycleConflict(error);
      setPurgeErr(conflict ? `${conflict.code}${conflict.sessions?.length ? `：${conflict.sessions.join("、")}` : ""}${conflict.status ? `（${conflict.status}）` : ""}` : String(error));
    } finally {
      if (aliveRef.current) setPurgeBusy(false);
    }
  };
```

- 渲染 `<IntentDialog open={purgeTarget !== null} showReason={false} busy={purgeBusy} actionErr={purgeErr} title={t("移除已封存 Session", "Remove archived Session")} cost={t("刪除 coordinator 本地的 session 檔與事件檔並留下退役標記；此 id 永不重建。issue 證據保留但無法再開啟該 session。", "Deletes the coordinator-local session and event files and leaves a retired marker; the id is never recreated. Issue evidence stays but the session can no longer be opened.")} onConfirm={confirmPurge} onCancel={() => { setPurgeTarget(null); setPurgeErr(null); }} />`。

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run src/console/sessionIdentity.test.ts src/console/SessionIdentityCard.test.tsx src/console/ClosedSessionRecovery.test.tsx src/console/SessionCrossLinks.test.tsx src/console/A4SemanticSearchPage.test.tsx; npx tsc --noEmit
```

Expected: PASS（`A4SemanticSearchPage.test.tsx` 若不存在則略過該檔）。

- [ ] **Step 5: Commit**

```powershell
git add src/console/sessionIdentity.ts src/console/sessionIdentity.test.ts src/console/SessionIdentityCard.tsx src/console/SessionIdentityCard.test.tsx src/console/ClosedSessionRecovery.tsx src/console/ClosedSessionRecovery.test.tsx
git diff --cached --check; git commit -m "feat(console): filename-first session identity; archived sessions show the file and can be purged" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `SessionCleanupDialog` 與 `#sessions` 接線

**Files:**
- Create: `web-viewer-sample/src/console/SessionCleanupDialog.tsx`、`SessionCleanupDialog.test.tsx`
- Modify: `pages.tsx`（`SessionManagementPage`：新 Panel 與重載）、`SessionManagementPage.test.tsx`（追加一例）

**Interfaces:**
- Produces: `<SessionCleanupDialog open onClose onFinished />`；test id `cleanup-days`、`cleanup-preview`、`cleanup-confirm`、`cleanup-cancel`、`cleanup-group-closed`、`cleanup-group-stale`、`cleanup-group-records`、`cleanup-result-row-<id>`、`cleanup-stopped-403`、`cleanup-done`；頁面 `cleanup-open`。

- [ ] **Step 1: 寫失敗測試**

`SessionCleanupDialog.test.tsx`：

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fx } from "./__testdata__/contractFixtures";
import { CoordinatorHttpError, coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
import { SessionCleanupDialog } from "./SessionCleanupDialog";

const OLD = "2026-09-01T00:00:00.000Z";
describe("SessionCleanupDialog", () => {
  let container: HTMLDivElement; let root: Root;
  const q = <T extends Element>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`);
  const click = async (id: string) => { await act(async () => { q<HTMLButtonElement>(id)!.click(); }); await act(async () => { await Promise.resolve(); }); };
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ now: Date.parse("2026-09-30T00:00:00.000Z"), toFake: ["Date"] });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [
      fx.runtimeSessionSummary({ session_id: "review_session_stale", status: "active", updated_at: OLD, viewer_leases: [], primary_viewer_lease_id: null }),
      fx.runtimeSessionSummary({ session_id: "review_session_busy", status: "active", updated_at: OLD, primary_viewer_lease_id: "lease", viewer_leases: [fx.publicViewerLease({})] }),
    ] } } as RuntimeStatus);
    vi.spyOn(coordinatorClient, "listClosedReviewSessions").mockResolvedValue({ items: [
      { session_id: "review_session_closed", status: "closed", project_id: "p", model_version_id: "m", created_at: OLD, updated_at: OLD, recreated_from_session_id: null, source_ifc_filename: "villa.ifc", rebuildability: { state: "ready", reason: null, checked_at: OLD } },
    ], next_cursor: null });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [fx.conversionRecord({ idempotency_key: "mw_0123456789abcdef", status: "ready", updated_at: OLD, sessions: [] })] });
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const render = async () => { await act(async () => { root.render(<SessionCleanupDialog open onClose={() => {}} onFinished={() => {}} />); }); };

  it("previews the three candidate groups for the cutoff", async () => {
    await render();
    await click("cleanup-preview");
    expect(q("cleanup-group-stale")?.textContent).toContain("review_session_stale");
    expect(q("cleanup-group-stale")?.textContent).not.toContain("review_session_busy");
    expect(q("cleanup-group-closed")?.textContent).toContain("villa.ifc");
    expect(q("cleanup-group-records")?.textContent).toContain("mw_0123456789abcdef");
  });

  it("executes sequentially: close then purge stale sessions, purge closed ones, remove records; 404 counts as gone; 409 is reported and the loop continues", async () => {
    const close = vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_stale", status: "closing" }); // SessionCloseResponse = Pick<ReviewSession, "session_id" | "status">
    const purge = vi.spyOn(coordinatorClient, "purgeReviewSession")
      .mockResolvedValueOnce({ session_id: "review_session_stale", status: "purged", purged_at: OLD, removed: { session_file: true, events_file: true } })
      .mockRejectedValueOnce(new CoordinatorHttpError("/api/review-sessions/review_session_closed", 404, "not found", "review_session_not_found"));
    const remove = vi.spyOn(coordinatorClient, "removeConversionRecord").mockRejectedValue(new CoordinatorHttpError("/api/conversion/records/k", 409, "record_in_flight", "record_in_flight", { error_code: "record_in_flight", intake_status: "dispatched" }));
    await render();
    await click("cleanup-preview");
    await click("cleanup-confirm");
    expect(close).toHaveBeenCalledWith("review_session_stale", "stale_cleanup");
    expect(purge.mock.calls.map((c) => c[0])).toEqual(["review_session_stale", "review_session_closed"]);
    expect(purge.mock.calls[0][1]).toBe("stale_cleanup");
    expect(remove).toHaveBeenCalledWith("mw_0123456789abcdef");
    expect(q("cleanup-result-row-review_session_closed")?.textContent).toContain("已不存在");
    expect(q("cleanup-result-row-mw_0123456789abcdef")?.textContent).toContain("record_in_flight");
    expect(q("cleanup-done")).not.toBeNull();
  });

  it("stops at the first 403 and tells the operator about the token path", async () => {
    vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_stale", status: "closing" });
    const purge = vi.spyOn(coordinatorClient, "purgeReviewSession").mockRejectedValue(new CoordinatorHttpError("/api/review-sessions/x", 403, "caller ip not in allowlist"));
    const remove = vi.spyOn(coordinatorClient, "removeConversionRecord");
    await render();
    await click("cleanup-preview");
    await click("cleanup-confirm");
    expect(purge).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(q("cleanup-stopped-403")).not.toBeNull();
  });
});
```

`SessionManagementPage.test.tsx` 追加一例：渲染後 `cleanup-open` 存在，點擊後 `cleanup-days` 出現且預設值為 `14`。

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run src/console/SessionCleanupDialog.test.tsx src/console/SessionManagementPage.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 實作 `SessionCleanupDialog.tsx`**

```tsx
// #sessions「清理舊紀錄」（契約 §5.3）：預覽三組候選 → 逐筆循序執行 → 逐列結果。不新增批次端點。
import { useRef, useState } from "react";
import { Btn } from "./components";
import { CoordinatorHttpError, coordinatorClient, lifecycleConflict, type ClosedReviewSessionItem } from "./coordinatorClient";
import { t } from "./i18n";
import { cleanupCandidates, modelFileLabel, type CleanupCandidates } from "./modelFiles/modelFileView";

const MAX_CLOSED_PAGES = 10;
type Result = { id: string; label: string; outcome: string };

async function loadAllClosed(): Promise<ClosedReviewSessionItem[]> {
  const items: ClosedReviewSessionItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CLOSED_PAGES; page += 1) {
    const reply = await coordinatorClient.listClosedReviewSessions(50, cursor);
    items.push(...reply.items);
    if (!reply.next_cursor) break;
    cursor = reply.next_cursor;
  }
  return items;
}

function describeFailure(error: unknown): { text: string; stop: boolean } {
  if (error instanceof CoordinatorHttpError && error.status === 404) return { text: t("已不存在", "already gone"), stop: false };
  if (error instanceof CoordinatorHttpError && error.status === 403) return { text: t("403：未通過守門，請以 operator token 路徑執行", "403: guard rejected; use the operator token path"), stop: true };
  const conflict = lifecycleConflict(error);
  if (conflict) return { text: `${conflict.code}${conflict.intakeStatus ? ` · ${conflict.intakeStatus}` : ""}${conflict.sessions?.length ? ` · ${conflict.sessions.join("、")}` : ""}`, stop: false };
  return { text: String(error), stop: false };
}

export function SessionCleanupDialog({ open, onClose, onFinished }: { open: boolean; onClose: () => void; onFinished: () => void }) {
  const [days, setDays] = useState(14);
  const [candidates, setCandidates] = useState<CleanupCandidates | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [stopped403, setStopped403] = useState(false);
  const [done, setDone] = useState(false);
  const busyRef = useRef(false);
  if (!open) return null;

  const preview = async () => {
    setPreviewErr(null); setCandidates(null); setResults([]); setDone(false); setStopped403(false);
    try {
      const [runtime, closed, records] = await Promise.all([coordinatorClient.runtimeStatus(), loadAllClosed(), coordinatorClient.getConversionRecords(100)]);
      setCandidates(cleanupCandidates({ now: Date.now(), days, live: runtime.sessions.items, closed, records: records.items }));
    } catch (error) { setPreviewErr(String(error)); }
  };

  const run = async () => {
    if (!candidates || busyRef.current) return;
    busyRef.current = true; setBusy(true); setResults([]); setStopped403(false);
    const push = (row: Result) => setResults((current) => [...current, row]);
    const steps: Array<{ id: string; label: string; act: () => Promise<void> }> = [
      ...candidates.staleActive.map((s) => ({ id: s.session_id, label: s.session_id, act: async () => { await coordinatorClient.sessionClose(s.session_id, "stale_cleanup"); await coordinatorClient.purgeReviewSession(s.session_id, "stale_cleanup"); } })),
      ...candidates.closedSessions.map((s) => ({ id: s.session_id, label: `${s.session_id}${s.source_ifc_filename ? ` · ${s.source_ifc_filename}` : ""}`, act: async () => { await coordinatorClient.purgeReviewSession(s.session_id, "stale_cleanup"); } })),
      ...candidates.records.map((r) => ({ id: r.idempotency_key, label: `${modelFileLabel(r).title} · ${r.idempotency_key}`, act: async () => { await coordinatorClient.removeConversionRecord(r.idempotency_key); } })),
    ];
    try {
      for (const step of steps) {
        try { await step.act(); push({ id: step.id, label: step.label, outcome: t("已移除", "removed") }); }
        catch (error) {
          const failure = describeFailure(error);
          push({ id: step.id, label: step.label, outcome: failure.text });
          if (failure.stop) { setStopped403(true); break; }
        }
      }
    } finally {
      busyRef.current = false; setBusy(false); setDone(true); onFinished();
    }
  };

  const total = candidates ? candidates.staleActive.length + candidates.closedSessions.length + candidates.records.length : 0;
  return (
    <div className="ec-modal-backdrop" data-testid="cleanup-dialog">
      <div className="ec-modal" role="dialog" aria-modal="true" aria-labelledby="cleanup-title">
        <h3 id="cleanup-title">{t("清理舊紀錄", "Clean up old records")}</h3>
        <p className="ec-warn-note">{t("移除不可逆：session 檔與事件檔會刪除並留下退役標記，轉檔紀錄會變成墓碑。streaming 的轉檔 artifact 不在此清理範圍。", "Removal is irreversible: session and event files are deleted with a retired marker, conversion records become tombstones. Streaming artifacts are not cleaned here.")}</p>
        <label className="ec-field-k" htmlFor="cleanup-days">{t("保留最近幾天", "Keep the last N days")}</label>
        <input id="cleanup-days" data-testid="cleanup-days" className="ec-input" type="number" min={1} value={days} disabled={busy}
          onChange={(event) => setDays(Math.max(1, Number.parseInt(event.target.value, 10) || 1))} />
        <div className="ec-modal-actions">
          <Btn data-testid="cleanup-cancel" disabled={busy} onClick={onClose}>{done ? t("關閉", "Close") : t("取消", "Cancel")}</Btn>
          <Btn data-testid="cleanup-preview" disabled={busy} onClick={() => { void preview(); }}>{t("預覽候選", "Preview")}</Btn>
          <Btn primary data-testid="cleanup-confirm" disabled={busy || !candidates || total === 0 || done} onClick={() => { void run(); }}>{busy ? t("執行中…", "Running…") : t(`確認移除 ${total} 項`, `Remove ${total} item(s)`)}</Btn>
        </div>
        {previewErr && <p className="ec-warn-note">{previewErr}</p>}
        {candidates && <div className="ec-note">
          <p>{t(`早於 ${candidates.cutoffIso.slice(0, 10)} 的紀錄：`, `Records older than ${candidates.cutoffIso.slice(0, 10)}:`)}</p>
          <div data-testid="cleanup-group-stale"><strong>{t("無人連線的舊 session（先結束再移除）", "Idle old sessions (close, then remove)")}</strong> {candidates.staleActive.length}<ul>{candidates.staleActive.map((s) => <li key={s.session_id}>{s.session_id}</li>)}</ul></div>
          <div data-testid="cleanup-group-closed"><strong>{t("已關閉或失敗的 session", "Closed or failed sessions")}</strong> {candidates.closedSessions.length}<ul>{candidates.closedSessions.map((s) => <li key={s.session_id}>{s.session_id}{s.source_ifc_filename ? ` · ${s.source_ifc_filename}` : ""}</li>)}</ul></div>
          <div data-testid="cleanup-group-records"><strong>{t("無進行中審查的轉檔紀錄", "Conversion records without active reviews")}</strong> {candidates.records.length}<ul>{candidates.records.map((r) => <li key={r.idempotency_key}>{modelFileLabel(r).title} · {r.idempotency_key}</li>)}</ul></div>
        </div>}
        {results.length > 0 && <table className="ec-table"><tbody>{results.map((row) => (
          <tr key={row.id} data-testid={`cleanup-result-row-${row.id}`}><td>{row.label}</td><td>{row.outcome}</td></tr>
        ))}</tbody></table>}
        {stopped403 && <p className="ec-warn-note" data-testid="cleanup-stopped-403">{t("遇到 403 已停止；其餘項目未處理。", "Stopped at a 403; remaining items were not processed.")}</p>}
        {done && <p className="ec-note" data-testid="cleanup-done">{t("清理結束，三個清單已重新載入。", "Cleanup finished; the three lists were reloaded.")}</p>}
      </div>
    </div>
  );
}
```

`pages.tsx` `SessionManagementPage`：新增 state `const [cleanupOpen, setCleanupOpen] = useState(false); const [archiveKey, setArchiveKey] = useState(0);`；在「Active sessions」Panel 之前加：

```tsx
      <Panel title={t("清理舊紀錄", "Clean up old records")} sub={t("先預覽候選再逐筆移除；DELETE 走 conversion 控制路由守門", "Preview candidates, then remove one by one; DELETE uses the conversion-control guard")} prov="asbuilt">
        <Btn data-testid="cleanup-open" onClick={() => setCleanupOpen(true)}>{t("清理舊紀錄…", "Clean up…")}</Btn>
        <SessionCleanupDialog open={cleanupOpen} onClose={() => setCleanupOpen(false)} onFinished={() => { void load(); setArchiveKey((k) => k + 1); }} />
      </Panel>
```

「已封存 Session」Panel 內改為 `<ClosedSessionRecovery key={archiveKey} compact />`；import `SessionCleanupDialog`。

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run src/console/SessionCleanupDialog.test.tsx src/console/SessionManagementPage.test.tsx src/console/ClosedSessionRecovery.test.tsx; npx tsc --noEmit
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/console/SessionCleanupDialog.tsx src/console/SessionCleanupDialog.test.tsx src/console/pages.tsx src/console/SessionManagementPage.test.tsx
git diff --cached --check; git commit -m "feat(console): stale-record cleanup dialog on the session management page" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 模型資料頁：`include_removed=1`、「已移除」chip、停用觸發、移除紀錄

**Files:**
- Modify: `modelData/useConversionData.ts`（`getConversionRecords(100)` → `getConversionRecords(100, { includeRemoved: true })`）、`modelData/conversionShared.tsx`（`LEDGER_STATUS_LABEL`／`LEDGER_STATUS_PROV`／`MINIO_CHIP_LABEL` 加 `removed`）、`modelData/ObjectDetailPane.tsx`（觸發鈕 gating、移除紀錄鈕與 IntentDialog）
- Test: `modelData/ObjectDetailPane.test.tsx`（若無此檔，新建 `modelData/ObjectDetailPane.remove.test.tsx`，前置比照 `modelData/ModelDataPage.test.tsx` 的 render 與 `data` 假資料）、`modelData/useConversionData.test.ts`（若有：改斷言為帶 `includeRemoved`）

- [ ] **Step 1: 寫失敗測試**

`ObjectDetailPane.test.tsx` 追加（沿用檔內 `K`、`makeObject`、`makeRecord`、`makeData`、`render({object, data})`、`waitFor`；import 加 `coordinatorClient` 與 `CoordinatorHttpError`）：

```tsx
  const btn = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
  const clickTestId = async (id: string) => { await act(async () => { btn(id)!.click(); }); };

  it("[S2] removed 紀錄：chip「已移除」、觸發停用、移除鈕停用", async () => {
    render({ object: makeObject({ idempotency_key: K }), data: makeData({ records: [makeRecord({ status: "removed" })] }) });
    await waitFor(() => {
      expect(container.textContent).toContain("已移除");
      expect(btn("md-detail-trigger")!.disabled).toBe(true);
      expect(btn(`conversion-record-remove-${K}`)!.disabled).toBe(true);
    });
  });

  it("[S2] 移除紀錄：confirm→removeConversionRecord→loadRecords；409 record_in_use 照實列 sessions 且 dialog 不關", async () => {
    const remove = vi.spyOn(coordinatorClient, "removeConversionRecord")
      .mockRejectedValueOnce(new CoordinatorHttpError("/x", 409, "record_in_use", "record_in_use", { error_code: "record_in_use", sessions: ["review_session_a"] }))
      .mockResolvedValueOnce({ idempotency_key: K, status: "removed", removed_at: "2026-09-30T00:00:00.000Z", intake_jobs_removed: 0 });
    const data = makeData({ records: [makeRecord({ status: "ready", sessions: [] })] });
    render({ object: makeObject({ idempotency_key: K }), data });
    await waitFor(() => { expect(btn(`conversion-record-remove-${K}`)!.disabled).toBe(false); });
    await clickTestId(`conversion-record-remove-${K}`);
    await clickTestId("intent-confirm");
    await waitFor(() => { expect(container.querySelector('[data-testid="intent-action-error"]')?.textContent).toContain("review_session_a"); });
    await clickTestId("intent-confirm");
    await waitFor(() => { expect(remove).toHaveBeenCalledTimes(2); expect(data.loadRecords).toHaveBeenCalled(); });
  });
```

`useConversionData.test.ts` 既有對 `getConversionRecords` 的呼叫斷言改為 `toHaveBeenCalledWith(100, { includeRemoved: true })`。

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run src/console/modelData
```

Expected: 新案例 FAIL。

- [ ] **Step 3: 實作**

`conversionShared.tsx`：`LEDGER_STATUS_LABEL`（純字串字典）加 `removed: "已移除"`，`LEDGER_STATUS_PROV` 加 `removed: "p1"`，`MINIO_CHIP_LABEL`（module 層級 `t()` 字典）加 `removed: t("已移除", "removed")`；`lifecycleLabel` 讀 `LEDGER_STATUS_LABEL`，不必改。

`useConversionData.ts`：兩處（初次載入與 `loadRecords`）的 `getConversionRecords(100)` 改為 `getConversionRecords(100, { includeRemoved: true })`；註解說明「§5.6：chips 須認得墓碑」。

`ObjectDetailPane.tsx`「轉檔動作」區：
- 觸發鈕 `disabled={!["untracked", "failed", "indeterminate"].includes(chip)}` 保持，但 `chip === "removed"` 時 `title` 改為 `t("此紀錄已移除；同鍵進件會被拒絕，要重新轉檔請用上方第②步重派（新鍵）", "This record was removed; same-key intake is refused. Reconvert from step ② above (new key).")`。
- 加：

```tsx
          <Btn data-testid={`conversion-record-remove-${object.idempotency_key}`}
            disabled={!record || !removalState(record).allowed}
            caption={record ? (removalState(record).allowed ? "DELETE /api/conversion/records/{key}" : removalState(record).reason) : t("無 ledger 紀錄可移除", "No ledger record to remove")}
            onClick={() => { setRemoveErr(null); setRemoveOpen(true); }}>{t("移除紀錄", "Remove record")}</Btn>
```

state `removeOpen`、`removeBusy`、`removeErr`；`confirmRemove` 呼叫 `coordinatorClient.removeConversionRecord(record.idempotency_key)` 成功後 `setRemoveOpen(false); await data.loadRecords();`，失敗用 `lifecycleConflict` 組訊息（同 Task 5）；渲染 `<IntentDialog open={removeOpen} showReason={false} … />`。import `removalState` 自 `../modelFiles/modelFileView`、`lifecycleConflict` 自 `../coordinatorClient`（console 端一律走 `console/coordinatorClient.ts` 這個 re-export；`src/coordinatorClient/errors.ts` 不直接 import）。

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run src/console/modelData src/console/unified; npx tsc --noEmit
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/console/modelData
git diff --cached --check; git commit -m "feat(console): model data chips read tombstones, disable re-trigger and offer record removal" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: E2E（真 coordinator）

**Files:**
- Create: `web-viewer-sample/e2e/model-file-lifecycle.spec.ts`
- Modify: `web-viewer-sample/e2e/ready-review-session-intent.spec.ts`、`ready-review-isolated.spec.ts`

- [ ] **Step 1: 新 spec**

```ts
import { expect, test } from "@playwright/test";
import { readyModelId, startReadyReviewFixture } from "./support/ready-review-fixture";

// 契約 §5：清單→建立審查→#sessions 結束→已封存移除→清理預覽→移除紀錄；coordinator 為行程內真實實例，
// 轉檔權威為合成 fixture（不宣稱 Kit／GPU）。
test.describe.serial("Model file lifecycle console flow", () => {
  let fixture: Awaited<ReturnType<typeof startReadyReviewFixture>>;
  test.beforeAll(async () => { fixture = await startReadyReviewFixture(); });
  test.afterAll(async () => { await fixture?.stop(); });

  test("list, create, close, purge, cleanup preview, remove record", async ({ page, request }, testInfo) => {
    await page.goto(`${fixture.base}/ui/#a1-workbench`);
    const row = page.getByTestId(`model-file-row-${readyModelId}`);
    await expect(row).toContainText("Session contract fixture · architecture · 版本 v1");
    await expect(page.getByTestId(`model-file-open-${readyModelId}`)).toBeDisabled();

    const created = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/conversion/records/${readyModelId}/review-session`));
    await page.getByTestId(`model-file-create-${readyModelId}`).click();
    const { review_session_id: sessionId } = await (await created).json();
    await expect(page.getByTestId("a1-session-select")).toHaveValue(sessionId);
    await page.getByTestId("model-file-refresh").click();
    await expect(row).toContainText("進行中 1");
    await expect(page.getByTestId(`model-file-remove-${readyModelId}`)).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("model-file-list.png"), fullPage: true });

    await page.goto(`${fixture.base}/ui/#sessions`);
    await page.getByTestId(`session-terminate-${sessionId}`).click();
    const closed = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/review-sessions/${sessionId}/close`));
    await page.getByTestId("intent-confirm").click();
    expect((await closed).ok()).toBeTruthy();
    await expect(page.getByTestId(`closed-session-row-${sessionId}`)).toBeVisible();
    await expect(page.getByTestId(`closed-session-file-${sessionId}`)).toContainText("來源未知");

    await page.getByTestId(`session-purge-${sessionId}`).click();
    const purged = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/api/review-sessions/${sessionId}`));
    await page.getByTestId("intent-confirm").click();
    expect((await purged).status()).toBe(200);
    await expect(page.getByTestId(`closed-session-row-${sessionId}`)).toHaveCount(0);
    expect((await request.get(`${fixture.base}/api/review-sessions/${sessionId}`)).status()).toBe(404);

    await page.getByTestId("cleanup-open").click();
    await page.getByTestId("cleanup-days").fill("1");
    await page.getByTestId("cleanup-preview").click();
    await expect(page.getByTestId("cleanup-group-records")).toContainText("0");
    await expect(page.getByTestId("cleanup-confirm")).toBeDisabled();
    await page.getByTestId("cleanup-cancel").click();
    await page.screenshot({ path: testInfo.outputPath("sessions-after-purge.png"), fullPage: true });

    await page.goto(`${fixture.base}/ui/#a1-workbench`);
    await page.getByTestId(`model-file-remove-${readyModelId}`).click();
    const removed = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/api/conversion/records/${readyModelId}`));
    await page.getByTestId("intent-confirm").click();
    expect((await removed).status()).toBe(200);
    await expect(page.getByTestId(`model-file-row-${readyModelId}`)).toHaveCount(0);
    const hidden = await (await request.get(`${fixture.base}/api/conversion/records`)).json();
    expect(hidden.count).toBe(0);
    const shown = await (await request.get(`${fixture.base}/api/conversion/records?include_removed=1`)).json();
    expect(shown.items[0]).toMatchObject({ idempotency_key: readyModelId, status: "removed" });
  });
});
```

前置：`npm run build:ui`（fixture 以 `dist-ui` 服務 `/ui`）。fixture 的 `externalIntakeIpAllowlist` 含 loopback，DELETE 守門通過。

- [ ] **Step 2: 改寫兩支既有 spec**

`ready-review-session-intent.spec.ts` 逐段對照替換：`ready-review-model` 選取＋`ready-review-create` 點擊 → 直接點 `model-file-create-${readyModelId}`；「elsewhere」出現：`ready-review-refresh` → `model-file-refresh`，斷言 `ready-review-existing` 的 option → 斷言 `model-file-session-${readyModelId}` 內有 `option[value="${elsewhere.review_session_id}"]`（此時同鍵有兩筆進行中，選單才出現）；`ready-review-error` → `model-file-error`；`ready-review-retry` → `model-file-retry`；開啟既有：`model-file-session-${readyModelId}` `selectOption(first.review_session_id)` 後點 `model-file-open-${readyModelId}`；其餘（closed lineage、recreate）不變。

`ready-review-isolated.spec.ts`：`ready-review-sessions` 的兩處 `toContainText("尚無可審查模型")` 改為 `page.getByTestId("model-file-empty")` 可見；`ready-review-create` disabled 斷言改為 `await expect(page.getByTestId("model-file-list").locator("[data-testid^='model-file-create-']")).toHaveCount(0)`；「重新整理模型」按鈕名稱改為「重新整理」。

- [ ] **Step 3: 執行**

```powershell
cd web-viewer-sample; npm run build:ui; npx playwright test e2e/model-file-lifecycle.spec.ts e2e/ready-review-session-intent.spec.ts e2e/closed-session-recreate.spec.ts --reporter=line
```

Expected: 3 spec 通過；截圖在 `artifacts/e2e/_output/`。

- [ ] **Step 4: Commit**

```powershell
git add e2e/model-file-lifecycle.spec.ts e2e/ready-review-session-intent.spec.ts e2e/ready-review-isolated.spec.ts
git diff --cached --check; git commit -m "test(e2e): model file lifecycle console flow against a real coordinator" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 設計視覺 gate 與 `workspace.a1.default` 成對重錄

**Files:**
- Modify: `docs/plans/design-system-baseline/workspace.a1.default/1440x900.png`、`1920x1080.png`、`docs/plans/design-system-reference.manifest.json`

- [ ] **Step 1: 乾淨工作區上跑 A1 屏**

```powershell
cd web-viewer-sample; git status --short   # 必須為空
$env:DESIGN_SYSTEM_SCREEN_IDS = "workspace.a1.default"; npm run test:visual:design-system
```

Expected: FAIL，訊息含 `workspace.a1.default/1440x900: diff ratio … > 0.01`（面板從兩個下拉變成清單）；產物在 `../artifacts/e2e/design-system-visual/workspace.a1.default/{1440x900,1920x1080}-actual.png`。若 diff 未超過 1%，跳到 Step 4。

- [ ] **Step 2: 晉升基線並更新 manifest**

```powershell
Copy-Item ..\artifacts\e2e\design-system-visual\workspace.a1.default\1440x900-actual.png ..\docs\plans\design-system-baseline\workspace.a1.default\1440x900.png -Force
Copy-Item ..\artifacts\e2e\design-system-visual\workspace.a1.default\1920x1080-actual.png ..\docs\plans\design-system-baseline\workspace.a1.default\1920x1080.png -Force
node -e "
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const root=path.resolve('..');const mp=path.join(root,'docs/plans/design-system-reference.manifest.json');
const m=JSON.parse(fs.readFileSync(mp,'utf8'));
const sha=(p)=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const a1=m.screens.find(s=>s.id==='workspace.a1.default');
for (const vp of Object.keys(a1.baselines)) { a1.baselines[vp].sha256 = sha(path.join(root,a1.baselines[vp].path)); }
a1.baseline_provenance.approval = 'Rebaseline authorized by the owner direction-1 decision of 2026-09-30 (model-file-session-lifecycle-contract S2): the 3D workspace Choose model and review panel replaces the two review dropdowns with the Model files list (ModelFileList). Captured by the unchanged design-system-visual.spec.ts runner from the clean product commit named in the PR. Exact-head owner review of this PR remains the counted approval.';
const files=[];for (const s of m.screens) for (const vp of Object.keys(s.baselines)) { const p=path.join(root,s.baselines[vp].path); files.push(s.baselines[vp].path+'\0'+fs.statSync(p).size+'\0'+s.baselines[vp].sha256); }
m.baseline_snapshot_sha256 = crypto.createHash('sha256').update(files.sort().join('\n'),'utf8').digest('hex');
fs.writeFileSync(mp, JSON.stringify(m,null,2)+'\n');
console.log('updated', a1.baselines, m.baseline_snapshot_sha256);
"
```

（雜湊規則同 `scripts/capture-design-system-reference.mjs` 的 `canonicalFileDigest`：每個基線 `path\0bytes\0sha256`，排序後以 `\n` 串接再 sha256。）

- [ ] **Step 3: Commit 基線，再驗證**

```powershell
cd ..; git add docs/plans/design-system-baseline/workspace.a1.default docs/plans/design-system-reference.manifest.json
git diff --cached --check; git commit -m "chore(design): rebaseline workspace.a1.default for the model file list (paired product-surface capture)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
cd web-viewer-sample; Remove-Item Env:DESIGN_SYSTEM_SCREEN_IDS; npm run test:visual:design-system
pwsh -NoProfile -File ..\scripts\tests\verify-design-system-reference.ps1
```

Expected: 13 屏 × 2 視口全部 ≤ 1%（A1 為 0）；verify 腳本通過（需 pwsh 7）。

- [ ] **Step 4: 若 A1 差異未超過 1%**

不重錄；在 PR body 的 Frontend Verification 表寫實測 diff ratio。

---

### Task 11: 文件、全量 gate 與 PR

**Files:**
- Modify: `docs/plans/model-file-session-lifecycle-contract.md`（§7 S2 列補實際 test 檔名）

- [ ] **Step 1: 全量 gate**

```powershell
cd web-viewer-sample; npm test; npm run typecheck; npm run build; npm run build:ui; npm run test:session-first; npm run test:struct-log
cd ..; git diff --stat 4a69838..HEAD | tail -3    # 只應有 web-viewer-sample/ 與 docs/
pwsh -NoProfile -Command ". ./scripts/lib/design-system-gate.ps1; Get-DesignSystemChangeScope -RepoRoot . -ChangedPaths @((git diff --name-only 4a69838..HEAD)) | ConvertTo-Json -Depth 3"
```

Expected: viewer 五項全綠；scope 輸出 `visual_required: true`、`paired_rebaseline: true`（Task 10 重錄時）、`reference_missing_items` 為 11 個 legacy route。

- [ ] **Step 2: E2E 再跑一次（最終 head）**

```powershell
cd web-viewer-sample; npx playwright test e2e/model-file-lifecycle.spec.ts e2e/ready-review-session-intent.spec.ts e2e/closed-session-recreate.spec.ts --reporter=line
```

- [ ] **Step 3: 契約 §7**

S2 列的完成條件補上實際新增／改寫的測試檔名與 E2E spec 名，狀態行改為「S2 已實作（PR 待合併）」；commit `docs(plans): S2 completion evidence`。

- [ ] **Step 4: PR body**

用 Write 寫 `pr-body.md`（不入版控），七段依 `.github/PULL_REQUEST_TEMPLATE.md`：變更摘要（清單取代下拉、身分檔名優先、清理、移除、chips）、修改原因（契約 §5、owner 2026-09-30 顯示名稱裁決）、主要變更（依檔案群組）、驗證方式（Step 1 指令與數字、E2E 三支、視覺 gate 13 屏結果與 A1 重錄）、風險與影響（`ready-review-*` test id 移除、sessionStorage key 不變故 pending 可續用、LAN 守門 403 時清理停止、視覺基線重錄）、回滾方式（revert 單一 PR；基線一併回復）、後續建議（S3 真 stack E2E 與 181 部署、MinIO 物件的直接移除入口、recreate 探測競態）。附 Change Classification 表（API 契約：否；資料格式：否；前端：是；文件：是；凍結檔：否）與 Frontend Verification 表（required screens 13、reference_missing 11 個 route 逐字列出、rebaseline status、Full completion claimed: no）。結尾 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

- [ ] **Step 5: push 與 PR（依 owner 常設自主授權）**

```powershell
git push -u origin feat/model-file-lifecycle-s2
gh pr create --base main --head feat/model-file-lifecycle-s2 --title "feat(console): model file lifecycle S2 - model file list, filename-first identity, cleanup and removal" --body-file <pr-body 路徑>
```

之後：`pr-safety` 綠、獨立整分支審查、討論全結，以 `gh pr merge --merge --match-head-commit <sha>` 合併；`git fetch --prune`；worktree 清理先拆 junction（PowerShell 驗 ReparsePoint 後 `[IO.Directory]::Delete`）再 `git worktree remove`。
