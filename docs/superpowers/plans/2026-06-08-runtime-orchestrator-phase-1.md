# Runtime Orchestrator Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/ui#/coordinator` 補上 C / Hybrid Runtime Orchestrator 的四分頁外殼，並交付 A Classic Dashboard 與 B ATC Tower read-only 視角，讓 operator 能從現有 `/api/runtime/status` 看懂 runtime / endpoint / session / evidence 缺口。

**Architecture:** Phase 1 只改 `web-viewer-sample` 的 operator console，不新增 backend API，不發送 state-changing intent。新增一個純資料推導 helper，把現有 `RuntimeStatus` 轉成 dashboard / ATC row view model；新增一個 Coordinator tab component 負責 A/B/C/D UI，其中 C/D 先顯示 evidence contract 與後續操作入口，不渲染 raw JSON、不啟動真實 lifecycle control。

**Tech Stack:** React 18 + TypeScript + Vite + Vitest SSR smoke tests；資料來源限 `bim-review-coordinator :8004` 的 `GET /api/runtime/status`。

---

## Scope

本計畫只落地 Phase 1：

- A Classic Dashboard：總覽、業務語言健康狀態、技術細節折疊、導向其他 tab。
- B ATC Tower read-only：endpoint pool row、primary/spectator role、lease/viewer/stage evidence 缺口、disabled controlled actions。
- 四 tab shell：`A Classic Dashboard | B ATC Tower | C Lifecycle Flow | D Terminal / Debug`。
- 保留誠實原則：沒有 browser first-frame evidence 就不得顯示 `occupied`；沒有 loaded stage evidence 就不得顯示 `stage matched`。

本計畫不做：

- 不新增 `/api/runtime/evidence` 或 viewer evidence reporter。
- 不新增 restart / release / reclaim 寫入 API。
- 不直接呼叫 `kit-manager-api`。
- 不改 `bim-streaming-server` 的 USD / WebRTC runtime。
- 不把 raw JSON 放到 A Classic Dashboard。

## File Structure

- Create: `web-viewer-sample/src/console/coordinator/runtimeGovernance.ts`
  - Pure helper。輸入 `RuntimeStatus | null`，輸出 dashboard health、endpoint ATC rows、readiness/evidence wording。
  - 不使用 React、不呼叫 network，方便單元測試。

- Create: `web-viewer-sample/src/console/coordinator/runtimeGovernance.test.ts`
  - Vitest unit tests。驗證 `ready Kit binding` 仍只能是 `waiting_first_frame`，endpoint row 不會被推成 `occupied`。

- Create: `web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx`
  - React component。接 `rt / busy / err / onRefresh`，渲染四個 tab。
  - A/B 使用 `runtimeGovernance.ts` 的 view model。
  - C/D 在 Phase 1 顯示 contract 與 evidence categories，不顯示 fake lifecycle data。

- Modify: `web-viewer-sample/src/console/pages.tsx`
  - 將 `CoordinatorPage` 現有三個 panel 換成 `CoordinatorGovernanceTabs`。
  - 保留既有 `load()`、`/api/runtime/status`、`:8004 only` lead wording。

- Modify: `web-viewer-sample/src/console/edge-console.css`
  - 新增 tab、status dot、ATC table/wrap、details 的樣式。
  - 沿用現有深色 console palette，不新增 UI library。

- Modify: `web-viewer-sample/src/console/console.test.tsx`
  - 更新 Coordinator smoke test，確認四 tab、readiness wording、ATC rule wording、無 fake first-frame。

## Contract

Phase 1 UI SHALL make these constraints visible:

- `Open primary URL` 不等於 endpoint `occupied`。
- `Open spectator URL` 不等於 endpoint `occupied`。
- `occupied` 必須等 browser `first_frame_at` evidence。
- Stage ready 必須等 `expected_stage_url == loaded_stage_url` evidence。
- Coordinator 只能顯示狀態、套用 policy、建立 session、發 audited intent、接 evidence、寫 audit log；不能變成 GPU process manager。

Phase 1 UI SHALL NOT:

- 因為 `KitInstance.status === "ready"` 就顯示 `可審查模型已就緒`。
- 因為 endpoint 有 binding 就顯示 `occupied`。
- 因為 session 有 `expected_stage_url` 就顯示 `stage matched`。
- 在 Classic Dashboard 顯示 raw JSON 或 stack trace。

---

### Task 1: Runtime Governance Helper

**Files:**
- Create: `web-viewer-sample/src/console/coordinator/runtimeGovernance.ts`
- Test: `web-viewer-sample/src/console/coordinator/runtimeGovernance.test.ts`

- [ ] **Step 1: Create folder**

Run:

```powershell
New-Item -ItemType Directory -Force web-viewer-sample/src/console/coordinator
```

Expected: directory exists; no production behavior changes.

- [ ] **Step 2: Write failing helper tests**

