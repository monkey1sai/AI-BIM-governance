# Seven-Axis Cross-Page Harmony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Glue the seven canonical console routes (A1 / CV / SS / KG / M / IN / RT) plus the existing Review Room into one coherent system with a reusable cross-page handoff contract, a shared status/evidence rail, and evidence-typed cross-link chips — purely additive, zero new backend, zero new routes.

**Architecture:** All seven routes are hash routes inside the single-page `EdgeConsole` (`web-viewer-sample/src/console/`), so cross-page state uses a top-level React Context Provider that polls `GET /api/runtime/status` once every 5000ms and fans it out to every page via a `useSharedStatus()` hook and a `SharedStatusRail`. Navigation between axes uses one shared `handoff.ts` util that writes non-secret correlation IDs into the URL hash query (never a lease token); the receiving page re-verifies every ID against its authoritative endpoint. Nothing touches the frozen backend — every change lands in the console frontend.

**Tech Stack:** React 18 + TypeScript, Vitest (jsdom, raw `createRoot`+`act`, no @testing-library), Playwright (`web-viewer-sample/e2e/`), existing `coordinatorClient` APIs, existing `Btn`/`Panel`/`Field` DS components, `t(zh,en)` i18n helper.

## Global Constraints

Copied verbatim from the spec's Non-Negotiables (§3) and Implementation Scope (§11). Every task implicitly includes these:

- **N1 — No single-page merge.** Seven routes stay seven physical pages. Do not build a route table; reference the canonical route census (`docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` A.1.1) only. Hash has no slash in canonical form (`#a1`, not `#/a1`); `#gpu` canonical, `#review` alias; deep-link aliases (`intake`/`review`) stay.
- **N2 — No new backend service / route.** Reuse only endpoints already in `coordinatorClient`. No new daemon, proxy path, or REST route.
- **N3 — Do not re-adjudicate A1 3D.** 3D highlight lives only in Review Room (`ReviewSessionViewerPane.tsx`). A1 hands off IDs only; do not mount `EmbeddedViewer` in A1, do not claim lease on mount, do not auto-select a session, never put a lease token in the URL.
- **N4 — DO NOT TOUCH frozen backend files:** governance-service `app.py` / `diff_engine/api.py` / `federation/api.py` / `issues/api.py` / `bcf/api.py` / `file_library/api.py`; coordinator `bim-review-coordinator/src/app.ts` and `src/routes/governanceProxy.ts`; streaming `conversion_authority.py`. Frontend may only call coordinator `127.0.0.1:8004`; no direct calls to `:49102` / `:49101` / `:8010`. If an integration seems to need a backend change → stop and report; the design is misaligned, the backend is not missing a feature.
- **N5 — Prov honesty.** Unbuilt → mark "待建", no fake button; no telemetry → mark "未取得", never draw fail/green. The `Prov` type has exactly 7 values (`data.ts:6`): `asbuilt` / `artifact` / `demo` / `p1` / `p15` / `p3` / `p4`. There is NO `todo` (`prov="todo"` is a TS2322 compile error).
- **N6 — Additive integration only.** Only cross-page handoff contract, shared status/evidence rail, consistent terminology/Prov, and A1↔Review Room handoff extension. Do not rewrite any page's core loop.
- **N7 — user-facing needs browser evidence.** Any operable integration behavior must have gstack/Playwright evidence (screenshot + trace under `artifacts/e2e/`). Backend-only done is not accepted.
- **N8 — Official capacity boundary:** 1 GPU = 1 stream (N GPU nodes = N concurrent streams; spectators share one frame; session move = terminate+recreate, no live migration). Health semantics split "container/process alive" vs "stream ready".
- **N10 — No new production dependency for cross-page state.** Use React built-in Context only. **Forbidden:** BroadcastChannel / localStorage / Zustand / Redux.
- **GPU columns are always `null` → "未取得"** until kit-manager telemetry lands (OQ3); `GET /api/runtime/status` has no GPU node fields. Never fetch kit-manager `:8010` directly to fill them.
- **`stage_matched` in the shared snapshot is designed to be permanently `null`** (§5.2); do not fire per-session requests to fill it.
- **GitNexus discipline:** before modifying any existing exported symbol, run `impact({target: "<symbol>", direction: "upstream"})` and stop if HIGH/CRITICAL; before each commit run `detect_changes()` and confirm scope is only the expected symbols.
- **Verify command:** `npm run verify` (= `npm run build && npm test && npm run test:struct-log`) from `web-viewer-sample/`. Single-test: `npm test -- <file>`.

---

## File Structure

**New shared layer (`web-viewer-sample/src/console/`):**
- `handoff.ts` — `AxisKey` type, `CrossAxisHandoff` type, `buildHandoff()`, `parseHandoff()`, `isAxisKey()`. Absorbs the existing A1 pattern (`buildA1ReviewRoomHandoffHash` in `pages.tsx:232`, `parseReviewRoomHandoff` in `ReviewSessionViewerPane.tsx:31`) into a generic snake_case-URL util. Note: `ReviewRoomHandoff` (camelCase fields) and `CrossAxisHandoff` (snake_case, mirroring URL params) are deliberately different types; do NOT assume they are interchangeable.
- `useSharedStatus.ts` — `SharedSessionEntry`, `SharedStatusSnapshot`, `EMPTY_SHARED_STATUS`, `SharedStatusContext`, `useSharedStatus()`.
- `SharedStatusProvider.tsx` — top-level single 5000ms poll of `runtimeStatus()` (+ `getConversionRecords()` for queue depth); provides the snapshot via Context. Accepts an optional `value` prop for test injection (skips polling).
- `SharedStatusRail.tsx` — the visible rail; reads `useSharedStatus()`; renders Active sessions / GPU / Health / Conversion queue / Updated; `null`→"未取得", `stale`→dim.
- `incomingHandoff.tsx` — receiver half of the handoff contract (spec §4.2): `useIncomingHandoff(selfAxis, verify, hash?)` + `IncomingHandoffBanner`. Each receiving page (M/A1/CV/SS/KG) re-verifies the incoming id against data it already fetched and renders an honest verified / not-found banner (no silent fallback). See Task 14.

**Modified (frontend only):**
- `coordinatorClient.ts` — add `getConversionsHistory()` thin wrapper on existing `GET /api/dev/conversions` (`app.ts:2330`, unchanged backend). No other method changed.
- `EdgeConsole.tsx` — mount `<SharedStatusProvider>` at the top and `<SharedStatusRail>` in `ec-mainhead`. Route dispatch untouched.
- `edge-console.css` — append `.ec-statusrail` styles (visual only; tests key on data-attrs, not CSS).
- `pages.tsx` — per-axis additive chips + CV history panel + KG aggregate row + RT cross-link panel (functions: `A1GovernanceWorkbenchPage`, `ConversionSchedulingPage`, `SessionManagementPage`, `KitGpuFleetPage`, `MinioDataPage`, `IntakePage`, `CoordinatorPage`).
- `ReviewSessionViewerPane.tsx` — seed the session input with a candidate `<datalist>` from `useSharedStatus()`; lease/3D/highlight logic untouched (N3).

**New tests:** one `*.test.tsx` per task (Vitest) + one Playwright spec `e2e/cross-axis-handoff.spec.ts`.

**DO NOT TOUCH:** `OperatorConsole.tsx` / `IntakeSelectPage` (dead-code branches, §2 IN); any frozen backend file (N4).

---

## Task 1: `handoff.ts` — CrossAxisHandoff util

**Files:**
- Create: `web-viewer-sample/src/console/handoff.ts`
- Test: `web-viewer-sample/src/console/handoff.test.ts`

**Interfaces:**
- Produces (relied on by Tasks 4–15):
  - `type AxisKey = "a1" | "conv" | "sessions" | "instances" | "minio" | "intake" | "runtime"`
  - `interface CrossAxisHandoff { source: AxisKey; session?: string; rule_run_id?: string; ifc_guid?: string; usd_prim_path?: string; rule_code?: string; job_id?: string; conversion_id?: string; minio_key?: string; prefix?: string }`
  - `function isAxisKey(v: string): v is AxisKey`
  - `function buildHandoff(target: AxisKey, payload: CrossAxisHandoff): string` → returns `#<target>?source=<source>&...` (URLSearchParams-encoded; Chinese `minio_key` encoded automatically)
  - `function parseHandoff(hash?: string): CrossAxisHandoff | null` → `null` when there is no valid `source`

- [ ] **Step 1: Write the failing test**

```ts
// web-viewer-sample/src/console/handoff.test.ts
import { describe, expect, it } from "vitest";
import { buildHandoff, parseHandoff, isAxisKey, type CrossAxisHandoff } from "./handoff";

describe("cross-axis handoff util", () => {
  it("builds a #target?source=... hash carrying only provided ids", () => {
    const hash = buildHandoff("review", { source: "a1", rule_run_id: "rr_1", session: "review_session_x", ifc_guid: "g1" });
    expect(hash.startsWith("#review?")).toBe(true);
    const p = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
    expect(p.get("source")).toBe("a1");
    expect(p.get("rule_run_id")).toBe("rr_1");
    expect(p.get("session")).toBe("review_session_x");
    expect(p.get("ifc_guid")).toBe("g1");
    expect(p.get("usd_prim_path")).toBeNull(); // omitted keys are absent, not empty
  });

  it("round-trips a real Chinese minio_key (OQ4 deterministic spike)", () => {
    const key = "270專案/建築/v07/模型.ifc";
    const hash = buildHandoff("conv", { source: "minio", minio_key: key });
    expect(hash).toContain("source=minio");
    const parsed = parseHandoff(hash);
    expect(parsed?.source).toBe("minio");
    expect(parsed?.minio_key).toBe(key); // decode must reproduce the exact key
  });

  it("parseHandoff returns null when there is no source", () => {
    expect(parseHandoff("#minio")).toBeNull();
    expect(parseHandoff("#minio?foo=bar")).toBeNull();
    expect(parseHandoff("")).toBeNull();
  });

  it("parseHandoff rejects an unknown source axis", () => {
    expect(parseHandoff("#a1?source=bogus&minio_key=x")).toBeNull();
    expect(isAxisKey("bogus")).toBe(false);
    expect(isAxisKey("sessions")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- handoff.test.ts`
Expected: FAIL — `Cannot find module './handoff'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web-viewer-sample/src/console/handoff.ts
// Generic cross-axis handoff (frontend-only). Carries non-secret correlation IDs in the URL hash query;
// the receiving page must re-verify each ID against its authoritative endpoint (spec §4.2). Never carry a
// lease token, auth header, or any secret in this payload.

export type AxisKey = "a1" | "conv" | "sessions" | "instances" | "minio" | "intake" | "runtime";

const AXIS_KEYS: readonly AxisKey[] = ["a1", "conv", "sessions", "instances", "minio", "intake", "runtime"];

export interface CrossAxisHandoff {
  source: AxisKey;
  session?: string;
  rule_run_id?: string;
  ifc_guid?: string;
  usd_prim_path?: string;
  rule_code?: string;
  job_id?: string;
  conversion_id?: string;
  minio_key?: string;
  prefix?: string;
}

const PAYLOAD_KEYS: readonly (keyof CrossAxisHandoff)[] = [
  "session", "rule_run_id", "ifc_guid", "usd_prim_path", "rule_code", "job_id", "conversion_id", "minio_key", "prefix",
];

export function isAxisKey(v: string): v is AxisKey {
  return (AXIS_KEYS as readonly string[]).includes(v);
}

export function buildHandoff(target: AxisKey, payload: CrossAxisHandoff): string {
  const q = new URLSearchParams({ source: payload.source });
  for (const k of PAYLOAD_KEYS) {
    const v = payload[k];
    if (typeof v === "string" && v.length > 0) q.set(k, v);
  }
  return `#${target}?${q.toString()}`;
}

