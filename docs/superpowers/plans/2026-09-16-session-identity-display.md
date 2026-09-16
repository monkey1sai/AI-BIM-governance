# Session Identity Display（PR-2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** console 各處以「專案顯示名 · 種類 · 版本」＋來源 chip＋建立時間顯示 review session，取代裸 id；A1「審查模型」下拉依專案分組、不再以「檔名未提供」開頭。

**Architecture:** 一個純函式模組 `sessionIdentity.ts`（無 React）產生所有標籤，一個 `SessionIdentity` 元件負責三行版面；#pipeline、#sessions、A1、A4、KG 只換呈現，不改資料流、不新增輪詢。資料來源為 PR-1（#856）已部署的 `RuntimeSessionSummary.origin`。

**Tech Stack:** React 18 + TypeScript、vitest（jsdom）、既有 `t(zh, en)` i18n、`--ab-*` token 與 `.ec-prov` chip。

**Spec:** `docs/superpowers/specs/2026-09-16-session-identity-display-design.md` §2。

## Global Constraints

- 任一 `origin` 欄位為 null → 顯「未取得」類文字，不留空白、不用 id 拼湊假名稱。
- 所有既有 `data-testid`／`data-uc`（`handoff-link`／`handoff-count`／`handoff-none`／`session-row-<id>`／`session-terminate-<id>`／`ev-first-frame`／`ev-heartbeat`／`ev-stage`／`kg-session-link-<id>`／`ready-review-model`／`ready-review-existing`／`ready-review-model-identity`／`a4-session-select`）不變；`<option value>` 仍為原 id。
- 不新增依賴、不新增 CSS 檔、不改 API 呼叫時序。
- 每個 task：`cd web-viewer-sample && npx vitest run <檔案>` 綠再 commit；commit 前 `git diff --cached --check`。
- worktree：`C:\Repos\active\iot\AI-BIM-governance.worktrees\session-identity-display`（branch `feat/session-identity-display`）。

---

### Task 1: `sessionIdentity.ts` 純函式

**Files:**
- Create: `web-viewer-sample/src/console/sessionIdentity.ts`
- Test: `web-viewer-sample/src/console/sessionIdentity.test.ts`

**Interfaces:**
- Consumes: `RuntimeSessionSummary`、`ConversionRecord`（`./coordinatorClient`）、`t`（`./i18n`）。
- Produces:
  ```ts
  export function shortVersion(v: string): string;                 // UUID → 前 8 碼；其餘原樣
  export function shortSessionId(id: string): string;             // "…" + 後 6 碼
  export function sessionTitle(s: RuntimeSessionSummary): string; // 專案 · 種類 · 版本 xxxx
  export function sessionOriginLabel(s: RuntimeSessionSummary): string;
  export function sessionStatusLabel(status: RuntimeSessionSummary["status"]): string;
  export function formatCreated(iso: string, now?: number): string; // "MM-DD HH:mm · N 分鐘前"；空／非法 → "時間未取得"
  export function sessionOptionLabel(s: RuntimeSessionSummary, now?: number): string;
  export function modelOptionLabel(r: ConversionRecord): string;
  export function sortByCreatedDesc<T extends { created_at: string }>(items: T[]): T[];
  ```

- [ ] **Step 1: 寫失敗測試**