Create `web-viewer-sample/src/console/coordinator/runtimeGovernance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RuntimeStatus } from "../coordinatorClient";
import { buildEndpointRows, deriveClassicDashboard } from "./runtimeGovernance";

function sampleRuntime(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    service: { status: "ok", name: "bim-review-coordinator", uptime_seconds: 12, generated_at: "2026-06-08T00:00:00Z" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:8004/ui", handoff_path: "/ui/open" },
      conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "bim-streaming-server" },
      kit: [
        { id: "kit_local_001", signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 47998 },
        { id: "kit_spectator_001", signalingServer: "127.0.0.1", signalingPort: 49110, mediaServer: "127.0.0.1", mediaPort: 47999 },
      ],
    },
    sessions: {
      count: 1,
      active_count: 1,
      participant_count: 1,
      items: [{
        session_id: "review_session_demo",
        status: "active",
        project_id: "project_demo",
        model_version_id: "mv_demo",
        participant_count: 1,
        expected_stage_url: "http://127.0.0.1:49101/artifacts/model.usdc",
        conversion_status: "ready",
        kit_instance_ids: ["kit_local_001"],
        created_at: "2026-06-08T00:00:00Z",
        updated_at: "2026-06-08T00:00:03Z",
      }],
    },
    kit_instance_bindings: [{
      session_id: "review_session_demo",
      kit_instance_id: "kit_local_001",
      status: "ready",
      assigned_artifact_ids: ["auto_usdc_demo"],
      started_at: "2026-06-08T00:00:01Z",
      last_heartbeat_at: "2026-06-08T00:00:05Z",
      released_at: null,
    }],
    ifc_ready_jobs: { count: 1, recent: [] },
    observations: {
      classification: "host_native",
      note: "read-only",
      web_plane: { coordinator_port: 8004, viewer_port: 5173 },
      host_native_plane: { conversion_api_base: "http://127.0.0.1:49101", kit_signal_ports: [49100, 49110], kit_media_ports: [47998, 47999] },
    },
    ...overrides,
  };
}

describe("runtime governance derivation", () => {
  it("marks null runtime as red disconnected", () => {
    const dashboard = deriveClassicDashboard(null);
    expect(dashboard.overall.tone).toBe("red");
    expect(dashboard.overall.label).toContain("Runtime 無法連線");
    expect(buildEndpointRows(null)).toHaveLength(0);
  });

  it("does not mark ready Kit binding as occupied without browser first frame", () => {
    const rows = buildEndpointRows(sampleRuntime());
    expect(rows[0]).toMatchObject({
      role: "primary",
      leaseState: "connected",
      firstFrame: "not_observed",
      stageTruth: "not_observed",
      readiness: "waiting_first_frame",
    });
    expect(rows[0].businessStatus).toContain("等待第一幀畫面");
  });

  it("summarizes active session with no browser evidence as yellow", () => {
    const dashboard = deriveClassicDashboard(sampleRuntime());
    expect(dashboard.overall.tone).toBe("yellow");
    expect(dashboard.overall.label).toContain("等待第一幀畫面");
    expect(dashboard.viewerEvidence.value).toBe("未取得 first-frame evidence");
    expect(dashboard.stageTruth.value).toBe("stage loaded 未觀測");
  });

  it("maps configured kit endpoints even when no lease exists", () => {
    const rt = sampleRuntime({ kit_instance_bindings: [] });
    const rows = buildEndpointRows(rt);
    expect(rows.map((r) => r.code)).toEqual(["PRI", "SPC"]);
    expect(rows[0].leaseState).toBe("free");
    expect(rows[1].leaseState).toBe("free");
  });
});
```

- [ ] **Step 3: Run helper test and verify it fails**

Run:

```powershell
Set-Location web-viewer-sample
npm test -- src/console/coordinator/runtimeGovernance.test.ts
```

Expected: FAIL because `./runtimeGovernance` does not exist.

- [ ] **Step 4: Implement helper**

Create `web-viewer-sample/src/console/coordinator/runtimeGovernance.ts`:

```ts
import { RuntimeKitBinding, RuntimeSessionSummary, RuntimeStatus } from "../coordinatorClient";

export type HealthTone = "green" | "yellow" | "red";
export type EndpointRole = "primary" | "spectator";
export type LeaseState = "free" | "reserved" | "signaling" | "connected" | "draining" | "released" | "failed";
export type EvidenceState = "ok" | "not_observed" | "missing" | "failed";
export type EndpointReadiness = "free" | "waiting_runtime" | "waiting_first_frame" | "occupied" | "releasable" | "failed";

export interface HealthLine {
  tone: HealthTone;
  label: string;
  detail: string;
}

export interface ClassicDashboardSummary {
  overall: HealthLine;
  kitRuntime: HealthLine;
  endpointPool: { value: string; detail: string };
  activeSessions: { value: string; detail: string };
  viewerEvidence: { value: string; detail: string };
  stageTruth: { value: string; detail: string };
  recentRisk: HealthLine;
}

export interface EndpointRow {
  code: "PRI" | "SPC";
  endpointId: string;
  port: number;
  role: EndpointRole;
  leaseState: LeaseState;
  sessionId: string;
  kitInstanceId: string;
  firstFrame: EvidenceState;
  heartbeat: EvidenceState;
  stageTruth: EvidenceState;
  readiness: EndpointReadiness;
  businessStatus: string;
  nextAllowedAction: string;
  technicalDetail: string;
}

function activeSessionForBinding(rt: RuntimeStatus, binding: RuntimeKitBinding | undefined): RuntimeSessionSummary | undefined {
  if (!binding) return undefined;
  return rt.sessions.items.find((session) => session.session_id === binding.session_id);
}

function bindingToLeaseState(binding: RuntimeKitBinding | undefined): LeaseState {
  if (!binding) return "free";
  if (binding.status === "allocated") return "reserved";
  if (binding.status === "starting") return "signaling";
  if (binding.status === "ready") return "connected";
  if (binding.status === "draining") return "draining";
  if (binding.status === "released") return "released";
  if (binding.status === "failed") return "failed";
  return "reserved";
}

function readinessForLease(leaseState: LeaseState): EndpointReadiness {
  if (leaseState === "free" || leaseState === "released") return "free";
  if (leaseState === "reserved" || leaseState === "signaling") return "waiting_runtime";
  if (leaseState === "connected") return "waiting_first_frame";
  if (leaseState === "draining") return "releasable";
  return "failed";
}

function businessStatusFor(readiness: EndpointReadiness): string {
  if (readiness === "free") return "可分配";
  if (readiness === "waiting_runtime") return "等待 Runtime 回證";
  if (readiness === "waiting_first_frame") return "等待第一幀畫面";
  if (readiness === "occupied") return "可審查模型已就緒";
  if (readiness === "releasable") return "可回收";
  return "Runtime 無法連線";
}

function nextAllowedActionFor(row: Pick<EndpointRow, "role" | "readiness">): string {
  if (row.readiness === "free") return row.role === "primary" ? "Open primary URL" : "Open spectator URL";
  if (row.readiness === "waiting_first_frame" && row.role === "spectator") return "Reclaim stale spectator if timeout";
  if (row.readiness === "releasable") return "Release after audit";
  if (row.readiness === "failed") return "Force release / restart requires reason";
  return "Observe evidence";
}

export function buildEndpointRows(rt: RuntimeStatus | null): EndpointRow[] {
  if (!rt) return [];
  return rt.configured_endpoints.kit.map((endpoint, index) => {
    const role: EndpointRole = index === 0 ? "primary" : "spectator";
    const binding = rt.kit_instance_bindings.find((item) => item.kit_instance_id === endpoint.id);
    const session = activeSessionForBinding(rt, binding);
    const leaseState = bindingToLeaseState(binding);
    const readiness = readinessForLease(leaseState);
    return {
      code: role === "primary" ? "PRI" : "SPC",
      endpointId: `${role === "primary" ? "PRI" : "SPC"} :${endpoint.signalingPort}`,
      port: endpoint.signalingPort,
      role,
      leaseState,
      sessionId: binding?.session_id ?? "—",
      kitInstanceId: endpoint.id,
      firstFrame: readiness === "free" ? "missing" : "not_observed",
      heartbeat: binding?.last_heartbeat_at ? "ok" : readiness === "free" ? "missing" : "not_observed",
      stageTruth: session?.expected_stage_url ? "not_observed" : "missing",
      readiness,
      businessStatus: businessStatusFor(readiness),
      nextAllowedAction: nextAllowedActionFor({ role, readiness }),
      technicalDetail: `kit_instance=${endpoint.id}; media=${endpoint.mediaPort ?? "unknown"}; session=${binding?.session_id ?? "none"}`,
    };
  });
}

export function deriveClassicDashboard(rt: RuntimeStatus | null): ClassicDashboardSummary {
  if (!rt) {
    return {
      overall: { tone: "red", label: "● 紅 Runtime 無法連線", detail: "coordinator /api/runtime/status 尚未取得" },
      kitRuntime: { tone: "red", label: "Runtime 無法連線", detail: "尚未取得 Kit runtime summary" },
      endpointPool: { value: "未取得", detail: "等待 /api/runtime/status" },
      activeSessions: { value: "未取得", detail: "等待 coordinator summary" },
      viewerEvidence: { value: "未取得 first-frame evidence", detail: "browser-side evidence 尚未進入 Phase 1 summary" },
      stageTruth: { value: "stage loaded 未觀測", detail: "expected stage 與 loaded stage 尚未同時具備" },
      recentRisk: { tone: "red", label: "Runtime 無法連線", detail: "先確認 coordinator :8004 與 Kit runtime" },
    };
  }

  const rows = buildEndpointRows(rt);
  const failedRows = rows.filter((row) => row.readiness === "failed");
  const waitingFirstFrameRows = rows.filter((row) => row.readiness === "waiting_first_frame");
  const occupiedRows = rows.filter((row) => row.readiness === "occupied");
  const freeRows = rows.filter((row) => row.readiness === "free");
  const activeSessions = rt.sessions.active_count;

  const overall: HealthLine =
    failedRows.length > 0
      ? { tone: "red", label: "● 紅 Runtime 無法連線", detail: `${failedRows.length} endpoint failed` }
      : waitingFirstFrameRows.length > 0 || activeSessions > 0
        ? { tone: "yellow", label: "● 黃 等待第一幀畫面", detail: "Kit-side ready 不等於 browser first-frame ready" }
        : { tone: "green", label: "● 綠 無待處理 runtime 風險", detail: "目前沒有 active session 或 endpoint blockage" };

  const kitRuntime: HealthLine =
    rt.service.status === "ok"
      ? { tone: "green", label: "Coordinator summary 可讀取", detail: `${rt.service.name} uptime ${rt.service.uptime_seconds}s` }
      : { tone: "red", label: "Coordinator summary 狀態異常", detail: `service.status=${rt.service.status}` };

  return {
    overall,
    kitRuntime,
    endpointPool: {
      value: `${occupiedRows.length} occupied / ${waitingFirstFrameRows.length} waiting / ${freeRows.length} free`,
      detail: `configured endpoints=${rows.length}`,
    },
    activeSessions: {
      value: `${rt.sessions.active_count} active / ${rt.sessions.count} total`,
      detail: `${rt.sessions.participant_count} participants observed by coordinator`,
    },
    viewerEvidence: {
      value: occupiedRows.length > 0 ? `${occupiedRows.length} first-frame OK` : "未取得 first-frame evidence",
      detail: "Phase 1 尚無 browser-side first_frame_at 欄位；不得宣稱 occupied",
    },
    stageTruth: {
      value: occupiedRows.length > 0 ? "stage matched" : "stage loaded 未觀測",
      detail: "Phase 1 只有 expected_stage_url；loaded_stage_url 需 Kit/browser evidence",
    },
    recentRisk: overall,
  };
}
```