export function parseHandoff(hash: string = typeof window !== "undefined" ? window.location.hash : ""): CrossAxisHandoff | null {
  const i = hash.indexOf("?");
  if (i < 0) return null;
  const p = new URLSearchParams(hash.slice(i + 1));
  const source = p.get("source");
  if (!source || !isAxisKey(source)) return null;
  const out: CrossAxisHandoff = { source };
  for (const k of PAYLOAD_KEYS) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- handoff.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/handoff.ts web-viewer-sample/src/console/handoff.test.ts
git commit -m "feat(console): add CrossAxisHandoff build/parse util (七軸通用 handoff)"
```

---

## Task 2: `coordinatorClient.getConversionsHistory()` wrapper

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts` (the `coordinatorClient` object literal ends at line 513; add one method before the closing `};`; add one interface near the other response types)
- Test: `web-viewer-sample/src/console/coordinatorClient.conversions-history.test.ts`

**Interfaces:**
- Consumes: existing `jsonGet<T>(path)` helper (already in this file).
- Produces (relied on by Task 7):
  - `interface DevConversionRecord { conversion_job_id?: string; status?: string; created_at?: string; [k: string]: unknown }`
  - `coordinatorClient.getConversionsHistory(): Promise<{ items: DevConversionRecord[]; count?: number }>` → thin wrapper on existing `GET /api/dev/conversions` (backend unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// web-viewer-sample/src/console/coordinatorClient.conversions-history.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient } from "./coordinatorClient";

describe("coordinatorClient.getConversionsHistory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs /api/dev/conversions and returns the pass-through {items,count}", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [{ conversion_job_id: "cj_1", status: "succeeded" }], count: 1 }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    );
    const res = await coordinatorClient.getConversionsHistory();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("/api/dev/conversions");
    expect(res.items[0].conversion_job_id).toBe("cj_1");
    expect(res.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- coordinatorClient.conversions-history.test.ts`
Expected: FAIL — `getConversionsHistory is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add the interface next to the other response interfaces (e.g., just above `export interface ConversionRecord {` at line 328):

```ts
// Conversion-service job history pass-through (GET /api/dev/conversions → proxied to conversion service
// /api/conversions, bim-review-coordinator/src/app.ts:2330). Shape is a pass-through artifact from an
// external service; type it loosely and render honestly. Backend is NOT modified (N2/N4).
export interface DevConversionRecord {
  conversion_job_id?: string;
  status?: string;
  created_at?: string;
  [k: string]: unknown;
}
```

Add the method inside the `coordinatorClient` object, immediately before the closing `};` at line 513 (after `getIfcReadyJob`):

```ts
  // CV 轉檔歷史（純前端補洞）：讀既有 GET /api/dev/conversions（conversion service 側 job 歷史，
  // 與 coordinator ledger getConversionRecords 不同源）。後端不改（N2/N4）。
  getConversionsHistory: () =>
    jsonGet<{ items: DevConversionRecord[]; count?: number }>("/api/dev/conversions"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- coordinatorClient.conversions-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinatorClient.conversions-history.test.ts
git commit -m "feat(console): add getConversionsHistory client wrapper (GET /api/dev/conversions)"
```

---

## Task 3: SharedStatus Provider + `useSharedStatus` hook

**Files:**
- Create: `web-viewer-sample/src/console/useSharedStatus.ts`
- Create: `web-viewer-sample/src/console/SharedStatusProvider.tsx`
- Test: `web-viewer-sample/src/console/SharedStatusProvider.test.tsx`

**Interfaces:**
- Consumes: `coordinatorClient.runtimeStatus()` → `RuntimeStatus` (`sessions.items: RuntimeSessionSummary[]`, `sessions.active_count`, `service.status`); `coordinatorClient.getConversionRecords(limit)` → `{ count; items: ConversionRecord[] }` (`ConversionRecord.status: ConversionLedgerStatus`).
- Produces (relied on by Tasks 4, 9, 13):
  - `interface SharedSessionEntry { session_id: string; status: string; participants?: number; conversion?: string | null; stage_matched?: boolean | null }`
  - `interface SharedStatusSnapshot { activeSessions: number; sessionsById: Record<string, SharedSessionEntry>; gpuNodesTotal: number | null; gpuNodesBusy: number | null; health: "ok" | "degraded" | "unknown"; conversionQueue: number | null; updatedAt: string; stale: boolean }`
  - `const EMPTY_SHARED_STATUS: SharedStatusSnapshot`
  - `function useSharedStatus(): SharedStatusSnapshot`
  - `function SharedStatusProvider(props: { children: React.ReactNode; pollMs?: number; value?: SharedStatusSnapshot }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/SharedStatusProvider.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { useSharedStatus, type SharedStatusSnapshot } from "./useSharedStatus";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

function rt(activeCount: number): RuntimeStatus {
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "2026-07-03T00:00:00Z" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
      conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "bim-streaming-server" },
      kit: [],
    },
    sessions: { count: 1, active_count: activeCount, participant_count: 0, items: [
      { session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 2, expected_stage_url: null, conversion_status: "ready", kit_instance_ids: [], created_at: "", updated_at: "" },
    ] },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } },
  };
}

describe("SharedStatusProvider", () => {
  let container: HTMLDivElement;
  let captured: SharedStatusSnapshot | null;
  function Probe() { captured = useSharedStatus(); return null; }

  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container); captured = null;
  });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("polls runtimeStatus once per cycle and maps sessions + null GPU + designed-null stage_matched", async () => {
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt(1));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 2, items: [
      { idempotency_key: "k1", project_id: "270", project_display_name: "270", category: "c", external_model_version_id: "v", conversion_job_id: null, status: "queued", usdc_key: null, coverage_report: null, object_key: null, detected_at: "", updated_at: "" },
      { idempotency_key: "k2", project_id: "270", project_display_name: "270", category: "c", external_model_version_id: "v", conversion_job_id: null, status: "ready", usdc_key: null, coverage_report: null, object_key: null, detected_at: "", updated_at: "" },
    ] });
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(statusSpy).toHaveBeenCalledTimes(1); // single poll, not per-child
    expect(captured?.activeSessions).toBe(1);
    expect(captured?.sessionsById["review_session_a"].participants).toBe(2);
    expect(captured?.sessionsById["review_session_a"].stage_matched).toBeNull();
    expect(captured?.gpuNodesTotal).toBeNull();
    expect(captured?.gpuNodesBusy).toBeNull();
    expect(captured?.health).toBe("ok");
    expect(captured?.conversionQueue).toBe(1); // only status ∈ {detected,queued,converting}
    expect(captured?.stale).toBe(false);
  });

  it("marks stale + unknown health when the poll fails", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("ECONNREFUSED"));
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); });
    expect(captured?.stale).toBe(true);
    expect(captured?.health).toBe("unknown");
  });

  it("uses an injected value and does not poll (test seam)", async () => {
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus");
    const fixture: SharedStatusSnapshot = { activeSessions: 5, sessionsById: {}, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "2026-07-03", stale: false };
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider value={fixture}><Probe /></SharedStatusProvider>); });
    expect(statusSpy).not.toHaveBeenCalled();
    expect(captured?.activeSessions).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SharedStatusProvider.test.tsx`
Expected: FAIL — cannot find `./SharedStatusProvider` / `./useSharedStatus`.

- [ ] **Step 3: Write the hook + types**

```ts
// web-viewer-sample/src/console/useSharedStatus.ts
import { createContext, useContext } from "react";

// UI-facing summary view (deliberately named apart from coordinatorClient.RuntimeSessionSummary to avoid
// misreading participant_count as participants). See spec §5.2.
export interface SharedSessionEntry {
  session_id: string;
  status: string;                 // verbatim echo of RuntimeSessionSummary.status
  participants?: number;          // from RuntimeSessionSummary.participant_count
  conversion?: string | null;     // from RuntimeSessionSummary.conversion_status
  stage_matched?: boolean | null; // designed permanently null (§5.2)
}

export interface SharedStatusSnapshot {
  activeSessions: number;
  sessionsById: Record<string, SharedSessionEntry>;
  gpuNodesTotal: number | null;   // null → "未取得" (runtime/status has no GPU fields, OQ3)
  gpuNodesBusy: number | null;    // null → "未取得"
  health: "ok" | "degraded" | "unknown";
  conversionQueue: number | null; // count of records with status ∈ {detected,queued,converting}
  updatedAt: string;
  stale: boolean;
}

export const EMPTY_SHARED_STATUS: SharedStatusSnapshot = {
  activeSessions: 0,
  sessionsById: {},
  gpuNodesTotal: null,
  gpuNodesBusy: null,
  health: "unknown",
  conversionQueue: null,
  updatedAt: "",
  stale: true,
};

export const SharedStatusContext = createContext<SharedStatusSnapshot>(EMPTY_SHARED_STATUS);

export function useSharedStatus(): SharedStatusSnapshot {
  return useContext(SharedStatusContext);
}
```

- [ ] **Step 4: Write the Provider**

```tsx
// web-viewer-sample/src/console/SharedStatusProvider.tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { coordinatorClient } from "./coordinatorClient";
import { EMPTY_SHARED_STATUS, SharedStatusContext, type SharedSessionEntry, type SharedStatusSnapshot } from "./useSharedStatus";

const QUEUE_STATUSES = new Set(["detected", "queued", "converting"]);

// The single place in the repo that actually runs the 5000ms auto-poll of GET /api/runtime/status
// (spec §5.1). Existing pages keep their own mount-once fetch; only this provider polls on a timer.
export function SharedStatusProvider({ children, pollMs = 5000, value }: { children: ReactNode; pollMs?: number; value?: SharedStatusSnapshot }) {
  const [snapshot, setSnapshot] = useState<SharedStatusSnapshot>(value ?? EMPTY_SHARED_STATUS);
  const aliveRef = useRef(true);

  useEffect(() => {
    if (value) return undefined; // test-injected snapshot → do not poll
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const rt = await coordinatorClient.runtimeStatus();
        let conversionQueue: number | null = null;
        try {
          const recs = await coordinatorClient.getConversionRecords(100);
          conversionQueue = recs.items.filter((r) => QUEUE_STATUSES.has(r.status)).length;
        } catch {
          conversionQueue = null; // records unavailable → 未取得, do not guess
        }
        if (!aliveRef.current) return;
        const sessionsById: Record<string, SharedSessionEntry> = {};
        for (const s of rt.sessions.items) {
          sessionsById[s.session_id] = {
            session_id: s.session_id,
            status: s.status,
            participants: s.participant_count,
            conversion: s.conversion_status,
            stage_matched: null, // designed null (§5.2)
          };
        }
        setSnapshot({
          activeSessions: rt.sessions.active_count,
          sessionsById,
          gpuNodesTotal: null, // OQ3
          gpuNodesBusy: null,
          health: rt.service.status === "ok" ? "ok" : "degraded",
          conversionQueue,
          updatedAt: new Date().toISOString(),
          stale: false,
        });
      } catch {
        if (!aliveRef.current) return;
        setSnapshot((prev) => ({ ...prev, health: "unknown", stale: true }));
      } finally {
        if (aliveRef.current) timer = setTimeout(() => { void poll(); }, pollMs);
      }
    };
    void poll();
    return () => { aliveRef.current = false; if (timer) clearTimeout(timer); };
  }, [pollMs, value]);

  return <SharedStatusContext.Provider value={value ?? snapshot}>{children}</SharedStatusContext.Provider>;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- SharedStatusProvider.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web-viewer-sample/src/console/useSharedStatus.ts web-viewer-sample/src/console/SharedStatusProvider.tsx web-viewer-sample/src/console/SharedStatusProvider.test.tsx
git commit -m "feat(console): add SharedStatusProvider single-poll + useSharedStatus hook (§5)"
```

---

## Task 4: `SharedStatusRail` component

**Files:**
- Create: `web-viewer-sample/src/console/SharedStatusRail.tsx`
- Modify: `web-viewer-sample/src/console/edge-console.css` (append `.ec-statusrail` block at end of file)
- Test: `web-viewer-sample/src/console/SharedStatusRail.test.tsx`

**Interfaces:**
- Consumes: `useSharedStatus()` (Task 3), `buildHandoff` + `AxisKey` (Task 1), `t()` from `./i18n`.
- Produces (relied on by Task 5): `function SharedStatusRail(props: { activeAxis: AxisKey }): JSX.Element`. Reads the snapshot internally via `useSharedStatus()`; renders `data-testid="shared-status-rail"` with `data-stale`.

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/SharedStatusRail.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SharedStatusRail } from "./SharedStatusRail";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { type SharedStatusSnapshot } from "./useSharedStatus";

const base: SharedStatusSnapshot = { activeSessions: 3, sessionsById: {}, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: 2, updatedAt: "2026-07-03T01:00:00Z", stale: false };

function renderRail(container: HTMLElement, value: SharedStatusSnapshot) {
  const root = createRoot(container);
  act(() => { root.render(<SharedStatusProvider value={value}><SharedStatusRail activeAxis="a1" /></SharedStatusProvider>); });
  return root;
}

describe("SharedStatusRail honesty rendering", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); });

  it("shows real active sessions and queue", () => {
    renderRail(container, base);
    expect(container.querySelector('[data-testid="rail-sessions-value"]')?.textContent).toBe("3");
    expect(container.querySelector('[data-testid="rail-queue-value"]')?.textContent).toBe("2");
  });

  it("renders 未取得 for null GPU (not a green light)", () => {
    renderRail(container, base);
    const gpu = container.querySelector('[data-testid="rail-gpu-value"]');
    expect(gpu?.textContent).toContain("未取得");
  });

  it("dims the whole rail and shows 資料過期 when stale", () => {
    renderRail(container, { ...base, stale: true });
    const rail = container.querySelector('[data-testid="shared-status-rail"]');
    expect(rail?.getAttribute("data-stale")).toBe("true");
    expect(rail?.textContent).toContain("資料過期");
  });

  it("shows grey unknown (not ok/fail) when health is unknown", () => {
    renderRail(container, { ...base, health: "unknown" });
    const h = container.querySelector('[data-testid="rail-health-value"]');
    expect(h?.className).toContain("health-unknown");
    expect(h?.textContent).not.toContain("ok");
  });

  it("GPU metric navigates to #instances via handoff", () => {
    renderRail(container, base);
    const btn = container.querySelector('[data-testid="rail-gpu"]') as HTMLButtonElement;
    act(() => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash.startsWith("#instances?source=a1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SharedStatusRail.test.tsx`
Expected: FAIL — cannot find `./SharedStatusRail`.

- [ ] **Step 3: Write the component**

```tsx
// web-viewer-sample/src/console/SharedStatusRail.tsx
import { buildHandoff, type AxisKey } from "./handoff";
import { useSharedStatus } from "./useSharedStatus";
import { t } from "./i18n";

// One shared status/evidence rail mounted at EdgeConsole top level, visible on every page (spec §5.3).
// Single source of truth = GET /api/runtime/status via SharedStatusProvider. null → 未取得, stale → dim.
export function SharedStatusRail({ activeAxis }: { activeAxis: AxisKey }) {
  const s = useSharedStatus();
  const notAvail = t("未取得", "not available");
  const gpu = s.gpuNodesTotal == null || s.gpuNodesBusy == null ? notAvail : `${s.gpuNodesBusy}/${s.gpuNodesTotal}`;
  const queue = s.conversionQueue == null ? notAvail : String(s.conversionQueue);
  const healthLabel = s.health === "ok" ? "ok" : s.health === "degraded" ? "degraded" : t("未取得（unknown）", "unknown");
  const go = (target: AxisKey) => { window.location.hash = buildHandoff(target, { source: activeAxis }); };

  return (
    <div className={`ec-statusrail ${s.stale ? "stale" : ""}`} data-testid="shared-status-rail" data-active-axis={activeAxis} data-stale={s.stale ? "true" : "false"}>
      <button className="ec-statusrail-item" data-testid="rail-sessions" title="GET /api/runtime/status" onClick={() => go("sessions")}>
        <span className="ec-statusrail-k">{t("使用中 session", "Active sessions")}</span>
        <span className="ec-statusrail-v" data-testid="rail-sessions-value">{s.activeSessions}</span>
      </button>
      <button className="ec-statusrail-item" data-testid="rail-gpu" title={t("GPU 遙測待建（1 GPU = 1 stream）", "GPU telemetry not built (1 GPU = 1 stream)")} onClick={() => go("instances")}>
        <span className="ec-statusrail-k">GPU</span>
        <span className={`ec-statusrail-v ${s.gpuNodesTotal == null ? "muted" : ""}`} data-testid="rail-gpu-value">{gpu}</span>
      </button>
      <button className="ec-statusrail-item" data-testid="rail-health" onClick={() => go("runtime")}>
        <span className="ec-statusrail-k">Health</span>
        <span className={`ec-statusrail-v health-${s.health}`} data-testid="rail-health-value">{healthLabel}</span>
      </button>
      <span className="ec-statusrail-item">
        <span className="ec-statusrail-k">{t("轉檔佇列", "Conversion queue")}</span>
        <span className={`ec-statusrail-v ${s.conversionQueue == null ? "muted" : ""}`} data-testid="rail-queue-value">{queue}</span>
      </span>
      <span className="ec-statusrail-item" data-testid="rail-updated">
        <span className="ec-statusrail-k">{t("資料時間", "Updated")}</span>
        <span className="ec-statusrail-v">{s.stale ? t("資料過期", "stale") : (s.updatedAt || "—")}</span>
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Append minimal CSS (visual only; tests do not depend on it)**

Append to the end of `web-viewer-sample/src/console/edge-console.css`:

```css
/* Shared status/evidence rail (seven-axis harmony §5). Visual only — tests key on data-testid. */
.ec-statusrail { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding: 4px 8px; }
.ec-statusrail.stale { opacity: 0.55; }
.ec-statusrail-item { display: inline-flex; gap: 6px; align-items: baseline; background: none; border: 0; color: inherit; cursor: pointer; font: inherit; }
.ec-statusrail-item:not(button) { cursor: default; }
.ec-statusrail-k { font-size: 11px; opacity: 0.7; }
.ec-statusrail-v { font-weight: 600; }
.ec-statusrail-v.muted { opacity: 0.6; font-weight: 400; }
.ec-statusrail-v.health-unknown { opacity: 0.6; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- SharedStatusRail.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add web-viewer-sample/src/console/SharedStatusRail.tsx web-viewer-sample/src/console/SharedStatusRail.test.tsx web-viewer-sample/src/console/edge-console.css
git commit -m "feat(console): add SharedStatusRail with honest null/stale rendering (§5.3/§5.4)"
```

---

## Task 5: Mount Provider + Rail in `EdgeConsole`

**Files:**
- Modify: `web-viewer-sample/src/console/EdgeConsole.tsx` (function `EdgeConsole`, lines 163–264; add imports at top; wrap the returned tree; insert Rail in `ec-mainhead` near line 222)
- Test: `web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx`

**Interfaces:**
- Consumes: `SharedStatusProvider` (Task 3), `SharedStatusRail` (Task 4), `type AxisKey` (Task 1).
- Produces: rail rendered on every page; exactly one provider/poll for the whole console.

- [ ] **Step 1: Run impact, then write the failing test**

Run first (N4 discipline): `impact({target: "EdgeConsole", direction: "upstream"})`. Proceed only if not HIGH/CRITICAL.

```tsx
// web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "./EdgeConsole";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

const RT: RuntimeStatus = {
  service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "" },
  configured_endpoints: {
    coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
    viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
    conversion_authority: { base_url: "", authority: "" }, kit: [],
  },
  sessions: { count: 0, active_count: 0, participant_count: 0, items: [] },
  kit_instance_bindings: [], ifc_ready_jobs: { count: 0, recent: [] },
  observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } },
};

describe("EdgeConsole mounts shared status rail once", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); window.location.hash = "#a1"; });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("renders the rail and polls runtimeStatus once for the whole console", async () => {
    const spy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(RT);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(container.querySelector('[data-testid="shared-status-rail"]')).not.toBeNull();
    // A1 page also fetches runtimeStatus once on mount; the provider adds exactly one more. The rail must
    // not multiply polling per page — assert provider poll count stays bounded (<= 2: A1 mount + provider).
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- EdgeConsole.sharedstatus.test.tsx`
Expected: FAIL — no `shared-status-rail` in the DOM.

- [ ] **Step 3: Add imports**

At the top of `EdgeConsole.tsx`, after the existing `import { KitConsolePage }`/`RealIfcConsolePage` imports (line 33):

```tsx
import { SharedStatusProvider } from "./SharedStatusProvider";
import { SharedStatusRail } from "./SharedStatusRail";
import type { AxisKey } from "./handoff";
```

- [ ] **Step 4: Compute the active axis and wrap the tree**

Inside `EdgeConsole()`, after `const prompts = ...` (line 180), add:

```tsx
  const AXIS_SET: readonly AxisKey[] = ["a1", "conv", "sessions", "instances", "minio", "intake", "runtime"];
  const railAxis: AxisKey = (AXIS_SET as readonly string[]).includes(page) ? (page as AxisKey)
    : page === "gpu" || page === "review" ? "runtime" : "a1";
```

This is exactly two surgical edits; do NOT modify anything between the two new lines (the entire existing header/nav/main/aside/footer JSX stays byte-for-byte):

Edit A — insert one line immediately after `return (` (line 182), directly above the existing `<div className={\`ec-root ...\`}>`:

```tsx
    <SharedStatusProvider>
```

Edit B — insert one line immediately after that `<div>`'s matching closing `</div>` (the last one before `);` at line 262), directly below it:

```tsx
    </SharedStatusProvider>
```

Result (structure only — the inner `ec-root` div and all its existing children are untouched):

```tsx
  return (
    <SharedStatusProvider>
      <div className={`ec-root ${agentOpen ? "" : "ec-agent-collapsed"} ${theme === "light" ? "theme-light" : ""}`}>
        {/* existing header / nav / main / aside / footer — DO NOT EDIT */}
      </div>
    </SharedStatusProvider>
  );
```

- [ ] **Step 5: Insert the rail into `ec-mainhead`**

In the `<div className="ec-mainhead">` block (line 221), immediately after `<FlowBar ... />` (line 222), add:

```tsx
          <SharedStatusRail activeAxis={railAxis} />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- EdgeConsole.sharedstatus.test.tsx`
Expected: PASS. Then run the existing route test to confirm no regression: `npm test -- unified-console-routes` (if a matching vitest exists) and `npm run build`.

- [ ] **Step 7: Commit**

```bash
git add web-viewer-sample/src/console/EdgeConsole.tsx web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx
git commit -m "feat(console): mount SharedStatusProvider + rail at EdgeConsole top level"
```

---

## Task 6: A1 axis cross-link chips (→ #minio, → #sessions)

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx` (function `A1GovernanceWorkbenchPage`; (a) insert chips in the Deliverables Panel, right after the review-room button IIFE that ends at line 707, before the `actionErr` line 708; (b) upgrade the existing `a1-conv-link` anchor at line 604 to carry `source=a1`/`job_id`)
- Test: `web-viewer-sample/src/console/A1CrossLinks.test.tsx`

**Interfaces:**
- Consumes: `buildHandoff` (Task 1); existing A1 scope vars `selectedKey` (selected MinIO object key), `selectedSession` (selected review session id), `convJobId` (conversion job id from line 603, may be `null`).
- Produces: evidence-typed chips `a1-link-minio`, `a1-link-sessions` (disabled until the id exists); upgraded existing `a1-conv-link` (now `#conv?source=a1[&job_id=…]`, was a bare `#/conv`) — the §4.3 A1 → CV row is marked **既有連結，補帶 source/id**, so it must be updated, not left untouched.

- [ ] **Step 1: Write the failing test (SSR smoke — deterministic, no mocks)**

```tsx
// web-viewer-sample/src/console/A1CrossLinks.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A1GovernanceWorkbenchPage } from "./pages";

describe("A1 cross-link chips", () => {
  it("renders #minio and #sessions chips, disabled before any selection (evidence-typed)", () => {
    const html = renderToString(<A1GovernanceWorkbenchPage />);
    // Parse the SSR string into a DOM so `disabled` is asserted per-button, INDEPENDENT of JSX
    // prop-serialization order. `Btn` (components.tsx:113) renders `disabled` BEFORE `data-testid`
    // and nothing follows `data-testid` except `>`, so a regex like
    // /data-testid="a1-link-minio"[^>]*disabled/ can NEVER match the real markup even when the button
    // is correctly disabled. Use a DOM query (order-independent, same approach as every other task).
    const doc = new DOMParser().parseFromString(html, "text/html");
    const minio = doc.querySelector('[data-testid="a1-link-minio"]');
    const sessions = doc.querySelector('[data-testid="a1-link-sessions"]');
    expect(minio).not.toBeNull();
    expect(sessions).not.toBeNull();
    // No selection on server render → both chips must be disabled (no fake enabled navigation).
    expect((minio as HTMLButtonElement).disabled).toBe(true);
    expect((sessions as HTMLButtonElement).disabled).toBe(true);
  });

  it("upgrades the existing a1-conv-link to carry source=a1 (spec §4.3 A1 → CV 『既有連結，補帶 source/id』)", () => {
    const html = renderToString(<A1GovernanceWorkbenchPage />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const convLink = doc.querySelector('[data-testid="a1-conv-link"]');
    expect(convLink).not.toBeNull();
    const href = convLink?.getAttribute("href") ?? "";
    expect(href.startsWith("#conv")).toBe(true); // canonical hash (no slash), replacing the old #/conv
    expect(href).toContain("source=a1");         // receiver (CV, Task 14) reads source; job_id appended when a conv job exists
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- A1CrossLinks.test.tsx`
Expected: FAIL — testids not found.

- [ ] **Step 3: Import the util**

Ensure `pages.tsx` imports `buildHandoff` — add to the top imports if not present:

```tsx
import { buildHandoff } from "./handoff";
```

- [ ] **Step 4: Insert the chips**

In `A1GovernanceWorkbenchPage`, in the Deliverables `<Panel>`, immediately after the review-room button block closes (`})()}{" "}` at line 707) and before `{actionErr && ...}` (line 708), add:

```tsx
        <span className="ec-crosslinks" data-testid="a1-crosslinks" style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", marginLeft: 8 }}>
          <Btn
            data-testid="a1-link-minio"
            disabled={!selectedKey}
            caption={selectedKey ? t("回看 MinIO 來源物件", "View the source object in MinIO") : t("尚未選取 MinIO 物件", "No MinIO object selected")}
            onClick={() => { if (!selectedKey) return; window.location.hash = buildHandoff("minio", { source: "a1", minio_key: selectedKey }); }}
          >
            {t("MinIO 來源 →", "MinIO source →")}
          </Btn>
          <Btn
            data-testid="a1-link-sessions"
            disabled={!selectedSession}
            caption={selectedSession ? t("在 Session 管理檢視此 session", "View this session in Session Management") : t("尚未選取 review session", "No review session selected")}
            onClick={() => { if (!selectedSession) return; window.location.hash = buildHandoff("sessions", { source: "a1", session: selectedSession }); }}
          >
            {t("Session 管理 →", "Session Management →")}
          </Btn>
        </span>{" "}
```

- [ ] **Step 4b: Upgrade the existing `a1-conv-link` to carry `source` (spec §4.3)**

The §4.3 matrix marks the A1 → CV row **既有連結（`a1-conv-link`），補帶 source/id** — it must be upgraded, not left as a bare `#/conv`. Change the existing anchor at `pages.tsx:604` from:

```tsx
              <a className="ec-s" data-testid="a1-conv-link" href="#/conv">{t("到 IFC→USD 轉檔排程查看詳情 →", "View details in the conversion schedule →")}</a>
```

to build the hash via `buildHandoff` (carrying the in-scope `convJobId` from line 603 when present):

```tsx
              <a className="ec-s" data-testid="a1-conv-link" href={buildHandoff("conv", { source: "a1", job_id: convJobId ?? undefined })}>{t("到 IFC→USD 轉檔排程查看詳情 →", "View details in the conversion schedule →")}</a>
```

`buildHandoff` omits `job_id` when it is empty/undefined, so with no conversion yet the href is `#conv?source=a1`; after a trigger it becomes `#conv?source=a1&job_id=<convJobId>`. The receiving CV page re-verifies this id (Task 14). Note the canonical hash drops the legacy slash (`#/conv` → `#conv`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- A1CrossLinks.test.tsx`
Expected: PASS (2 tests). Also run `npm test -- A1ViewerEmbed` to confirm the A1 no-embed contract still holds.

- [ ] **Step 6: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/A1CrossLinks.test.tsx
git commit -m "feat(a1): add #minio / #sessions cross-link chips (evidence-typed)"
```

---

## Task 7: CV axis — conversion history panel + cross-link chips

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx` (function `ConversionSchedulingPage`, lines 826–1281): add a history panel; add a `#minio` chip in the ledger row Control cell (near line 1139); add a `#sessions`/`#review` chip in the ifc-ready job row (near the `session` cell at line 1208)
- Test: `web-viewer-sample/src/console/ConversionHistory.test.tsx`

**Interfaces:**
- Consumes: `coordinatorClient.getConversionsHistory()` (Task 2); `buildHandoff` (Task 1); existing per-row fields `ConversionRecord.object_key` (line 341, may be `null`) and `IfcReadyListItem.review_session_id` (line 220, may be `null`).
- Produces: `conv-history-panel` (prov=`artifact`, honest empty/error), `conv-ledger-minio-<idem>`, `conv-job-session-<jobid>`.

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/ConversionHistory.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversionSchedulingPage } from "./pages";
import { coordinatorClient } from "./coordinatorClient";

describe("CV conversion history panel + cross-links", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  function stubBase() {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
  }

  it("renders the history panel with pass-through items (artifact)", async () => {
    stubBase();
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [{ conversion_job_id: "cj_9", status: "succeeded" }], count: 1 });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-history-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("cj_9");
  });

  it("history panel degrades honestly when the endpoint fails (no fake rows)", async () => {
    stubBase();
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockRejectedValue(new Error("404"));
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const panel = container.querySelector('[data-testid="conv-history-panel"]');
    expect(panel?.textContent).toContain("未取得");
  });

  // Steps 5 & 6 add three data-testids that are ~half this task's diff; assert them here so nothing in the
  // task's commit is unverified (this task is committed as one unit — every added chip must be covered).
  it("renders evidence-typed cross-link chips on ledger + ifc-ready rows and navigates with source=conv", async () => {
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [
      { idempotency_key: "mw_led1", project_id: "270", project_display_name: "270", category: "建築", external_model_version_id: "v1", conversion_job_id: "cj_1", status: "ready", usdc_key: null, coverage_report: null, object_key: "270專案/建築/v07/模型.ifc", detected_at: "", updated_at: "" },
    ] });
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [
      { ifc_ready_job_id: "job_1", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_1", dispatch_error: null, review_session_id: "review_session_a", viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "" },
    ] } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // ledger row → #minio chip (evidence-typed: only when object_key exists), keyed by idempotency_key
    expect(container.querySelector('[data-testid="conv-ledger-minio-mw_led1"]')).not.toBeNull();
    // ifc-ready row → #sessions / #review chips (only when review_session_id exists), keyed by ifc_ready_job_id
    expect(container.querySelector('[data-testid="conv-job-session-job_1"]')).not.toBeNull();
    const toReview = container.querySelector('[data-testid="conv-job-review-job_1"]') as HTMLButtonElement | null;
    expect(toReview).not.toBeNull();
    await act(async () => { toReview!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#review?source=conv");
    expect(window.location.hash).toContain("session=review_session_a");
  });
});
```

> **Task-decomposition note:** this task adds three things — a history panel (Steps 3–4) and two families of cross-link chips (Steps 5–6). They are committed together, so the test above covers **all three** (panel + the three chip testids), keeping the task independently verifiable. (An equally valid alternative the implementer may choose is to split into two tasks — "CV history panel" and "CV cross-link chips" — each with its own red→green; either way, no chip may land without an assertion.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ConversionHistory.test.tsx`
Expected: FAIL — no `conv-history-panel`.

- [ ] **Step 3: Add history state + effect**

In `ConversionSchedulingPage`, add state near the other `useState` declarations (top of the function body around line 827) and a load effect:

```tsx
  const [history, setHistory] = useState<import("./coordinatorClient").DevConversionRecord[] | null>(null);
  const [historyErr, setHistoryErr] = useState(false);
  useEffect(() => {
    let alive = true;
    coordinatorClient.getConversionsHistory()
      .then((r) => { if (alive) { setHistory(r.items); setHistoryErr(false); } })
      .catch(() => { if (alive) { setHistory(null); setHistoryErr(true); } });
    return () => { alive = false; };
  }, []);
```

- [ ] **Step 4: Render the history panel**

Add this Panel just before the closing `</>` of `ConversionSchedulingPage`'s return (after the existing `Ifc-ready jobs` panel, i.e. after line 1155's `</Panel>` region — place it as the last Panel):