```ts
// web-viewer-sample/src/console/sessionIdentity.test.ts
import { describe, expect, it } from "vitest";
import { fx } from "./__testdata__/contractFixtures";
import {
  formatCreated, modelOptionLabel, sessionOptionLabel, sessionOriginLabel, sessionStatusLabel, sessionTitle,
  shortSessionId, shortVersion, sortByCreatedDesc,
} from "./sessionIdentity";

const NOW = Date.parse("2026-09-16T10:00:00Z");
const origin = (over: Partial<ReturnType<typeof fx.runtimeSessionSummary>["origin"]> = {}) => ({
  kind: "auto_conversion_ready" as const, created_by: "coordinator-auto-conversion-ready", intake_source: "minio_watch" as const,
  project_display_name: "東勢區許良宇紀念圖書館", category: "建築", bucket: "bim-control",
  source_object_key: "lib/root/建築/24e598ab/model.ifc", source_ifc_filename: "model.ifc",
  recreated_from_session_id: null, ledger_detected_at: "2026-09-08T08:42:32.485Z", ...over,
});
const s = (over: Parameters<typeof fx.runtimeSessionSummary>[0] = {}) => fx.runtimeSessionSummary({
  session_id: "review_session_fd48be0a3fff", status: "active", project_id: "mv_6c51d572",
  model_version_id: "24e598ab-be3d-4dbb-a1aa-60b0ba610618", participant_count: 2,
  created_at: "2026-09-16T09:42:00Z", origin: origin(), ...over,
});

describe("sessionIdentity", () => {
  it("shortVersion：UUID 取前 8 碼，其餘原樣", () => {
    expect(shortVersion("24e598ab-be3d-4dbb-a1aa-60b0ba610618")).toBe("24e598ab");
    expect(shortVersion("v1")).toBe("v1");
  });
  it("shortSessionId：…＋後 6 碼", () => {
    expect(shortSessionId("review_session_fd48be0a3fff")).toBe("…0a3fff");
  });
  it("sessionTitle：專案顯示名 · 種類 · 版本；null 欄位誠實退回", () => {
    expect(sessionTitle(s())).toBe("東勢區許良宇紀念圖書館 · 建築 · 版本 24e598ab");
    expect(sessionTitle(s({ origin: origin({ project_display_name: null, category: null }) }))).toBe("mv_6c51d572 · 種類未取得 · 版本 24e598ab");
  });
  it("sessionOriginLabel：四種 kind＋intake_source", () => {
    expect(sessionOriginLabel(s())).toBe("MinIO 自動");
    expect(sessionOriginLabel(s({ origin: origin({ intake_source: "external" }) }))).toBe("外部進件自動");
    expect(sessionOriginLabel(s({ origin: origin({ intake_source: null }) }))).toBe("轉檔完成自動");
    expect(sessionOriginLabel(s({ origin: origin({ kind: "console_request", created_by: "coordinator-ready-review-request" }) }))).toBe("Console 建立");
    expect(sessionOriginLabel(s({ origin: origin({ kind: "recreated", recreated_from_session_id: "review_session_7a9e6fb3d50d" }) }))).toBe("重建自 …fb3d50d".replace("…fb3d50d", "…b3d50d"));
    expect(sessionOriginLabel(s({ origin: origin({ kind: "api_explicit", created_by: "dev_user_001" }) }))).toBe("API 建立（dev_user_001）");
  });
  it("sessionStatusLabel：created 顯尚未啟動", () => {
    expect(sessionStatusLabel("created")).toBe("尚未啟動");
    expect(sessionStatusLabel("active")).toBe("進行中");
    expect(sessionStatusLabel("closing")).toBe("關閉中");
    expect(sessionStatusLabel("closed")).toBe("已關閉");
    expect(sessionStatusLabel("failed")).toBe("失敗");
  });
  it("formatCreated：本地 MM-DD HH:mm＋相對時間；空／非法 → 時間未取得", () => {
    const iso = "2026-09-16T09:42:00Z";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const abs = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(formatCreated(iso, NOW)).toBe(`${abs} · 18 分鐘前`);
    expect(formatCreated("2026-09-16T04:00:00Z", NOW)).toMatch(/· 6 小時前$/);
    expect(formatCreated("2026-09-08T10:00:00Z", NOW)).toMatch(/· 8 天前$/);
    expect(formatCreated("", NOW)).toBe("時間未取得");
    expect(formatCreated("nope", NOW)).toBe("時間未取得");
  });
  it("sessionOptionLabel：單行 option 文字", () => {
    expect(sessionOptionLabel(s(), NOW)).toMatch(/^\d\d-\d\d \d\d:\d\d · 18 分鐘前 · MinIO 自動 · 參與 2 · 進行中 · …0a3fff$/);
  });
  it("modelOptionLabel：種類 · 版本 · 轉檔 MM-DD；有 object_key 前綴檔名；無 key 不出現「檔名未提供」", () => {
    const withKey = fx.conversionRecord({ idempotency_key: "mw_1", project_display_name: "ifc-test", category: "architecture", external_model_version_id: "v1", object_key: "ifc-test/architecture/v1/model.ifc", detected_at: "2026-09-16T05:08:23.923Z" });
    expect(modelOptionLabel(withKey)).toMatch(/^model\.ifc · architecture · 版本 v1 · 轉檔 09-16$/);
    const noKey = fx.conversionRecord({ idempotency_key: "mw_2", project_display_name: "洲際好宅", category: "", external_model_version_id: "77e4fbad-e0f7-4946-9a49-fa84d941ddeb", object_key: null, detected_at: "2026-08-19T06:23:00Z" });
    expect(modelOptionLabel(noKey)).toBe("種類未取得 · 版本 77e4fbad · 轉檔 08-19");
    expect(modelOptionLabel(noKey)).not.toContain("檔名未提供");
  });
  it("sortByCreatedDesc：新到舊，不改原陣列", () => {
    const a = { created_at: "2026-09-01T00:00:00Z" }, b = { created_at: "2026-09-10T00:00:00Z" }, c = { created_at: "" };
    const input = [a, b, c];
    expect(sortByCreatedDesc(input).map((x) => x.created_at)).toEqual([b.created_at, a.created_at, ""]);
    expect(input[0]).toBe(a);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web-viewer-sample && npx vitest run src/console/sessionIdentity.test.ts`