- [ ] **Step 5: Run helper tests and verify they pass**

Run:

```powershell
Set-Location web-viewer-sample
npm test -- src/console/coordinator/runtimeGovernance.test.ts
```

Expected: PASS, including `does not mark ready Kit binding as occupied without browser first frame`.

- [ ] **Step 6: Commit helper**

Run:

```powershell
git add web-viewer-sample/src/console/coordinator/runtimeGovernance.ts web-viewer-sample/src/console/coordinator/runtimeGovernance.test.ts
git commit -m "feat: derive coordinator runtime governance state"
```

Expected: commit includes only the helper and helper test.

---

### Task 2: Coordinator Four-Tab Component

**Files:**
- Create: `web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx`
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Test: `web-viewer-sample/src/console/console.test.tsx`

- [ ] **Step 1: Write failing console smoke assertions**

Modify the existing test `"P2-3 Coordinator/Intake/Runtime 真實 body：GPU / 首幀 無遙測標未取得（非 fail，非捏造）"` in `web-viewer-sample/src/console/console.test.tsx` so the Coordinator section becomes:

```ts
    const coord = renderToString(<CoordinatorPage />);
    expect(coord).toContain("/api/runtime/status");
    expect(coord).toContain("A Classic Dashboard");
    expect(coord).toContain("B ATC Tower");
    expect(coord).toContain("C Lifecycle Flow");
    expect(coord).toContain("D Terminal / Debug");
    expect(coord).toContain("port listening ≠ has frame");
    expect(coord).toContain("Open primary URL 不等於 occupied");
    expect(coord).toContain("occupied 必須等 browser first-frame evidence");
    expect(coord).toContain("等待第一幀畫面");
    expect(coord).not.toContain("99.1%");
```

Add a new test after that test:

```ts
  it("C/Hybrid Coordinator Console Phase 1 顯示四視角 contract，不在總覽放 raw JSON", () => {
    const coord = renderToString(<CoordinatorPage />);
    expect(coord).toContain("Classic Dashboard 是 operator 第一眼總覽");
    expect(coord).toContain("ATC Tower 是 endpoint / viewer lease 的航管塔");
    expect(coord).toContain("Lifecycle Flow 用來判斷為什麼還不能算 ready");
    expect(coord).toContain("Terminal / Debug 是工程證據頁");
    expect(coord).toContain("Kit-side evidence + Browser-side evidence");
    expect(coord).not.toContain('"session_id"');
    expect(coord).not.toContain("stack trace");
  });
```

- [ ] **Step 2: Run smoke test and verify it fails**

Run:

```powershell
Set-Location web-viewer-sample
npm test -- src/console/console.test.tsx
```

Expected: FAIL because current `CoordinatorPage` does not render the four tabs and new contract text.

- [ ] **Step 3: Create tab component**