```tsx
      <Panel title={t("轉檔歷史（conversion service pass-through）", "Conversion history (conversion-service pass-through)")} sub="GET /api/dev/conversions" prov="artifact">
        <div data-testid="conv-history-panel">
          {historyErr ? (
            <p className="ec-note">{t("未取得（GET /api/dev/conversions 無法讀取或此環境未啟用）", "not available (GET /api/dev/conversions is unavailable or disabled in this environment)")}</p>
          ) : history == null ? (
            <p className="ec-note">{t("載入中…", "Loading…")}</p>
          ) : history.length === 0 ? (
            <p className="ec-note">{t("目前無轉檔歷史紀錄（非錯誤）。", "No conversion history at the moment (not an error).")}</p>
          ) : (
            <table className="ec-table">
              <thead><tr><th>conversion_job_id</th><th>status</th><th>created_at</th></tr></thead>
              <tbody>
                {history.slice(0, 50).map((h, i) => (
                  <tr key={h.conversion_job_id ?? `h-${i}`} data-testid={`conv-history-row-${h.conversion_job_id ?? i}`}>
                    <td>{h.conversion_job_id ?? "—"}</td>
                    <td>{h.status ?? "—"}</td>
                    <td>{h.created_at ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
```

- [ ] **Step 5: Add the ledger → #minio chip**