Expected: FAIL，找不到模組 `./sessionIdentity`。

- [ ] **Step 3: 最小實作**

```ts
// web-viewer-sample/src/console/sessionIdentity.ts
// session 身分顯示（session-identity-display spec §2.1）：純函式、無 React、無 I/O。
// 所有 null 一律顯「未取得」類文字，不用 id 拼湊假名稱。
import type { ConversionRecord, RuntimeSessionSummary } from "./coordinatorClient";
import { t } from "./i18n";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shortVersion(v: string): string { return UUID_RE.test(v) ? v.slice(0, 8) : v; }
export function shortSessionId(id: string): string { return `…${id.slice(-6)}`; }

export function sessionTitle(s: RuntimeSessionSummary): string {
  const project = s.origin.project_display_name || s.project_id;
  const category = s.origin.category || t("種類未取得", "category unavailable");
  return `${project} · ${category} · ${t("版本", "version")} ${shortVersion(s.model_version_id)}`;
}

export function sessionOriginLabel(s: RuntimeSessionSummary): string {
  const o = s.origin;
  switch (o.kind) {
    case "auto_conversion_ready":
      if (o.intake_source === "minio_watch") return t("MinIO 自動", "MinIO auto");
      if (o.intake_source === "external") return t("外部進件自動", "external intake auto");
      return t("轉檔完成自動", "conversion-ready auto");
    case "console_request": return t("Console 建立", "created in console");
    case "recreated": return `${t("重建自", "recreated from")} ${o.recreated_from_session_id ? shortSessionId(o.recreated_from_session_id) : t("未取得", "unavailable")}`;
    default: return `${t("API 建立", "created via API")}（${o.created_by}）`;
  }
}

export function sessionStatusLabel(status: RuntimeSessionSummary["status"]): string {
  switch (status) {
    case "created": return t("尚未啟動", "not started");
    case "active": return t("進行中", "active");
    case "closing": return t("關閉中", "closing");
    case "closed": return t("已關閉", "closed");
    default: return t("失敗", "failed");
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
export function formatCreated(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (!iso || Number.isNaN(ms)) return t("時間未取得", "time unavailable");
  const d = new Date(ms);
  const abs = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diffMin = Math.max(0, Math.round((now - ms) / 60_000));
  const rel = diffMin < 60 ? `${diffMin} ${t("分鐘前", "min ago")}`
    : diffMin < 60 * 24 ? `${Math.round(diffMin / 60)} ${t("小時前", "h ago")}`
      : `${Math.round(diffMin / (60 * 24))} ${t("天前", "d ago")}`;
  return `${abs} · ${rel}`;
}

export function sessionOptionLabel(s: RuntimeSessionSummary, now: number = Date.now()): string {
  return `${formatCreated(s.created_at, now)} · ${sessionOriginLabel(s)} · ${t("參與", "participants")} ${s.participant_count} · ${sessionStatusLabel(s.status)} · ${shortSessionId(s.session_id)}`;
}

export function modelOptionLabel(r: ConversionRecord): string {
  const filename = r.object_key ? r.object_key.split("/").pop() : "";
  const detected = Date.parse(r.detected_at);
  const detectedText = Number.isNaN(detected) ? t("時間未取得", "time unavailable") : `${pad(new Date(detected).getMonth() + 1)}-${pad(new Date(detected).getDate())}`;
  const core = `${r.category || t("種類未取得", "category unavailable")} · ${t("版本", "version")} ${shortVersion(r.external_model_version_id)} · ${t("轉檔", "converted")} ${detectedText}`;
  return filename ? `${filename} · ${core}` : core;
}

export function sortByCreatedDesc<T extends { created_at: string }>(items: T[]): T[] {
  const ts = (x: T) => { const v = Date.parse(x.created_at); return Number.isNaN(v) ? -Infinity : v; };
  return items.slice().sort((a, b) => ts(b) - ts(a));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web-viewer-sample && npx vitest run src/console/sessionIdentity.test.ts`