Create `web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Btn, Field, Metric, Panel } from "../components";
import { RuntimeStatus } from "../coordinatorClient";
import { buildEndpointRows, deriveClassicDashboard, EndpointRow, HealthTone } from "./runtimeGovernance";

type TabKey = "classic" | "atc" | "lifecycle" | "debug";

interface RuntimeGovernanceTabsProps {
  rt: RuntimeStatus | null;
  busy: boolean;
  err: string | null;
  onRefresh: () => void;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "classic", label: "A Classic Dashboard" },
  { key: "atc", label: "B ATC Tower" },
  { key: "lifecycle", label: "C Lifecycle Flow" },
  { key: "debug", label: "D Terminal / Debug" },
];

function toneClass(tone: HealthTone) {
  if (tone === "green") return "ok";
  if (tone === "yellow") return "warn";
  return "bad";
}

function StatusLine({ tone, label, detail }: { tone: HealthTone; label: string; detail: string }) {
  return (
    <div className={`ec-governance-status ${toneClass(tone)}`}>
      <span className="ec-status-dot" />
      <span>{label}</span>
      <span className="ec-s">{detail}</span>
    </div>
  );
}

function TechnicalDetails({ children }: { children: React.ReactNode }) {
  return (
    <details className="ec-tech-details">
      <summary>展開技術細節</summary>
      <div>{children}</div>
    </details>
  );
}

function ClassicDashboardTab({ rt, busy, err, onRefresh, onOpenTab }: RuntimeGovernanceTabsProps & { onOpenTab: (tab: TabKey) => void }) {
  const summary = deriveClassicDashboard(rt);
  return (
    <>
      <Panel
        title="Classic Dashboard"
        sub="Classic Dashboard 是 operator 第一眼總覽；不放 raw JSON，不做強操作"
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/runtime/status" onClick={onRefresh}>{busy ? "讀取中…" : "重新整理"}</Btn>}
      >
        {err && <p className="ec-warn-note">{err}</p>}
        <StatusLine {...summary.overall} />
        <div className="ec-grid" style={{ marginTop: 12 }}>
          <Metric value={summary.endpointPool.value} label="Endpoint Pool" tone={summary.overall.tone === "red" ? "bad" : summary.overall.tone === "yellow" ? "warn" : undefined} />
          <Metric value={summary.activeSessions.value} label="Active Sessions" />
          <Metric value={summary.viewerEvidence.value} label="Viewer Evidence" tone="warn" />
          <Metric value={summary.stageTruth.value} label="Stage Truth" tone="warn" />
        </div>
        <p className="ec-note">
          業務判讀：● 綠 可審查模型已就緒 · ● 黃 等待第一幀畫面 · ● 紅 Runtime 無法連線。
          技術 ID 只放在「展開技術細節」中。
        </p>
        <TechnicalDetails>
          <Field k="runtime service" v={rt ? `${rt.service.name} · ${rt.service.status}` : "未取得"} prov="asbuilt" />
          <Field k="coordinator" v={rt ? `${rt.configured_endpoints.coordinator.public_base_url}` : "未取得"} prov="asbuilt" />
          <Field k="conversion authority" v={rt ? `${rt.configured_endpoints.conversion_authority.authority} · ${rt.configured_endpoints.conversion_authority.base_url}` : "未取得"} prov="asbuilt" />
          <Field k="risk detail" v={summary.recentRisk.detail} prov="asbuilt" />
        </TechnicalDetails>
      </Panel>

      <Panel title="Recent Risk" sub="只用 operator 看得懂的語言，不把後端宣稱誤畫成 ready" prov="asbuilt">
        <StatusLine {...summary.recentRisk} />
        <div className="ec-action-row">
          <Btn caption="go to B" onClick={() => onOpenTab("atc")}>查看 endpoint 航管塔</Btn>
          <Btn caption="go to C" onClick={() => onOpenTab("lifecycle")}>查看 readiness gate</Btn>
          <Btn caption="go to D" onClick={() => onOpenTab("debug")}>查看工程證據</Btn>
        </div>
      </Panel>
    </>
  );
}

function EvidenceCell({ state }: { state: EndpointRow["firstFrame"] }) {
  const text = state === "ok" ? "OK" : state === "not_observed" ? "未觀測" : state === "failed" ? "failed" : "無資料";
  return <span className={`ec-evidence-pill ${state}`}>{text}</span>;
}

function AtcTowerTab({ rt, busy, err, onRefresh }: RuntimeGovernanceTabsProps) {
  const rows = useMemo(() => buildEndpointRows(rt), [rt]);
  return (
    <>
      <Panel
        title="ATC Tower"
        sub="ATC Tower 是 endpoint / viewer lease 的航管塔；Phase 1 read-only"
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/runtime/status" onClick={onRefresh}>{busy ? "讀取中…" : "重新整理"}</Btn>}
      >
        {err && <p className="ec-warn-note">{err}</p>}
        <p className="ec-note">
          Open primary URL 不等於 occupied。Open spectator URL 不等於 occupied。
          occupied 必須等 browser first-frame evidence；stage matched 必須等 expected == loaded evidence。
        </p>
        {rows.length > 0 ? (
          <table className="ec-table ec-atc-table">
            <thead>
              <tr>
                <th>endpoint</th>
                <th>role</th>
                <th>lease</th>
                <th>business status</th>
                <th>first frame</th>
                <th>stage truth</th>
                <th>next allowed action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.endpointId}>
                  <td>{row.endpointId}</td>
                  <td>{row.role}</td>
                  <td>{row.leaseState}</td>
                  <td>{row.businessStatus}</td>
                  <td><EvidenceCell state={row.firstFrame} /></td>
                  <td><EvidenceCell state={row.stageTruth} /></td>
                  <td>{row.nextAllowedAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="ec-note">Runtime 尚未連線或 coordinator summary 尚未取得，因此 endpoint pool 不顯示假資料。</p>}
      </Panel>

      <Panel title="Controlled Actions" sub="Phase 1 僅顯示操作 contract；state-changing action 在 Phase 2 接 audited intent" prov="p1">
        <div className="ec-action-row">
          <Btn disabled caption="requires selected primary session">Open primary URL</Btn>
          <Btn disabled caption="requires selected spectator lease">Open spectator URL</Btn>
          <Btn disabled caption="requires selected USD checkbox + primary radio">Apply Stage Binding</Btn>
          <Btn disabled caption="requires audit reason">Close Session</Btn>
          <Btn disabled caption="semi-auto spectator only">Reclaim stale spectator</Btn>
          <Btn disabled caption="manual confirmation + reason">Force release / restart failed runtime</Btn>
        </div>
        <p className="ec-note">
          primary release、force release、restart failed runtime 必須人工確認並輸入 reason；
          audit log 必須記 actor / action / reason / previous_state / next_state / selected_artifacts / control_status。
        </p>
      </Panel>
    </>
  );
}

function LifecycleFlowTab() {
  return (
    <>
      <Panel title="Lifecycle Flow" sub="Lifecycle Flow 用來判斷為什麼還不能算 ready；Phase 1 顯示治理 contract" prov="p1">
        <p className="ec-note">
          這頁不是單純流程圖，而是要分辨哪一步有 evidence、哪一步只是後端宣稱、哪一步卡住、下一步允許什麼操作。
          Readiness 必須同時具備 Kit-side evidence + Browser-side evidence。
        </p>
        <div className="ec-flow">
          <span className="ec-flow-step active"><span className="ec-flow-n">Session</span>created → allocated → active → closing → closed</span>
          <span className="ec-flow-step p15"><span className="ec-flow-n">Endpoint</span>free → reserved → signaling → connected → first_frame → occupied</span>
          <span className="ec-flow-step p15"><span className="ec-flow-n">Stage</span>draft → applied → stage_open_requested → stage_matched</span>
        </div>
      </Panel>
      <Panel title="Evidence Gate" sub="Coordinator 不得只因 Kit process alive 就宣稱 ready" prov="asbuilt">
        <Field k="Kit-side evidence" v="control_sent / stage_open_requested / openedStageResult / selected stage URL / loaded stage URL" prov="asbuilt" />
        <Field k="Browser-side evidence" v="DataChannel ready / first_frame_at / heartbeat / stage matched / primary-spectator role" prov="p1" />
        <Field k="hard rule" v="endpoint occupied requires browser first-frame evidence" prov="asbuilt" />
      </Panel>
    </>
  );
}

function TerminalDebugTab() {
  return (
    <>
      <Panel title="Terminal / Debug" sub="Terminal / Debug 是工程證據頁；不是 demo 預設頁" prov="p1">
        <p className="ec-note">
          D 可以顯示 raw event stream、API trace、WebRTC trace、Kit message trace、E2E evidence、structured logs、console logs、network summary。
          Phase 1 只顯示分類與 contract，不在 Classic Dashboard 混入 raw JSON。
        </p>
        <div className="ec-grid">
          <Field k="Raw event stream" v="Phase 4 接入" prov="p1" />
          <Field k="API trace" v="Phase 4 接入" prov="p1" />
          <Field k="WebRTC trace" v="Phase 4 接入" prov="p1" />
          <Field k="Kit message trace" v="Phase 4 接入" prov="p1" />
          <Field k="E2E evidence" v="Phase 4 接入" prov="p1" />
          <Field k="structured logs" v="Phase 4 接入" prov="p1" />
        </div>
      </Panel>
      <Panel title="Debug Limits" sub="工程追查可用，operator demo 不預設停在這裡" prov="asbuilt">
        <Field k="raw JSON" v="只允許 D tab 顯示" prov="asbuilt" />
        <Field k="stack trace" v="只允許 D tab 顯示" prov="asbuilt" />
        <Field k="session_id / artifact_id / prim_path" v="技術細節，不放 A 頁主畫面" prov="asbuilt" />
      </Panel>
    </>
  );
}

export function CoordinatorGovernanceTabs(props: RuntimeGovernanceTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("classic");
  return (
    <div className="ec-governance">
      <div className="ec-tabs" role="tablist" aria-label="Coordinator governance views">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`ec-tab ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === "classic" && <ClassicDashboardTab {...props} onOpenTab={setActiveTab} />}
      {activeTab === "atc" && <AtcTowerTab {...props} />}
      {activeTab === "lifecycle" && <LifecycleFlowTab />}
      {activeTab === "debug" && <TerminalDebugTab />}
    </div>
  );
}
```

- [ ] **Step 4: Wire component into CoordinatorPage**

Modify imports in `web-viewer-sample/src/console/pages.tsx`:

```ts
import { CoordinatorGovernanceTabs } from "./coordinator/RuntimeGovernanceTabs";
```

Inside `CoordinatorPage`, replace the current `Review sessions`, `Kit Endpoint 綁定`, and `Callback outbox` panels with:

```tsx
      <CoordinatorGovernanceTabs rt={rt} busy={busy} err={err} onRefresh={load} />