In the ledger row Control cell (line 1139–1147), inside the `<td>`, after the existing trigger button conditional, add:

```tsx
                      {r.object_key ? (
                        <Btn
                          data-testid={`conv-ledger-minio-${r.idempotency_key}`}
                          caption={t("回看 MinIO 來源物件", "View source object in MinIO")}
                          onClick={() => { window.location.hash = buildHandoff("minio", { source: "conv", minio_key: r.object_key as string, conversion_id: r.conversion_job_id ?? undefined }); }}
                        >{t("來源 →", "Source →")}</Btn>
                      ) : null}
```

- [ ] **Step 6: Add the job → #sessions/#review chip**

In the ifc-ready job row, change the session cell (line 1208 `<td>{j.review_session_id ?? "—"}</td>`) to include chips:

```tsx
                  <td>
                    {j.review_session_id ?? "—"}
                    {j.review_session_id ? (
                      <>
                        {" "}
                        <Btn data-testid={`conv-job-session-${j.ifc_ready_job_id}`} caption={t("在 Session 管理檢視", "View in Session Management")}
                          onClick={() => { window.location.hash = buildHandoff("sessions", { source: "conv", session: j.review_session_id as string }); }}>SS →</Btn>
                        {" "}
                        <Btn data-testid={`conv-job-review-${j.ifc_ready_job_id}`} caption={t("在 Review Room 開此 session", "Open this session in Review Room")}
                          onClick={() => { window.location.hash = buildHandoff("review", { source: "conv", session: j.review_session_id as string }); }}>Review →</Btn>
                      </>
                    ) : null}
                  </td>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- ConversionHistory.test.tsx`