Expected: PASS（9 tests）。

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/sessionIdentity.ts web-viewer-sample/src/console/sessionIdentity.test.ts
git diff --cached --check
git commit -m "feat(console): sessionIdentity 純函式（標題／來源／狀態／時間／option 標籤）"
```

---

### Task 2: `SessionIdentity` 元件

**Files:**
- Create: `web-viewer-sample/src/console/SessionIdentity.tsx`
- Test: `web-viewer-sample/src/console/SessionIdentity.test.tsx`

**Interfaces:**
- Consumes: Task 1 全部函式。
- Produces: `export function SessionIdentity({ session, compact, now }: { session: RuntimeSessionSummary; compact?: boolean; now?: number })`；根元素 `data-testid="session-identity"`，內含 `data-testid="session-identity-title"`、`session-id`（非 compact）、`session-origin`、`session-created`、`session-status`。

- [ ] **Step 1: 寫失敗測試**

```tsx
// web-viewer-sample/src/console/SessionIdentity.test.tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { fx } from "./__testdata__/contractFixtures";
import { SessionIdentity } from "./SessionIdentity";

const NOW = Date.parse("2026-09-16T10:00:00Z");
const session = fx.runtimeSessionSummary({
  session_id: "review_session_fd48be0a3fff", status: "created", project_id: "mv_6c51d572",
  model_version_id: "24e598ab-be3d-4dbb-a1aa-60b0ba610618", participant_count: 0, created_at: "2026-09-16T09:42:00Z",
  origin: { kind: "console_request", created_by: "coordinator-ready-review-request", intake_source: null, project_display_name: "IOTTEST", category: "建築-JJtest", bucket: null, source_object_key: null, source_ifc_filename: null, recreated_from_session_id: null, ledger_detected_at: null },
});