```

Keep the existing heading and lead text, but change heading to:

```tsx
      <h1>Coordinator Console · C / Hybrid Runtime Orchestrator</h1>
```

Keep the lead paragraph with these strings:

```tsx
        本頁讀 <code>/api/runtime/status</code>（coordinator-visible read-only summary）；瀏覽器不直連 49100/49101/49102。
        誠實標示：Kit 首幀 / GPU 無統一遙測（port listening ≠ has frame）→ 不畫成 fail、不捏造秒數。
```

- [ ] **Step 5: Run smoke test**

Run:

```powershell
Set-Location web-viewer-sample
npm test -- src/console/console.test.tsx
```

Expected: FAIL only if styles/classes are missing from component import or SSR output does not include inactive tab body strings. If the second test fails because C/D bodies are inactive, adjust `CoordinatorGovernanceTabs` so the tab overview contract appears outside the active body:

```tsx
      <p className="ec-note">
        Classic Dashboard 是 operator 第一眼總覽；ATC Tower 是 endpoint / viewer lease 的航管塔；
        Lifecycle Flow 用來判斷為什麼還不能算 ready；Terminal / Debug 是工程證據頁。
      </p>
```

Place that paragraph immediately under the tab buttons.

- [ ] **Step 6: Re-run smoke test**

Run:

```powershell
Set-Location web-viewer-sample
npm test -- src/console/console.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit tab component**