Expected: PASS (3 tests: history panel, honest-degrade, cross-link chips). Also `npm test -- ConversionSchedulingPage` to confirm no regression on existing CV tests.

- [ ] **Step 8: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/ConversionHistory.test.tsx
git commit -m "feat(conv): add conversion-history panel + #minio / #sessions|#review chips"
```

---

## Task 8: SS axis — per-row cross-link chips

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx` (function `SessionManagementPage`, lines 1282–1382; add chips inside the Active-sessions row action cell around line 1356–1359)
- Test: `web-viewer-sample/src/console/SessionCrossLinks.test.tsx`

**Design note:** SS keeps its own mount-once `runtimeStatus` fetch (unchanged, N6). The chips read `s.session_id` from the page's existing rows — no `useSharedStatus` coupling needed; the shared-status surface is the global rail (Task 5), also present on `#sessions`.

**Interfaces:**
- Consumes: `buildHandoff` (Task 1); existing row var `s` (`RuntimeSessionSummary`, `s.session_id`).
- Produces: `session-link-instances-<id>`, `session-link-review-<id>`, `session-link-a1-<id>`.

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/SessionCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManagementPage } from "./pages";
import { coordinatorClient, type RuntimeStatus, type RuntimeSessionSummary } from "./coordinatorClient";