describe("SessionIdentity", () => {
  it("三行：主標／識別列（完整 id）／狀態列（來源、時間、狀態 created=尚未啟動、參與）", () => {
    const html = renderToString(<SessionIdentity session={session} now={NOW} />);
    const div = document.createElement("div"); div.innerHTML = html;
    expect(div.querySelector('[data-testid="session-identity-title"]')?.textContent).toBe("IOTTEST · 建築-JJtest · 版本 24e598ab");
    expect(div.querySelector('[data-testid="session-id"]')?.textContent).toContain("review_session_fd48be0a3fff");
    expect(div.querySelector('[data-testid="session-origin"]')?.textContent).toBe("Console 建立");
    expect(div.querySelector('[data-testid="session-created"]')?.textContent).toMatch(/18 分鐘前$/);
    expect(div.querySelector('[data-testid="session-status"]')?.textContent).toBe("尚未啟動");
    expect(div.textContent).toContain("參與 0");
  });
  it("compact：不出識別列", () => {
    const html = renderToString(<SessionIdentity session={session} compact now={NOW} />);
    const div = document.createElement("div"); div.innerHTML = html;
    expect(div.querySelector('[data-testid="session-identity-title"]')).not.toBeNull();
    expect(div.querySelector('[data-testid="session-id"]')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web-viewer-sample && npx vitest run src/console/SessionIdentity.test.tsx`
Expected: FAIL，找不到模組。

- [ ] **Step 3: 最小實作**

```tsx
// web-viewer-sample/src/console/SessionIdentity.tsx
// session 身分三行（spec §2.2）：主標／識別列／狀態列。樣式只用 --ab-* token 與 .ec-prov chip。
import type { RuntimeSessionSummary } from "./coordinatorClient";
import { t } from "./i18n";
import { formatCreated, sessionOriginLabel, sessionStatusLabel, sessionTitle } from "./sessionIdentity";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function SessionIdentity({ session, compact = false, now }: { session: RuntimeSessionSummary; compact?: boolean; now?: number }) {
  const statusClass = session.status === "active" ? "ec-prov ec-asbuilt" : session.status === "created" ? "ec-prov ec-artifact" : "ec-prov ec-p4";
  return (
    <div data-testid="session-identity" style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span data-testid="session-identity-title" style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--ab-text)", wordBreak: "break-word" }}>{sessionTitle(session)}</span>
      {!compact && (
        <span data-testid="session-id" style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dimmer)", wordBreak: "break-all" }}>{session.session_id}</span>
      )}
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--ab-text-dim)" }}>
        <span data-testid="session-origin" className="ec-prov ec-artifact">{sessionOriginLabel(session)}</span>
        <span data-testid="session-created">{formatCreated(session.created_at, now)}</span>
        <span data-testid="session-status" className={statusClass}>{sessionStatusLabel(session.status)}</span>
        <span>{t("參與", "participants")} {session.participant_count}</span>
      </span>
    </div>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web-viewer-sample && npx vitest run src/console/SessionIdentity.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/SessionIdentity.tsx web-viewer-sample/src/console/SessionIdentity.test.tsx
git diff --cached --check
git commit -m "feat(console): SessionIdentity 三行元件"
```

---

### Task 3: #pipeline 3D Handoff 卡片

**Files:**
- Modify: `web-viewer-sample/src/console/unified/PipelinePage.tsx`（handoff 欄，`sess.value.items.map` 區塊）
- Test: `web-viewer-sample/src/console/unified/pipelineLiveBinding.test.tsx`

**Interfaces:**
- Consumes: `SessionIdentity`、`sortByCreatedDesc`。
- Produces: 卡片依 `created_at` 新到舊，最多 5 張；超過時 `data-uc="handoff-more"` anchor `href="#sessions"` 文字「還有 N 個 → Session 管理」；`handoff-count` 仍為 active 總數。

- [ ] **Step 1: 寫失敗測試**（追加到 `pipelineLiveBinding.test.tsx` 既有 describe）

```tsx
  it("3D handoff 卡片：SessionIdentity 主標取代裸 id、依 created_at 新到舊、最多 5 張＋「還有 N 個」", async () => {
    const mk = (i: number) => ({ ...sessionItem(`review_session_${i}`, "active"), created_at: `2026-09-1${i}T00:00:00Z`, origin: { ...sessionItem("x").origin, project_display_name: `專案${i}`, category: "建築" } });
    spyCoordinatorEndpoints({ runtimeStatus: { ...RT_IDLE, sessions: { count: 7, active_count: 7, participant_count: 0, items: [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6), mk(7)] } } });
    await mountPipeline();
    expect(uc("handoff-count").textContent).toBe("7");
    const titles = [...container.querySelectorAll('[data-uc="handoff-link"]')].map((a) => a.parentElement!.querySelector('[data-testid="session-identity-title"]')!.textContent);
    expect(titles).toEqual(["專案7 · 建築 · 版本 v1", "專案6 · 建築 · 版本 v1", "專案5 · 建築 · 版本 v1", "專案4 · 建築 · 版本 v1", "專案3 · 建築 · 版本 v1"]);
    expect(uc("handoff-more").textContent).toContain("還有 2 個");
    expect(uc("handoff-more").getAttribute("href")).toBe("#sessions");
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web-viewer-sample && npx vitest run src/console/unified/pipelineLiveBinding.test.tsx`
Expected: 新案 FAIL（無 `session-identity-title`）。

- [ ] **Step 3: 實作**

`PipelinePage.tsx` 加 import：`import { SessionIdentity } from "../SessionIdentity"; import { sortByCreatedDesc } from "../sessionIdentity";`。
把 `sess.value.items.map((s) => (...))` 區塊改為：

```tsx
              : (() => {
                const ordered = sortByCreatedDesc(sess.value.items);
                const shown = ordered.slice(0, 5);
                const rest = ordered.length - shown.length;
                return <>
                  {shown.map((s) => (
                    <div key={s.session_id} style={{ ...innerBox, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <SessionIdentity session={s} />
                      <a data-uc="handoff-link" data-action="nav" href={coordinatorClient.openInViewerUrl(s.session_id)} target="_blank" rel="noopener noreferrer" className="hv-bright" style={handoffBtn}>{zh ? "開啟即時視圖（新分頁）" : "Open live view (new tab)"}</a>
                    </div>
                  ))}
                  {rest > 0 && <a data-uc="handoff-more" data-action="nav" href="#sessions" style={{ fontSize: 11, color: "var(--ab-accent-text)", textAlign: "center", padding: "6px 0" }}>{zh ? `還有 ${rest} 個 → Session 管理` : `${rest} more → Session management`}</a>}
                </>;
              })())
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web-viewer-sample && npx vitest run src/console/unified/pipelineLiveBinding.test.tsx`
Expected: PASS（含既有 6 案）。

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/unified/PipelinePage.tsx web-viewer-sample/src/console/unified/pipelineLiveBinding.test.tsx
git diff --cached --check
git commit -m "feat(pipeline): 3D handoff 卡片改 SessionIdentity、新到舊、最多 5 張"
```

---

### Task 4: #sessions 表 4 欄＋filter chip；KG 連結文字

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（SessionManagementPage 的 Active sessions Panel；KitGpuFleetPage `liveIds` 區塊）
- Test: `web-viewer-sample/src/console/SessionManagementPage.test.tsx`、`web-viewer-sample/src/console/KitGpuFleetCrossLinks.test.tsx`

**Interfaces:**
- Consumes: `SessionIdentity`、`sessionOriginLabel`、`sessionTitle`、`shortSessionId`、`sortByCreatedDesc`。
- Produces: 表頭 `身分／狀態與來源／證據／動作`；filter chip `data-testid="sessions-filter-<status>"`（active／created／closing，`aria-pressed`）；legend 計數依 filter；KG 鈕文字 `sessionTitle · …xxxxxx →`。

- [ ] **Step 1: 寫失敗測試**（`SessionManagementPage.test.tsx` 既有多狀態案末尾追加，並新增一案）

```tsx
    // PR-2：4 欄身分表＋filter chip
    expect(container.querySelector('[data-testid="session-row-sess_active"] [data-testid="session-identity-title"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="session-row-sess_active"] [data-testid="session-origin"]')?.textContent).toBe("API 建立（dev_user_001）");
    const createdChip = container.querySelector<HTMLButtonElement>('[data-testid="sessions-filter-created"]')!;
    expect(createdChip.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { createdChip.click(); });
    expect(container.querySelector('[data-testid="session-row-sess_created"]')).toBeNull();
    expect(container.querySelector('[data-testid="session-row-sess_active"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sessions-status-legend"]')!.textContent).toContain("created 1");
```

`KitGpuFleetCrossLinks.test.tsx` 第一案 `expect(live).not.toBeNull();` 之後追加：

```tsx
    expect(live.textContent).toContain("…ssion_a");
    expect(live.textContent).toContain("版本");
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web-viewer-sample && npx vitest run src/console/SessionManagementPage.test.tsx src/console/KitGpuFleetCrossLinks.test.tsx`
Expected: 兩檔新斷言 FAIL。

- [ ] **Step 3: 實作**

`pages.tsx` 加 import：`import { SessionIdentity } from "./SessionIdentity"; import { sessionTitle, shortSessionId, sortByCreatedDesc } from "./sessionIdentity";`。

SessionManagementPage：在 `const liveSessions = sessions.filter(...)` 之後加：

```tsx
  const [statusFilter, setStatusFilter] = useState<Set<"active" | "created" | "closing">>(() => new Set(["active", "created", "closing"]));
  const toggleStatus = (s: "active" | "created" | "closing") => setStatusFilter((prev) => { const next = new Set(prev); if (next.has(s)) next.delete(s); else next.add(s); return next; });
  const visibleSessions = sortByCreatedDesc(liveSessions.filter((s) => statusFilter.has(s.status as "active" | "created" | "closing")));
```

legend 段改為（保留 `data-testid="sessions-status-legend"`，計數用 `liveSessions` 全量、不受 filter 影響，因為 legend 是「本表總覽」）：

```tsx
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
          {(["active", "created", "closing"] as const).map((s) => (
            <button key={s} type="button" data-testid={`sessions-filter-${s}`} aria-pressed={statusFilter.has(s)} onClick={() => toggleStatus(s)}
              className={statusFilter.has(s) ? "ec-prov ec-asbuilt" : "ec-prov ec-p4"} style={{ cursor: "pointer" }}>
              {s} {liveSessions.filter((x) => x.status === s).length}
            </button>
          ))}
        </div>
        <p className="ec-note" data-testid="sessions-status-legend">（既有 legend 內容不變）</p>
```

表格：`<thead>` 改 `<tr><th>{t("身分","identity")}</th><th>{t("狀態與來源","status / origin")}</th><th>{t("證據","evidence")}</th><th>{t("動作","actions")}</th></tr>`；`liveSessions.map` 改 `visibleSessions.map`；每列前三個 `<td>` 改為：

```tsx
                  <td style={{ minWidth: 260 }}><SessionIdentity session={s} /></td>
                  <td>
                    <div>{s.status}{s.status === "created" ? <span className="ec-note" style={{ marginLeft: 4 }}>{t("尚未啟動", "not started")}</span> : null}</div>
                    <div className="ec-note" style={{ margin: 0 }}>{t("轉檔", "conversion")} {s.conversion_status ?? "—"}</div>
                    {s.origin.source_object_key && <div className="ec-note" style={{ margin: 0, wordBreak: "break-all" }}>{s.origin.source_object_key}</div>}
                  </td>
                  {(() => {
                    const ev = leaseEvidence(s, Date.now());
                    const na = t("未取得", "not observed");
                    return (<td>
                      <div data-testid="ev-first-frame">{t("首幀", "first frame")} {ev.firstFrameAt ? new Date(ev.firstFrameAt).toLocaleTimeString() : na}</div>
                      <div data-testid="ev-heartbeat">{t("心跳", "heartbeat")} {ev.lastHeartbeatAt
                        ? <>{new Date(ev.lastHeartbeatAt).toLocaleTimeString()}{ev.heartbeatStale ? <span className="ec-prov ec-p1" style={{ marginLeft: 4 }}>stale</span> : null}</>
                        : na}</div>
                      <div data-testid="ev-stage">stage {ev.stageMatch === true ? "matched" : ev.stageMatch === false ? t("不符", "mismatch") : na}</div>
                      <div className="ec-note" style={{ margin: 0, wordBreak: "break-all" }}>{s.expected_stage_url ?? "—"}</div>
                    </td>);
                  })()}
```

（原本的 `<td>{s.session_id}</td>`、status、participants、conversion、stage、三個證據 `<td>` 全部被上面取代；動作 `<td>` 原樣保留。）

KitGpuFleetPage：`liveIds` 改為取 session 物件：

```tsx
  const liveSessionsForKg = Object.values(shared.sessionsById).filter((s) => s.status === "active");
```

按鈕改：`{liveSessionsForKg.map((s) => (<Btn key={s.session_id} data-testid={`kg-session-link-${s.session_id}`} ... >{sessionTitle(s)} · {shortSessionId(s.session_id)} →</Btn>))}`，`liveIds.length` 改 `liveSessionsForKg.length`；其餘引用 `liveIds` 的地方（若有）一併改為 `liveSessionsForKg.map((s) => s.session_id)`。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web-viewer-sample && npx vitest run src/console/SessionManagementPage.test.tsx src/console/KitGpuFleetCrossLinks.test.tsx src/console/console.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/SessionManagementPage.test.tsx web-viewer-sample/src/console/KitGpuFleetCrossLinks.test.tsx
git diff --cached --check
git commit -m "feat(sessions): Active sessions 表改 4 欄身分＋狀態 filter chip；KG 連結顯示 session 標題"
```

---

### Task 5: A1「審查模型」optgroup／「既有審查」標籤；A4 下拉

**Files:**
- Modify: `web-viewer-sample/src/console/ReadyReviewSessions.tsx`、`web-viewer-sample/src/console/A4SemanticSearchPage.tsx`
- Test: `web-viewer-sample/src/console/ReadyReviewSessions.test.tsx`、`web-viewer-sample/src/console/A4SemanticSearchPage.test.tsx`

**Interfaces:**
- Consumes: `modelOptionLabel`、`sessionOptionLabel`、`sortByCreatedDesc`、`SessionIdentity`、`shortSessionId`。
- Produces: `ready-review-model` 內以 `<optgroup label={project_display_name || project_id}>` 分組；`ready-review-existing` option 文字為 `sessionOptionLabel`；選定後 `data-testid="ready-review-selected-identity"` 顯 `SessionIdentity compact`；identity 面板無 `object_key` 時顯「MinIO 路徑未持久化（舊轉檔紀錄）」；A4 option 文字為 `sessionOptionLabel`。

- [ ] **Step 1: 寫失敗測試**

`ReadyReviewSessions.test.tsx`：第 128 行 `expect(...ready-review-existing...textContent).toContain(another.session_id)` 改為 `.toContain(another.session_id.slice(-6))`；並新增一案：

```tsx
  it("審查模型依專案 optgroup 分組、option 不以「檔名未提供」開頭；既有審查 option 顯建立時間／來源／狀態；選定後顯 SessionIdentity", async () => {
    const noKey = fx.conversionRecord({ ...record, idempotency_key: "mw_fedcba9876543210", project_display_name: "洲際好宅", category: "", object_key: null, detected_at: "2026-08-19T06:23:00Z" });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 2, items: [record, noKey] });
    await mount();
    const groups = [...container.querySelectorAll('[data-testid="ready-review-model"] optgroup')].map((g) => g.getAttribute("label"));
    expect(groups).toEqual(["Project A", "洲際好宅"]);
    expect(container.querySelector('[data-testid="ready-review-model"]')!.textContent).not.toContain("檔名未提供");
    expect(container.querySelector('[data-testid="ready-review-model"]')!.textContent).toContain("種類未取得 · 版本");
    await choose("ready-review-model", modelId);
    const existing = container.querySelector<HTMLSelectElement>('[data-testid="ready-review-existing"]')!;
    expect(existing.options[1].textContent).toMatch(/尚未啟動 · …isting$/);
    await choose("ready-review-existing", session.session_id);
    expect(container.querySelector('[data-testid="ready-review-selected-identity"] [data-testid="session-identity-title"]')).not.toBeNull();
  });
```

（`mount`／`choose` 為該測試檔既有 helper；若名稱不同，沿用檔內既有的 render 與 select 變更 helper。）

`A4SemanticSearchPage.test.tsx` 第 587-590 案之後追加：`expect(sessionSelect!.options[1].textContent).toContain("…n_alpha");`（`review_session_alpha` 後 6 碼）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web-viewer-sample && npx vitest run src/console/ReadyReviewSessions.test.tsx src/console/A4SemanticSearchPage.test.tsx`
Expected: 新斷言 FAIL。

- [ ] **Step 3: 實作**

`ReadyReviewSessions.tsx` 加 import：`import { SessionIdentity } from "./SessionIdentity"; import { modelOptionLabel, sessionOptionLabel, sortByCreatedDesc } from "./sessionIdentity";`。

模型下拉 `{records.map(record => <option ...>)}` 改為：

```tsx
        {(() => {
          const groups = new Map<string, ConversionRecord[]>();
          for (const r of records) { const k = r.project_display_name || r.project_id; groups.set(k, [...(groups.get(k) ?? []), r]); }
          return [...groups.entries()].map(([label, items]) => (
            <optgroup key={label} label={label}>
              {items.slice().sort((a, b) => (Date.parse(b.detected_at) || 0) - (Date.parse(a.detected_at) || 0)).map(r => (
                <option key={r.idempotency_key} value={r.idempotency_key}>{modelOptionLabel(r)}</option>
              ))}
            </optgroup>
          ));
        })()}
```

identity 面板 `<div>{model.object_key || t("來源檔名未提供", "Source filename unavailable")}</div>` 改 `<div>{model.object_key || t("MinIO 路徑未持久化（舊轉檔紀錄）", "MinIO path not persisted (legacy conversion record)")}</div>`。

既有審查 option：`{available.map((session, index) => <option ...>審查 {index+1} · … · {session.session_id}</option>)}` 改為 `{sortByCreatedDesc(available).map((session) => <option key={session.session_id} value={session.session_id}>{sessionOptionLabel(session)}</option>)}`；`<Btn data-testid="ready-review-open" ...>` 之後加：

```tsx
      {available.some(session => session.session_id === selectedId) && (
        <div data-testid="ready-review-selected-identity" style={{ flexBasis: "100%", marginTop: 4 }}>
          <SessionIdentity session={available.find(session => session.session_id === selectedId)!} compact />
        </div>
      )}
```

`A4SemanticSearchPage.tsx`：import `sessionOptionLabel`，option 內 `{s.session_id} · {s.model_version_id}` 改 `{sessionOptionLabel(s)}`。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web-viewer-sample && npx vitest run src/console/ReadyReviewSessions.test.tsx src/console/A4SemanticSearchPage.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/ReadyReviewSessions.tsx web-viewer-sample/src/console/A4SemanticSearchPage.tsx web-viewer-sample/src/console/ReadyReviewSessions.test.tsx web-viewer-sample/src/console/A4SemanticSearchPage.test.tsx
git diff --cached --check
git commit -m "feat(a1,a4): 審查模型依專案分組、既有審查／A4 session 下拉改身分標籤"
```

---

### Task 6: 全量驗證與 PR

- [ ] **Step 1: 全量**（cwd `web-viewer-sample`）

```bash
npx tsc --noEmit -p .
npx vitest run
npm run build
```
Expected: 全綠。若 E2E 檔（`e2e/*.spec.ts`）有以 option 文字或表格欄位 index 斷言者，依「testid／value 不變」原則只改文字斷言。

- [ ] **Step 2: PR**

`.github/PULL_REQUEST_TEMPLATE.md` 七段；驗證段列本地 vitest／tsc／build 數字；「尚未驗證」列 181 真站五處畫面（合併部署後補）。

## Self-review

- spec §2.1 八個函式 → Task 1 ✔；§2.2 元件 → Task 2 ✔；§2.3 六列（pipeline／sessions／A1 模型／A1 既有審查／A4／KG）→ Task 3／4／5 ✔；§2.4 誠實規則由 Task 1 fallback 測試鎖 ✔。
- 型別／命名：`sessionTitle`／`sessionOriginLabel`／`sessionStatusLabel`／`formatCreated`／`sessionOptionLabel`／`modelOptionLabel`／`sortByCreatedDesc`／`shortSessionId`／`shortVersion` 各 task 一致 ✔。
- 無 placeholder ✔。