Run:

```powershell
git add web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/console.test.tsx
git commit -m "feat: add coordinator governance tabs"
```

Expected: commit includes only tab component, CoordinatorPage wiring, and smoke tests.

---

### Task 3: Styling for Four-View Console

**Files:**
- Modify: `web-viewer-sample/src/console/edge-console.css`
- Test: `web-viewer-sample/src/console/console.test.tsx`

- [ ] **Step 1: Add CSS classes**

Append to `web-viewer-sample/src/console/edge-console.css`:

```css
.ec-governance { display:flex; flex-direction:column; gap:12px; }
.ec-tabs { display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--ec-line); padding-bottom:8px; }
.ec-tab { background:var(--ec-bg-3); border:1px solid var(--ec-line-2); border-radius:4px; color:var(--ec-fg-2); padding:7px 10px; font:inherit; cursor:pointer; }
.ec-tab:hover { border-color:var(--ec-grn); color:var(--ec-grn); }
.ec-tab.active { border-color:var(--ec-grn); color:var(--ec-grn); background:#13210f; }
.ec-governance-status { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-weight:600; }
.ec-governance-status.ok { color:var(--ec-grn); }
.ec-governance-status.warn { color:var(--ec-amb); }
.ec-governance-status.bad { color:var(--ec-red); }
.ec-status-dot { width:9px; height:9px; border-radius:50%; background:currentColor; box-shadow:0 0 8px currentColor; flex:0 0 auto; }
.ec-tech-details { margin-top:10px; border:1px solid var(--ec-line); border-radius:4px; padding:8px 10px; background:var(--ec-bg-2); }
.ec-tech-details summary { cursor:pointer; color:var(--ec-fg-2); font-weight:600; }
.ec-action-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.ec-atc-table td, .ec-atc-table th { vertical-align:top; }
.ec-evidence-pill { display:inline-flex; align-items:center; border:1px solid var(--ec-line-2); border-radius:999px; padding:2px 7px; font-size:11px; color:var(--ec-fg-3); }
.ec-evidence-pill.ok { border-color:var(--ec-grn); color:var(--ec-grn); }
.ec-evidence-pill.not_observed { border-color:var(--ec-amb); color:var(--ec-amb); }
.ec-evidence-pill.failed { border-color:var(--ec-red); color:var(--ec-red); }
.ec-evidence-pill.missing { color:var(--ec-fg-4); }
```

- [ ] **Step 2: Run console smoke test**

Run:

```powershell
Set-Location web-viewer-sample
npm test -- src/console/console.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run targeted build**

Run:

```powershell
Set-Location web-viewer-sample
npm run build:ui
```

Expected: Vite build completes and emits `dist-ui`.

- [ ] **Step 4: Commit styling**

Run:

```powershell
git add web-viewer-sample/src/console/edge-console.css
git commit -m "style: polish coordinator governance tabs"
```

Expected: commit includes only CSS.

---

### Task 4: Browser Verification on Existing Server

**Files:**
- No source code changes expected.
- Evidence output: `artifacts/e2e/coordinator-runtime-orchestrator-phase-1.png`

- [ ] **Step 1: Confirm server URL**

Use the already-running local coordinator UI:

```txt
http://127.0.0.1:8004/ui#/coordinator
```

Expected visible result:

- Heading: `Coordinator Console · C / Hybrid Runtime Orchestrator`
- Four tab labels visible.
- A tab default active.
- A tab contains `● 黃 等待第一幀畫面` or `● 紅 Runtime 無法連線` depending on local runtime.
- A tab contains no raw JSON.

- [ ] **Step 2: Use Browser plugin or Playwright screenshot**

If using the in-app Browser plugin, open:

```txt
http://127.0.0.1:8004/ui#/coordinator
```

Take a screenshot and save it under:

```txt
artifacts/e2e/coordinator-runtime-orchestrator-phase-1.png
```

If using Playwright from terminal, run a small local script from `web-viewer-sample`:

```powershell
Set-Location web-viewer-sample
npx playwright screenshot http://127.0.0.1:8004/ui#/coordinator ../artifacts/e2e/coordinator-runtime-orchestrator-phase-1.png
```

Expected: screenshot file exists and shows the Coordinator four-tab shell.

- [ ] **Step 3: Click B ATC Tower and verify read-only rules**

In browser, click `B ATC Tower`.

Expected visible result:

- Text appears: `Open primary URL 不等於 occupied`
- Text appears: `occupied 必須等 browser first-frame evidence`
- Endpoint rows appear when `/api/runtime/status` has configured kit endpoints.
- Controlled action buttons are disabled and visibly marked as Phase 1 / `p1`.

- [ ] **Step 4: Click C and D tabs**

Click `C Lifecycle Flow`, then `D Terminal / Debug`.

Expected visible result:

- C tab shows three lifecycle names: `Session`, `Endpoint`, `Stage`.
- C tab shows `Kit-side evidence + Browser-side evidence`.
- D tab shows evidence categories, but A tab remains free of raw JSON.

- [ ] **Step 5: Commit browser evidence if generated**

Run:

```powershell
git add artifacts/e2e/coordinator-runtime-orchestrator-phase-1.png
git commit -m "test: capture coordinator runtime orchestrator phase 1"
```

Expected: screenshot commit includes only the new evidence artifact.

---

### Task 5: Final Validation and GitNexus Change Detection

**Files:**
- Validation only.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
Set-Location web-viewer-sample
npm test -- src/console/coordinator/runtimeGovernance.test.ts src/console/console.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run UI build**

Run:

```powershell
Set-Location web-viewer-sample
npm run build:ui
```

Expected: PASS.

- [ ] **Step 3: Run GitNexus detect changes**

Run from repo root:

```powershell
npx gitnexus detect-changes
```

Expected: reports changes limited to `web-viewer-sample/src/console/*` plus optional screenshot artifact.

- [ ] **Step 4: Inspect git status**

Run:

```powershell
git status --short
```

Expected:

- No unintended production files changed.
- Existing unrelated dirty files remain untouched.
- New Phase 1 files and commits are scoped to coordinator console.

- [ ] **Step 5: Final commit if earlier tasks were intentionally batched**

If tasks were not committed separately, commit all Phase 1 files together:

```powershell
git add web-viewer-sample/src/console/coordinator/runtimeGovernance.ts web-viewer-sample/src/console/coordinator/runtimeGovernance.test.ts web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/edge-console.css web-viewer-sample/src/console/console.test.tsx artifacts/e2e/coordinator-runtime-orchestrator-phase-1.png
git commit -m "feat: add coordinator runtime orchestrator phase 1"
```

Expected: one scoped commit when separate commits were skipped by execution strategy.

---

## Acceptance Criteria

Phase 1 is complete only when:

- `/ui#/coordinator` shows four tabs: `A Classic Dashboard`, `B ATC Tower`, `C Lifecycle Flow`, `D Terminal / Debug`.
- A tab is default and presents health in business language:
  - `● 綠 可審查模型已就緒`
  - `● 黃 等待第一幀畫面`
  - `● 紅 Runtime 無法連線`
- A tab does not show raw JSON, stack trace, or exposed technical IDs in the main body.
- B tab shows endpoint pool rows from `RuntimeStatus.configured_endpoints.kit`.
- B tab does not mark a `ready` Kit binding as `occupied` without browser first-frame evidence.
- B tab displays disabled controlled action buttons with the audit/evidence contract.
- C tab makes the three lifecycle tracks visible.
- D tab explains that raw event/API/WebRTC/Kit/E2E evidence belongs in Debug, not in A.
- Vitest focused tests pass.
- `npm run build:ui` passes.
- Browser screenshot evidence is captured if local server is reachable.

## Repo Boundary Check

Coordinator-side UI may display:

- session summary
- endpoint bindings
- readiness gaps
- evidence categories
- policy rules
- audit requirements

Coordinator-side UI must not directly execute:

- heavy IFC to USDC conversion
- USD internal mutations
- WebRTC video encoding
- viewport rendering
- Kit process restart/release without a later audited intent path

Execution authority remains:

- `kit-manager-api / runtime manager`: Kit process / endpoint pool / restart / release executor.
- `bim-streaming-server`: conversion / Kit / WebRTC / USD runtime executor.
- `web-viewer-sample`: browser first-frame / heartbeat / stage-match evidence source.

## Self-Review

- Spec coverage: This Phase 1 plan covers the four tab shell, A Classic Dashboard, B ATC Tower read-only, readiness wording, evidence hard rules, and repo boundary contract. Phase 2-5 remain intentionally outside this plan and are named by acceptance gaps, not hidden inside Phase 1.
- Placeholder scan: No step uses vague instructions such as undefined handlers or unnamed tests. All new files, commands, and expected outputs are listed.
- Type consistency: `RuntimeStatus`, `RuntimeKitBinding`, and `RuntimeSessionSummary` are imported from `../coordinatorClient`; helper return types are consumed by `RuntimeGovernanceTabs.tsx` with matching property names.