const mk = (over: Partial<RuntimeSessionSummary>): RuntimeSessionSummary => ({ session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 1, expected_stage_url: null, conversion_status: null, kit_instance_ids: [], created_at: "", updated_at: "", ...over });
const status = (items: RuntimeSessionSummary[]): RuntimeStatus => ({ service: { status: "ok", name: "c", uptime_seconds: 1, generated_at: "" }, configured_endpoints: { coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" }, viewer: { browser_url_base: "", handoff_path: "/" }, conversion_authority: { base_url: "", authority: "" }, kit: [] }, sessions: { count: items.length, active_count: items.length, participant_count: 0, items }, kit_instance_bindings: [], ifc_ready_jobs: { count: 0, recent: [] }, observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } } });

describe("SS per-row cross-link chips", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("renders instances/review/a1 chips per session and navigates with source=sessions", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mk({ session_id: "review_session_a" })]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="session-link-instances-review_session_a"]')).not.toBeNull();
    const review = container.querySelector('[data-testid="session-link-review-review_session_a"]') as HTMLButtonElement;
    expect(review).not.toBeNull();
    await act(async () => { review.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#review?source=sessions");
    expect(window.location.hash).toContain("session=review_session_a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SessionCrossLinks.test.tsx`
Expected: FAIL — chip testids not found.

- [ ] **Step 3: Insert the chips**

In `SessionManagementPage`, replace the action `<td>` (line 1357–1359) so it keeps the terminate button and appends the cross-link chips:

```tsx
                  <td>
                    {s.status === "active" && !terminating ? (
                      <Btn data-testid={`session-terminate-${s.session_id}`} onClick={() => { setActionErr(null); setPendingTerminate({ sessionId: s.session_id }); }}>{t("結束 session", "Terminate session")}</Btn>
                    ) : <span className="ec-note">{terminating ? t("結束中…", "Terminating…") : "—"}</span>}
                    {" "}
                    <Btn data-testid={`session-link-instances-${s.session_id}`} caption={t("此 session 落在哪個 GPU node（KG 遙測未取得）", "Which GPU node hosts this session (KG telemetry not available)")}
                      onClick={() => { window.location.hash = buildHandoff("instances", { source: "sessions", session: s.session_id }); }}>KG →</Btn>
                    {" "}
                    <Btn data-testid={`session-link-review-${s.session_id}`} caption={t("在 Review Room 開此 session", "Open this session in Review Room")}
                      onClick={() => { window.location.hash = buildHandoff("review", { source: "sessions", session: s.session_id }); }}>Review →</Btn>
                    {" "}
                    <Btn data-testid={`session-link-a1-${s.session_id}`} caption={t("回 A1 治理檢核", "Back to A1 governance")}
                      onClick={() => { window.location.hash = buildHandoff("a1", { source: "sessions", session: s.session_id }); }}>A1 →</Btn>
                  </td>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- SessionCrossLinks.test.tsx`
Expected: PASS. Also `npm test -- SessionManagementPage` to confirm terminate flow unaffected.

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/SessionCrossLinks.test.tsx
git commit -m "feat(sessions): add per-row #instances / #review / #a1 cross-link chips"
```

---

## Task 9: KG axis — real session aggregation row + demo-row chip

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx` (function `KitGpuFleetPage`, lines 1384–1406; add a real aggregate Panel above the demo "Node snapshot" Panel; add a chip on demo rows)
- Test: `web-viewer-sample/src/console/KitGpuFleetCrossLinks.test.tsx`

**Design note:** KG currently has NO fetch (100% static). It becomes a consumer of `useSharedStatus()` for the real session aggregate (asbuilt), clearly separated from the demo table which stays `prov="demo"` (N5 — do not fake it as real).

**Interfaces:**
- Consumes: `useSharedStatus()` (Task 3), `buildHandoff` (Task 1).
- Produces: `kg-live-aggregate` (real session count + ids, asbuilt), `kg-demo-link-sessions` (demo→#sessions nav).

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/KitGpuFleetCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KitGpuFleetPage } from "./pages";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { type SharedStatusSnapshot } from "./useSharedStatus";

const snap: SharedStatusSnapshot = { activeSessions: 2, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" }, review_session_b: { session_id: "review_session_b", status: "active" } }, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "2026-07-03", stale: false };

describe("KG real aggregate + demo separation", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); });

  it("shows a real session aggregate (asbuilt) and keeps the demo table as demo", () => {
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    const agg = container.querySelector('[data-testid="kg-live-aggregate"]');
    expect(agg?.textContent).toContain("2");
    // demo table still present and still labeled demo (Node snapshot panel), not faked as real
    expect(container.textContent).toContain("edge-gpu-01");
    expect(container.querySelector('[data-testid="kg-demo-link-sessions"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- KitGpuFleetCrossLinks.test.tsx`
Expected: FAIL — `kg-live-aggregate` not found.

- [ ] **Step 3: Import the hook + util (top of `pages.tsx` if not present)**

```tsx
import { useSharedStatus } from "./useSharedStatus";
```

- [ ] **Step 4: Add the aggregate Panel + demo chip**

Change `KitGpuFleetPage` to read shared status and add the real aggregate Panel before the `Fleet model` Panel; add a chip in the demo table's `operation` cell. Full function:

```tsx
export function KitGpuFleetPage() {
  const shared = useSharedStatus();
  const liveIds = Object.keys(shared.sessionsById);
  return (
    <>
      <h1>{t("Kit / GPU 機隊", "Kit / GPU Fleet")}</h1>
      <p className="ec-lead">{t("此頁是 runtime operator 的機隊視角：哪台 GPU 在服務哪個 Kit stream，哪台可接新 session，哪些節點 drain，哪些 restart/release 必須由 Kit Manager 執行。", "This page is the runtime operator's fleet view: which GPU serves which Kit stream, which can accept a new session, which nodes are draining, and which restart/release must be executed by the Kit Manager.")}</p>
      <Panel title={t("即時 session 聚合（真實）", "Live session aggregate (real)")} sub={t("讀共享狀態列（GET /api/runtime/status）；GPU per-node 遙測未取得，故只呈現 session 聚合，不假裝映射到節點", "Reads the shared status rail (GET /api/runtime/status); GPU per-node telemetry is not available, so only the session aggregate is shown, not a fake node mapping")} prov="asbuilt">
        <div className="ec-grid" data-testid="kg-live-aggregate">
          <Field k={t("使用中 session 數", "active sessions")} v={String(shared.activeSessions)} prov="asbuilt" />
          <Field k="GPU busy / total" v={t("未取得（kit-manager 遙測待建）", "not available (kit-manager telemetry not built)")} prov="demo" />
        </div>
        {liveIds.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {liveIds.map((id) => (
              <Btn key={id} data-testid={`kg-session-link-${id}`} caption={t("在 Session 管理檢視", "View in Session Management")}
                onClick={() => { window.location.hash = buildHandoff("sessions", { source: "instances", session: id }); }}>{id} →</Btn>
            ))}
          </div>
        ) : <p className="ec-note">{t("目前無使用中 session（來自共享狀態列）。", "No active session at the moment (from the shared status rail).")}</p>}
      </Panel>
      <Panel title="Fleet model" sub={t("Coordinator 顯示治理狀態，不直接管理 GPU process", "Coordinator shows governance state and does not directly manage the GPU process")} prov="asbuilt">
        <div className="ec-grid">
          <MiniCard code="1 GPU" title="1 GPU = 1 Kit stream" desc={t("primary 使用獨立 Kit stream；spectator 預設共享同一 stream，除非未來需求是獨立視角。", "Primary uses a dedicated Kit stream; spectators share the same stream by default unless a future requirement needs independent views.")} prov="asbuilt" />
          <MiniCard code="drain" title={t("排空不接新 session", "Drain accepts no new session")} desc={t("drain 後 existing session 可跑完；新 session 不再派到該節點。", "After drain, existing sessions can finish; new sessions are no longer assigned to that node.")} prov="p1" />
          <MiniCard code="move" title={t("搬移不是無縫遷移", "Move is not seamless migration")} desc={t("拖 session 到另一台 GPU 表示 terminate + recreate，約 30-40s 並重載 stage。", "Dragging a session to another GPU means terminate + recreate, about 30-40s and reloading the stage.")} prov="p1" />
        </div>
      </Panel>
      <Panel title="Node snapshot" sub={t("實際 GPU/VRAM 遙測仍需 kit-manager-api / runtime manager 提供", "Actual GPU/VRAM telemetry still needs to be provided by kit-manager-api / runtime manager")} prov="demo">
        <table className="ec-table"><thead><tr><th>node</th><th>GPU</th><th>state</th><th>operation</th></tr></thead><tbody>
          <tr><td>edge-gpu-01</td><td>L40 · 48GB</td><td>running · S-270</td><td>drain / restart intent{" "}
            <Btn data-testid="kg-demo-link-sessions" caption={t("到 Session 管理（demo 對照）", "Go to Session Management (demo reference)")}
              onClick={() => { window.location.hash = buildHandoff("sessions", { source: "instances" }); }}>SS →</Btn></td></tr>
          <tr><td>edge-gpu-02</td><td>L40 · 48GB</td><td>running · S-899</td><td>drain / restart intent</td></tr>
          <tr><td>edge-gpu-03</td><td>RTX 6000 · 48GB</td><td>idle</td><td>assign pending session</td></tr>
        </tbody></table>
        <p className="ec-note">{t("此表為 prototype fleet model 的 UI evidence；真實 restart/release 必須送 audited intent 給 Kit Manager，不能由 coordinator/browser 直接做。", "This table is UI evidence of the prototype fleet model; real restart/release must send an audited intent to the Kit Manager and cannot be done directly by coordinator/browser.")}</p>
      </Panel>
    </>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- KitGpuFleetCrossLinks.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/KitGpuFleetCrossLinks.test.tsx
git commit -m "feat(instances): add live session aggregate row + demo→#sessions chip (demo table unchanged)"
```

---

## Task 10: M axis — `.ifc` object cross-link chips (→ #conv, → #a1)

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx` (function `MinioDataPage`; inside the `obj.role === "source_ifc"` block at lines 1697–1715, after the existing trigger button)
- Test: `web-viewer-sample/src/console/MinioCrossLinks.test.tsx`

**Interfaces:**
- Consumes: `buildHandoff` (Task 1); existing row var `obj` (`MinioObject`, `obj.key` may contain Chinese), `idk` (`obj.idempotency_key`).
- Produces: `minio-link-conv-<idk>`, `minio-link-a1-<idk>` (both carry the encoded `minio_key`).

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/MinioCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinioDataPage } from "./pages";
import { coordinatorClient, type MinioFolderListing } from "./coordinatorClient";
import { parseHandoff } from "./handoff";

const CN_KEY = "270專案/建築/v07/模型.ifc";
const folder: MinioFolderListing = { bucket: "bim-control", prefix: "", folders: [], count: 1, objects: [
  { key: CN_KEY, etag: "e1", role: "source_ifc", project_id: "270", project_display_name: "270", category: "建築", version: "v07", idempotency_key: "mw_abc" },
] };

describe("M .ifc cross-link chips with Chinese key round-trip", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("navigates to #conv carrying the exact Chinese minio_key", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folder);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const chip = container.querySelector('[data-testid="minio-link-conv-mw_abc"]') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    await act(async () => { chip.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const parsed = parseHandoff(window.location.hash);
    expect(parsed?.source).toBe("minio");
    expect(parsed?.minio_key).toBe(CN_KEY); // exact round-trip through encode → hash → decode
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- MinioCrossLinks.test.tsx`
Expected: FAIL — `minio-link-conv-mw_abc` not found.

- [ ] **Step 3: Insert the chips**

In `MinioDataPage`, inside the `obj.role === "source_ifc" ? (<> ... </>)` fragment (lines 1697–1715), after the trigger `<Btn>` closes (line 1713), add:

```tsx
                          <Btn
                            data-testid={`minio-link-conv-${idk}`}
                            caption={t("查看此物件的轉檔", "View this object's conversion")}
                            onClick={() => { window.location.hash = buildHandoff("conv", { source: "minio", minio_key: obj.key }); }}
                          >{t("轉檔 →", "Conversion →")}</Btn>
                          <Btn
                            data-testid={`minio-link-a1-${idk}`}
                            caption={t("拿此檔到 A1 治理檢核", "Take this file to A1 governance")}
                            onClick={() => { window.location.hash = buildHandoff("a1", { source: "minio", minio_key: obj.key }); }}
                          >{t("A1 檢核 →", "A1 governance →")}</Btn>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- MinioCrossLinks.test.tsx`
Expected: PASS. Also `npm test -- minio-closed-loop` (if a matching vitest exists) and `npm test -- MinioDataPage` to confirm the folder view + trigger flow is unaffected.

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/MinioCrossLinks.test.tsx
git commit -m "feat(minio): add .ifc #conv / #a1 chips with Chinese-key round-trip"
```

---

## Task 11: IN axis — job-row cross-link chips (→ #conv, → #review)

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx` (function `IntakePage`, lines 2869–2920; add a chip cell to the intake job table row at lines 2899–2905)
- Test: `web-viewer-sample/src/console/IntakeCrossLinks.test.tsx`

**Interfaces:**
- Consumes: `buildHandoff` (Task 1); existing row var `j` (`IfcReadyListItem`, `j.ifc_ready_job_id`, `j.review_session_id` may be `null`).
- Produces: `intake-link-conv-<jobid>` (carries `job_id`), `intake-link-review-<jobid>` (carries `session`, disabled/absent when no session).

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/IntakeCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakePage } from "./pages";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";

const job = (over: Partial<IfcReadyListItem>): IfcReadyListItem => ({ ifc_ready_job_id: "job_1", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_1", dispatch_error: null, review_session_id: "review_session_a", viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "", ...over });

describe("IN job-row cross-link chips", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("renders #conv (job_id) always and #review (session) when review_session_id exists", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job({})] });
    const root = createRoot(container);
    await act(async () => { root.render(<IntakePage />); });
    await act(async () => { await Promise.resolve(); });

    const conv = container.querySelector('[data-testid="intake-link-conv-job_1"]') as HTMLButtonElement;
    expect(conv).not.toBeNull();
    await act(async () => { conv.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#conv?source=intake");
    expect(window.location.hash).toContain("job_id=job_1");
    expect(container.querySelector('[data-testid="intake-link-review-job_1"]')).not.toBeNull();
  });

  it("omits the #review chip when the job has no review_session_id (no fake nav)", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job({ ifc_ready_job_id: "job_2", review_session_id: null })] });
    const root = createRoot(container);
    await act(async () => { root.render(<IntakePage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="intake-link-conv-job_2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="intake-link-review-job_2"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- IntakeCrossLinks.test.tsx`
Expected: FAIL — chip testids not found.

- [ ] **Step 3: Add a chip column**

In `IntakePage`, add a header cell to the table `<thead>` (line 2897) — append `<th>{t("跨頁", "Links")}</th>` after the `session` header. Then in the row (after line 2903 `<td>{j.review_session_id ?? "—"}</td>`), add a new cell:

```tsx
                  <td>
                    <Btn data-testid={`intake-link-conv-${j.ifc_ready_job_id}`} caption={t("到轉檔排程排此 job", "Schedule this job in Conversion")}
                      onClick={() => { window.location.hash = buildHandoff("conv", { source: "intake", job_id: j.ifc_ready_job_id }); }}>CV →</Btn>
                    {j.review_session_id ? (
                      <>
                        {" "}
                        <Btn data-testid={`intake-link-review-${j.ifc_ready_job_id}`} caption={t("在 Review Room 開此 job 的 session", "Open this job's session in Review Room")}
                          onClick={() => { window.location.hash = buildHandoff("review", { source: "intake", session: j.review_session_id as string }); }}>Review →</Btn>
                      </>
                    ) : null}
                  </td>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- IntakeCrossLinks.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/IntakeCrossLinks.test.tsx
git commit -m "feat(intake): add job-row #conv / #review cross-link chips"
```

---

## Task 12: RT axis — cross-link session panel in `CoordinatorPage`

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx` (function `CoordinatorPage`, lines 2841–2864; add a cross-link Panel after `<CoordinatorGovernanceTabs .../>` at line 2861)
- Test: `web-viewer-sample/src/console/CoordinatorCrossLinks.test.tsx`

**Design note:** The AtcTab rows in `coordinator/RuntimeGovernanceTabs.tsx` are endpoint/role-keyed, not clean session rows, so adding chips there is not safe or additive. Instead the RT chips live in a new Panel in `CoordinatorPage` (the `#runtime` route target), which already fetches `rt` and owns `rt.sessions.items`. This is the faithful, low-risk interpretation of spec §7 "RT session 列補 chip"; RT's shared-status consumption is satisfied by the global rail (Task 5), also visible on `#runtime`.

**Interfaces:**
- Consumes: `buildHandoff` (Task 1); existing `CoordinatorPage` var `rt` (`RuntimeStatus | null`, `rt.sessions.items`).
- Produces: `rt-crosslinks` Panel with `rt-link-sessions-<id>`, `rt-link-review-<id>`, `rt-link-instances-<id>`.

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/CoordinatorCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorPage } from "./pages";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

const rt: RuntimeStatus = { service: { status: "ok", name: "c", uptime_seconds: 1, generated_at: "" }, configured_endpoints: { coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" }, viewer: { browser_url_base: "", handoff_path: "/" }, conversion_authority: { base_url: "", authority: "" }, kit: [] }, sessions: { count: 1, active_count: 1, participant_count: 0, items: [ { session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 0, expected_stage_url: null, conversion_status: null, kit_instance_ids: [], created_at: "", updated_at: "" } ] }, kit_instance_bindings: [], ifc_ready_jobs: { count: 0, recent: [] }, observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } } };

describe("RT cross-link session panel", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("lists sessions with #sessions/#review/#instances chips carrying source=runtime", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt);
    const root = createRoot(container);
    await act(async () => { root.render(<CoordinatorPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="rt-crosslinks"]')).not.toBeNull();
    const inst = container.querySelector('[data-testid="rt-link-instances-review_session_a"]') as HTMLButtonElement;
    expect(inst).not.toBeNull();
    await act(async () => { inst.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#instances?source=runtime");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- CoordinatorCrossLinks.test.tsx`
Expected: FAIL — `rt-crosslinks` not found.

- [ ] **Step 3: Insert the Panel**

In `CoordinatorPage`, after `<CoordinatorGovernanceTabs rt={rt} busy={busy} err={err} onRefresh={load} />` (line 2861), before the closing `</>`:

```tsx
      <Panel title={t("跨頁 session 連結", "Cross-page session links")} sub={t("值班視圖：把 runtime session 帶到 Session 管理 / Review Room / Kit 機隊（同一份 runtime 真相）", "Duty view: take a runtime session to Session Management / Review Room / Kit Fleet (one runtime truth)")} prov="asbuilt">
        <div data-testid="rt-crosslinks">
          {(rt?.sessions.items ?? []).length === 0 ? (
            <p className="ec-note">{t("目前 runtime status 無 session。", "Runtime status currently has no session.")}</p>
          ) : (
            <table className="ec-table"><thead><tr><th>session</th><th>status</th><th>{t("跨頁", "Links")}</th></tr></thead>
              <tbody>{(rt?.sessions.items ?? []).map((s) => (
                <tr key={s.session_id}>
                  <td>{s.session_id}</td><td>{s.status}</td>
                  <td>
                    <Btn data-testid={`rt-link-sessions-${s.session_id}`} caption={t("Session 管理", "Session Management")}
                      onClick={() => { window.location.hash = buildHandoff("sessions", { source: "runtime", session: s.session_id }); }}>SS →</Btn>{" "}
                    <Btn data-testid={`rt-link-review-${s.session_id}`} caption={t("在 Review Room 開此 session", "Open in Review Room")}
                      onClick={() => { window.location.hash = buildHandoff("review", { source: "runtime", session: s.session_id }); }}>Review →</Btn>{" "}
                    <Btn data-testid={`rt-link-instances-${s.session_id}`} caption={t("Kit / GPU 機隊", "Kit / GPU Fleet")}
                      onClick={() => { window.location.hash = buildHandoff("instances", { source: "runtime", session: s.session_id }); }}>KG →</Btn>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </Panel>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- CoordinatorCrossLinks.test.tsx`
Expected: PASS. Also `npm test -- co-console-runtime-merge` (if a matching vitest exists) to confirm the four-tab console is unaffected.

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/CoordinatorCrossLinks.test.tsx
git commit -m "feat(runtime): add cross-page session-links panel in CoordinatorPage"
```

---

## Task 13: Review Room — seed session input candidates from shared status

**Files:**
- Modify: `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx` (function `ReviewSessionViewerPane`, lines 87–378; add a `<datalist>` seeded from `useSharedStatus()`, wired to the existing `review-room-session-input` at line 253)
- Test: `web-viewer-sample/src/console/ReviewSessionViewerPane.crosslinks.test.tsx`

**Design note (N3):** Do NOT touch `claimPrimary`, lease/heartbeat effects, `sendHighlight`, or the EmbeddedViewer wiring. The pane keeps its own `runtimeStatus` fetch for lease gating; the shared status is used ONLY to seed the input's candidate `<datalist>` (additive; the input stays a free-text field).

**Interfaces:**
- Consumes: `useSharedStatus()` (Task 3).
- Produces: `<datalist id="review-room-session-candidates" data-testid="review-room-session-candidates">` with one `<option>` per `sessionsById` key; the input gains `list="review-room-session-candidates"`.

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/ReviewSessionViewerPane.crosslinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewSessionViewerPane, parseReviewRoomHandoff } from "./ReviewSessionViewerPane";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { coordinatorClient } from "./coordinatorClient";
import { type SharedStatusSnapshot } from "./useSharedStatus";

const snap: SharedStatusSnapshot = { activeSessions: 1, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" } }, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "", stale: false };

describe("Review Room session candidate seeding (additive, N3-safe)", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("renders a datalist of shared-status sessions and keeps the input free-text; no lease claim on mount", async () => {
    const claimSpy = vi.spyOn(coordinatorClient, "claimViewerLease");
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [] }, configured_endpoints: { viewer: { browser_url_base: "" }, coordinator: { public_base_url: "" } } } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider value={snap}><ReviewSessionViewerPane handoff={{ source: "sessions", sessionId: "", ruleRunId: null, ifcGuid: null, usdPrimPath: null, ruleCode: null, severity: null, label: null, expectedStageUrl: null }} /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); });

    const datalist = container.querySelector('[data-testid="review-room-session-candidates"]');
    expect(datalist).not.toBeNull();
    expect(datalist?.querySelector('option[value="review_session_a"]')).not.toBeNull();
    const input = container.querySelector('[data-testid="review-room-session-input"]');
    expect(input?.getAttribute("list")).toBe("review-room-session-candidates");
    expect(claimSpy).not.toHaveBeenCalled(); // N3: no auto-claim
  });

  // The new §4.3 chips send source=conv/sessions/intake/runtime to #review. Prove the EXISTING Review Room
  // parser (parseReviewRoomHandoff, ReviewSessionViewerPane.tsx:31) accepts non-a1 sources — it reads the
  // same snake_case URL keys and does not gate on source value — so these chips are actually consumed, not
  // silently dropped. (Without this, "#review works" was only ever verified for source=a1.)
  it("accepts non-a1 handoff sources so CV/SS/IN/RT → #review chips are actually consumed", () => {
    for (const source of ["conv", "sessions", "intake", "runtime"]) {
      const parsed = parseReviewRoomHandoff(`#review?source=${source}&session=review_session_a`);
      expect(parsed.source).toBe(source);
      expect(parsed.sessionId).toBe("review_session_a");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ReviewSessionViewerPane.crosslinks.test.tsx`
Expected: FAIL — no datalist.

- [ ] **Step 3: Read shared status inside the pane**

At the top of `ReviewSessionViewerPane` (after line 87 `export function ReviewSessionViewerPane(...) {` and the existing `useState` block), add the import at the top of the file:

```tsx
import { useSharedStatus } from "./useSharedStatus";
```

and inside the component body (near the other hooks, e.g. after line 102 `const viewerRef = useRef<...>(null);`):

```tsx
  const shared = useSharedStatus();
  const sessionCandidates = Object.keys(shared.sessionsById);
```

- [ ] **Step 4: Wire the input + datalist**

Add `list="review-room-session-candidates"` to the existing `<input ... data-testid="review-room-session-input" ...>` (line 253). Immediately after that `<input .../>` closes (line 269), add:

```tsx
          <datalist id="review-room-session-candidates" data-testid="review-room-session-candidates">
            {sessionCandidates.map((id) => <option key={id} value={id} />)}
          </datalist>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- ReviewSessionViewerPane.crosslinks.test.tsx`
Expected: PASS. Also run `npm test -- ReviewSessionViewerPane` (the existing suite from the decouple spec) to confirm lease/highlight behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add web-viewer-sample/src/console/ReviewSessionViewerPane.tsx web-viewer-sample/src/console/ReviewSessionViewerPane.crosslinks.test.tsx
git commit -m "feat(review): seed session input candidates from shared status (N3-safe datalist)"
```

---

## Task 14: Receiver-side handoff re-verification (parseHandoff on receiving pages)

**Why this task exists:** the spec makes receiver-side re-verification a **hard** rule — §4.2「接收端重驗鐵律」(labelled 硬性), §12 Route/Handoff「§4.3 每條跳轉…接收端重驗 ID；查無 → not found + 手動重選，不靜默 fallback」, and §13 acceptance「接收端一律以 ID 重驗」. Tasks 6–12 build only the **sender** half (chips that navigate). The only page that currently reacts to an incoming handoff is Review Room — and only by luck, because its existing `parseReviewRoomHandoff` happens to read the same snake_case URL keys (Task 13 proves it also accepts non-a1 sources). Every other receiving page (M, A1, CV, SS, KG) would ignore the incoming id entirely — half a handoff contract. This task adds the receiver half: parse on mount, re-verify the carried id against data the page **already** fetched from its authoritative endpoint, and render an honest verified / not-found banner with **no silent fallback**. IN is a sender-only axis in the §4.3 matrix — do NOT add a receiver there.

**Files:**
- Create: `web-viewer-sample/src/console/incomingHandoff.tsx` — shared `useIncomingHandoff()` hook + `IncomingHandoffBanner` component. All the re-verify + honest-render logic lives here, so each page wiring is a one-liner and the core logic is tested once.
- Create: `web-viewer-sample/src/console/incomingHandoff.test.tsx`
- Modify: `web-viewer-sample/src/console/pages.tsx` — wire the banner into the 5 receiving pages: `MinioDataPage`, `A1GovernanceWorkbenchPage`, `ConversionSchedulingPage`, `SessionManagementPage`, `KitGpuFleetPage`.

**Interfaces:**
- Consumes: `parseHandoff` + `CrossAxisHandoff` + `AxisKey` (Task 1); each page's already-fetched authoritative list (no new fetch, no new endpoint — N2/N4).
- Produces: `useIncomingHandoff(selfAxis, verify, hash?)` → `{ handoff, status }`, `status ∈ "none" | "verified" | "not_found"`; `IncomingHandoffBanner` rendering a testid with `data-handoff-status` / `data-handoff-source`; per-page banners `minio-incoming-handoff`, `a1-incoming-handoff`, `conv-incoming-handoff`, `sessions-incoming-handoff`, `kg-incoming-handoff`.

- [ ] **Step 1: Write the failing test**

```tsx
// web-viewer-sample/src/console/incomingHandoff.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncomingHandoffBanner, useIncomingHandoff } from "./incomingHandoff";
import { MinioDataPage, SessionManagementPage } from "./pages";
import { coordinatorClient, type MinioFolderListing, type RuntimeStatus, type RuntimeSessionSummary } from "./coordinatorClient";

// ---- shared primitive: re-verify + honest render, no silent fallback (this fully covers the logic) ----
describe("useIncomingHandoff re-verifies the carried id (spec §4.2)", () => {
  function Probe({ hash, ok }: { hash: string; ok: boolean }) {
    const inc = useIncomingHandoff("minio", () => ok, hash);
    return <IncomingHandoffBanner testId="probe-banner" handoff={inc.handoff} status={inc.status} />;
  }
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); });

  it("renders nothing when the hash carries no handoff for this axis", () => {
    const root = createRoot(container);
    act(() => { root.render(<Probe hash="#minio" ok={true} />); });
    expect(container.querySelector('[data-testid="probe-banner"]')).toBeNull();
  });
  it("marks verified when the id is found in authoritative data", () => {
    const root = createRoot(container);
    act(() => { root.render(<Probe hash="#minio?source=a1&minio_key=270/x.ifc" ok={true} />); });
    const b = container.querySelector('[data-testid="probe-banner"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("verified");
    expect(b?.getAttribute("data-handoff-source")).toBe("a1");
  });
  it("marks not_found (honest, no silent fallback) when the id is absent", () => {
    const root = createRoot(container);
    act(() => { root.render(<Probe hash="#minio?source=a1&minio_key=missing.ifc" ok={false} />); });
    const b = container.querySelector('[data-testid="probe-banner"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("not_found");
    expect(b?.textContent).toContain("未"); // honest 未找到 / 未靜默 fallback wording
  });
});

// ---- page wiring: each receiving page re-verifies against data it already fetched ----
const CN_KEY = "270專案/建築/v07/模型.ifc";
const folder: MinioFolderListing = { bucket: "bim-control", prefix: "", folders: [], count: 1, objects: [
  { key: CN_KEY, etag: "e1", role: "source_ifc", project_id: "270", project_display_name: "270", category: "建築", version: "v07", idempotency_key: "mw_abc" },
] };
const mkSession = (over: Partial<RuntimeSessionSummary>): RuntimeSessionSummary => ({ session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 1, expected_stage_url: null, conversion_status: null, kit_instance_ids: [], created_at: "", updated_at: "", ...over });
const status = (items: RuntimeSessionSummary[]): RuntimeStatus => ({ service: { status: "ok", name: "c", uptime_seconds: 1, generated_at: "" }, configured_endpoints: { coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" }, viewer: { browser_url_base: "", handoff_path: "/" }, conversion_authority: { base_url: "", authority: "" }, kit: [] }, sessions: { count: items.length, active_count: items.length, participant_count: 0, items }, kit_instance_bindings: [], ifc_ready_jobs: { count: 0, recent: [] }, observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } } });

describe("receiving pages re-verify the incoming handoff id", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = ""; });

  it("M verifies a real incoming minio_key (found in the loaded folder listing)", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folder);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="minio-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
  });

  it("SS flags an incoming session that is not in runtime status as not_found (no silent fallback to act[0])", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mkSession({ session_id: "review_session_a" })]));
    window.location.hash = "#sessions?source=conv&session=review_session_ZZZ";
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="sessions-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- incomingHandoff.test.tsx`
Expected: FAIL — cannot find `./incomingHandoff`.

- [ ] **Step 3: Write the shared hook + banner**

```tsx
// web-viewer-sample/src/console/incomingHandoff.tsx
import { parseHandoff, type AxisKey, type CrossAxisHandoff } from "./handoff";
import { t } from "./i18n";

export type HandoffVerifyStatus = "none" | "verified" | "not_found";

// Receiver-side re-verification (spec §4.2「接收端重驗鐵律」): read the incoming handoff for THIS axis and
// re-check the carried id against data the page already fetched from its authoritative endpoint. The verify
// predicate must query already-in-memory authoritative data only — no new fetch, no new endpoint (N2/N4).
// Never silently fall back to an unrelated record; surface an honest not_found and let the user reselect.
export function useIncomingHandoff(
  selfAxis: AxisKey,
  verify: (h: CrossAxisHandoff) => boolean,
  hash: string = typeof window !== "undefined" ? window.location.hash : "",
): { handoff: CrossAxisHandoff | null; status: HandoffVerifyStatus } {
  const handoff = parseHandoff(hash);
  // only react to a handoff whose target route is THIS page (hash begins with #<selfAxis>)
  if (!handoff || !hash.startsWith(`#${selfAxis}`)) return { handoff: null, status: "none" };
  return { handoff, status: verify(handoff) ? "verified" : "not_found" };
}

function handoffIdText(h: CrossAxisHandoff): string {
  return h.session ?? h.minio_key ?? h.job_id ?? h.conversion_id ?? h.rule_run_id ?? h.prefix ?? "";
}

export function IncomingHandoffBanner({ testId, handoff, status }: { testId: string; handoff: CrossAxisHandoff | null; status: HandoffVerifyStatus }) {
  if (!handoff || status === "none") return null;
  const id = handoffIdText(handoff);
  return (
    <div className={`ec-note ${status === "not_found" ? "ec-warn-note" : ""}`} data-testid={testId} data-handoff-status={status} data-handoff-source={handoff.source}>
      {status === "verified"
        ? t(`已接收來自 ${handoff.source} 的 ${id}（已向權威端點重驗）`, `Received ${id} from ${handoff.source} (re-verified against the authoritative endpoint)`)
        : t(`來自 ${handoff.source} 的 ${id} 在權威資料中查無，請手動重選（未靜默 fallback）`, `${id} from ${handoff.source} was not found in authoritative data; please reselect (no silent fallback)`)}
    </div>
  );
}
```

- [ ] **Step 4: Wire the banner into each receiving page**

Add `import { useIncomingHandoff, IncomingHandoffBanner } from "./incomingHandoff";` to `pages.tsx`. Each wiring is: call `useIncomingHandoff` with a verify predicate over the list the page **already** holds (bind to the real in-memory state var — the exact names are visible in each page's own task, Tasks 6–12), then render `<IncomingHandoffBanner>` near the top of that page's returned tree. Add **no** new fetch.

- **M** (`MinioDataPage`, receives A1→M / CV→M) — verify `minio_key`/`prefix` against the loaded folder listing:
```tsx
  const incoming = useIncomingHandoff("minio", (h) => {
    if (h.prefix) return true; // navigating to a prefix is a valid intent; the folder load re-verifies contents
    return !!h.minio_key && (folder?.objects ?? []).some((o) => o.key === h.minio_key);
  });
  // …render near the top of the returned tree:
  <IncomingHandoffBanner testId="minio-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
```
- **A1** (`A1GovernanceWorkbenchPage`, receives M→A1) — verify `minio_key` against the objects backing `a1-minio-select`; testId `a1-incoming-handoff`.
- **CV** (`ConversionSchedulingPage`, receives A1→CV / M→CV / IN→CV) — verify `job_id` against the ifc-ready list, and `minio_key`/`conversion_id` against the ledger records (all already fetched); testId `conv-incoming-handoff`.
- **SS** (`SessionManagementPage`, receives A1→SS / CV→SS / RT→SS) — verify `session` against the runtime-status items already fetched; testId `sessions-incoming-handoff`.
- **KG** (`KitGpuFleetPage`, receives SS→KG / RT→KG) — verify `session` against `useSharedStatus().sessionsById`; testId `kg-incoming-handoff`.

All five reuse the identical shared component; only the axis, verify predicate, and testId differ. Because 100% of the branch/render logic lives in `useIncomingHandoff`/`IncomingHandoffBanner` (fully covered by Step 1's first describe block), the per-page wiring is a one-liner — Step 1's page-integration block asserts M (verified) and SS (not_found) end-to-end as representatives of the minio_key and session id families; A1/CV/KG follow the same pattern.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- incomingHandoff.test.tsx`
Expected: PASS. Then confirm no regression on the receiving pages' own suites: `npm test -- MinioCrossLinks SessionCrossLinks ConversionHistory A1CrossLinks KitGpuFleetCrossLinks`.

- [ ] **Step 6: Commit**

```bash
git add web-viewer-sample/src/console/incomingHandoff.tsx web-viewer-sample/src/console/incomingHandoff.test.tsx web-viewer-sample/src/console/pages.tsx
git commit -m "feat(console): receiver-side handoff re-verification on M/A1/CV/SS/KG (§4.2 honest not-found, no silent fallback)"
```

---

## Task 15: Browser E2E — cross-axis handoff walk-through

**Files:**
- Create: `web-viewer-sample/e2e/cross-axis-handoff.spec.ts`

**Interfaces:**
- Consumes: the deployed console at `${COORDINATOR}/ui` (env `E2E_COORDINATOR_BASE_URL`, default `http://127.0.0.1:8004`), all chips/rail/receiver banners from Tasks 4–14.
- Produces: screenshots + trace under `artifacts/e2e/` (Playwright config already routes there); vertical-slice evidence for §8.

**Prereq:** the console must be reachable (deployed test stack or a branch coordinator). Follow the repo's isolated-stack pattern if `#8004` is the deployment area. This is the user-facing evidence gate (N7).

- [ ] **Step 1: Write the E2E spec**

```ts
// web-viewer-sample/e2e/cross-axis-handoff.spec.ts
import { expect, test } from "@playwright/test";

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("seven-axis cross-page harmony", () => {
  test("shared status rail is present on every axis and GPU shows 未取得 (no fake green)", async ({ page }) => {
    for (const route of ["#a1", "#conv", "#sessions", "#instances", "#minio", "#intake", "#runtime"]) {
      await page.goto(`${COORDINATOR}/ui${route}`);
      const rail = page.getByTestId("shared-status-rail");
      await expect(rail).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("rail-gpu-value")).toContainText("未取得");
    }
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-rail-runtime.png", fullPage: true });
  });

  test("M → CV chip carries a real minio_key and lands on #conv (source=minio)", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#minio`);
    // If real MinIO objects are listed, click the first source_ifc conv chip; else honestly skip.
    const convChip = page.locator('[data-testid^="minio-link-conv-"]').first();
    const hasObjects = await convChip.count();
    test.skip(hasObjects === 0, "no MinIO source_ifc objects in this environment (not observed)");
    await convChip.click();
    await expect(page).toHaveURL(/#conv\?source=minio/, { timeout: 15_000 });
    // §12 receiver rule: CV must re-verify the incoming minio_key and show an honest verified/not-found
    // banner (Task 14) — never silently ignore the id. Assert the banner surfaces one of the two states.
    const banner = page.getByTestId("conv-incoming-handoff");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toHaveAttribute("data-handoff-status", /verified|not_found/);
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-m-to-conv.png", fullPage: true });
  });

  test("A1 has no inline WebRTC viewer; Review Room owns 3D and is not auto-claimed", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#a1`);
    // N3 gate WITH TEETH. `review-room-viewer-host` is the live-3D viewer host that ONLY Review Room
    // renders (ReviewSessionViewerPane.tsx:313) — it must be absent on #a1, and it IS asserted present-in-
    // context on #review below, so this is a real differential, not a tautology. (The previous assertion
    // keyed on `a1-embedded-viewer`, a testid that exists nowhere in the repo, so toHaveCount(0) passed
    // vacuously and guarded nothing.) The exhaustive "A1 never mounts EmbeddedViewer" guard is the existing
    // unit test A1ViewerEmbed.test.tsx (mocks EmbeddedViewer, asserts renderCount === 0); this E2E is the
    // browser-evidence complement (N7).
    await expect(page.getByTestId("review-room-viewer-host")).toHaveCount(0);
    // A1 → sessions chip is evidence-typed: disabled until a session is selected.
    await expect(page.getByTestId("a1-link-sessions")).toBeDisabled();
    await page.goto(`${COORDINATOR}/ui#review?source=a1`);
    // Review Room owns the flow: before manual start it shows kit-not-started (and would render
    // review-room-viewer-host after start) — the positive half of the differential above.
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-review-not-started.png", fullPage: true });
  });

  test("SS → Review chip navigates with the session id (re-verified, not silently defaulted)", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#sessions`);
    const reviewChip = page.locator('[data-testid^="session-link-review-"]').first();
    const hasSession = await reviewChip.count();
    test.skip(hasSession === 0, "no active session in this environment (not observed)");
    await reviewChip.click();
    await expect(page).toHaveURL(/#review\?source=sessions&.*session=/, { timeout: 15_000 });
    // Review Room does not auto-claim: the manual start control is present and the not-started note shows.
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-ss-to-review.png", fullPage: true });
  });
});
```

- [ ] **Step 2: Run the E2E (services up)**

Run: `npm run test:e2e -- cross-axis-handoff.spec.ts`
Expected: PASS or honest `skip` for the `not observed` cases (empty MinIO / no active session). Screenshots + trace land under `artifacts/e2e/`.

- [ ] **Step 3: Full verify**

Run: `npm run verify`
Expected: build + all unit tests + struct-log pass.

- [ ] **Step 4: Commit**

```bash
git add web-viewer-sample/e2e/cross-axis-handoff.spec.ts
git commit -m "test(e2e): cross-axis handoff vertical-slice walk-through (§8, N7)"
```

---

## Self-Review Checklist

- [ ] Seven routes remain seven physical pages; no route table was created (A.1.1 only) — N1.
- [ ] `handoff.ts` carries only non-secret IDs; no lease token / auth in any URL; receiving pages (M/A1/CV/SS/KG) re-verify the incoming id against their authoritative data and show honest not-found with no silent fallback — §4.2/§12/§13, N3, Task 14.
- [ ] Exactly one `SharedStatusProvider` at EdgeConsole top level polls `GET /api/runtime/status` once per cycle; rail visible on every page — §5, Task 5.
- [ ] `null` GPU → "未取得"; `stale` → dim + "資料過期"; `health="unknown"` → grey (not ok/fail); `stage_matched` stays null — §5.4, Task 4.
- [ ] `conversionQueue` counts only `status ∈ {detected,queued,converting}`, not total record count — §5.2, Task 3.
- [ ] Every axis has ≥1 evidence-typed chip covering the §4.3 matrix; chips disabled/absent when the id is missing (A1, CV, SS, KG, M, IN, RT) — Tasks 6–12.
- [ ] KG Node snapshot stays `prov="demo"`; the new aggregate row is clearly separate and `asbuilt`; no fake button/green — Task 9, N5.
- [ ] A1 mounts no `EmbeddedViewer`; Review Room owns 3D/lease/highlight; session input candidates are additive only (N3) — Task 13.
- [ ] Chinese `minio_key` round-trips exactly through encode → hash → decode (deterministic unit test in Task 1 + E2E in Task 15) — OQ4.
- [ ] Zero backend/route changes, zero frozen-file edits, zero new production dependency; diff is entirely under `web-viewer-sample/src/console/` and `web-viewer-sample/e2e/` — N2, N4, N10.
- [ ] Signature consistency: `buildHandoff(target, payload)`, `parseHandoff(hash)`, `useSharedStatus()`, `SharedStatusSnapshot` fields, and `getConversionsHistory()` are named identically everywhere they appear.
- [ ] §8 lifecycle has passing Playwright evidence (screenshot + trace under `artifacts/e2e/`); four evidence points stay distinct — N7, Task 15.

## Open Questions (carried from spec §14 — defaults are executable; do not block)

- **OQ1 doc-lag:** do NOT edit 互動實作規格 / 對齊矩陣; list the IX-A1-06/07/08 / IX-SS-05 / IX-CV-03 doc-lag in the PR description for the user to decide on a separate docs-only PR.
- **OQ2 CV history route:** implemented as a Panel inside `#conv` (no new hash route) — Task 7.
- **OQ3 GPU columns:** `gpuNodesTotal`/`gpuNodesBusy` stay `null` ("未取得"); never call kit-manager `:8010` directly.
- **OQ4 Chinese key round-trip:** deterministic part is Task 1's round-trip test; the real-proxy round-trip is the Task 15 M→CV E2E (honest skip if MinIO empty).
- **OQ5 KG capacity gate:** no pre-attach hard gate in scope; Review Room shows honest post-hoc blocked state (unchanged, N3).

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-07-03-seven-axis-cross-page-harmony.md`.

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution: execute tasks in this session using executing-plans, batch execution with checkpoints.
