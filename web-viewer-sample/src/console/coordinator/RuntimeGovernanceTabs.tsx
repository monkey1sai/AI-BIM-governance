import { useMemo, useState } from "react";
import { Btn, Field, Metric, Panel } from "../components";
import type { RuntimeStatus } from "../coordinatorClient";
import { buildEndpointRows, deriveClassicDashboard, type EndpointRow, type HealthTone } from "./runtimeGovernance";

type CoordinatorTab = "classic" | "atc" | "lifecycle" | "debug";

export interface CoordinatorGovernanceTabsProps {
  rt: RuntimeStatus | null;
  busy: boolean;
  err: string | null;
  onRefresh: () => void;
}

const TABS: { id: CoordinatorTab; label: string }[] = [
  { id: "classic", label: "A Classic Dashboard" },
  { id: "atc", label: "B ATC Tower" },
  { id: "lifecycle", label: "C Lifecycle Flow" },
  { id: "debug", label: "D Terminal / Debug" },
];

function metricTone(tone: HealthTone): "warn" | "bad" | undefined {
  if (tone === "red") {
    return "bad";
  }
  if (tone === "yellow") {
    return "warn";
  }
  return undefined;
}

function evidenceLabel(state: EndpointRow["firstFrame"]): string {
  switch (state) {
    case "ok":
      return "已取得";
    case "not_observed":
      return "未觀測";
    case "missing":
      return "未提供";
    case "failed":
      return "失敗";
  }
}

function ActionButton({ children }: { children: string }) {
  return (
    <Btn disabled caption="Phase 1 read-only">
      {children}
    </Btn>
  );
}

function ClassicTab({
  rt,
  busy,
  err,
  onRefresh,
  go,
}: CoordinatorGovernanceTabsProps & { go: (tab: CoordinatorTab) => void }) {
  const summary = useMemo(() => deriveClassicDashboard(rt), [rt]);

  return (
    <Panel
      title="Classic Dashboard"
      sub="operator read-only overview；no raw JSON / no strong operations"
      prov="asbuilt"
      actions={
        <Btn disabled={busy} caption="GET /api/runtime/status" onClick={onRefresh}>
          {busy ? "讀取中..." : "重新整理"}
        </Btn>
      }
    >
      {err && <p className="ec-warn-note">{err}</p>}
      <p className="ec-note">● 綠 可審查模型已就緒 · ● 黃 等待第一幀畫面 · ● 紅 Runtime 無法連線。</p>
      <div className="ec-grid">
        <Metric value={summary.overall.label} label={summary.overall.detail} tone={metricTone(summary.overall.tone)} />
        <Metric value={summary.kitRuntime.label} label={`Kit Runtime · ${summary.kitRuntime.detail}`} tone={metricTone(summary.kitRuntime.tone)} />
        <Metric value={summary.endpointPool.value} label={summary.endpointPool.detail} />
        <Metric value={summary.activeSessions.value} label={summary.activeSessions.detail} />
        <Metric value={summary.viewerEvidence.value} label={summary.viewerEvidence.detail} tone="warn" />
        <Metric value={summary.recentRisk.label} label={summary.recentRisk.detail} tone={metricTone(summary.recentRisk.tone)} />
      </div>
      <Field k="Kit Runtime" v={`${summary.kitRuntime.label} · ${summary.kitRuntime.detail}`} prov="asbuilt" />
      <Field k="Endpoint Pool" v={`${summary.endpointPool.value} · ${summary.endpointPool.detail}`} prov="asbuilt" />
      <Field k="Active Sessions" v={`${summary.activeSessions.value} · ${summary.activeSessions.detail}`} prov="asbuilt" />
      <Field k="Viewer Evidence" v={`${summary.viewerEvidence.value} · ${summary.viewerEvidence.detail}`} prov="asbuilt" />
      <Field k="Stage Truth" v={`${summary.stageTruth.value} · 技術細節已折疊`} prov="asbuilt" />
      <Field k="Recent Risk" v={`${summary.recentRisk.label} · ${summary.recentRisk.detail}`} prov="asbuilt" />
      <details>
        <summary>展開技術細節</summary>
        <Field k="overall status" v={`${summary.overall.label} · ${summary.overall.detail}`} prov="asbuilt" />
        <Field k="runtime service" v={rt ? `${rt.service.name} · ${rt.service.status} · generated_at=${rt.service.generated_at}` : "未取得"} prov="asbuilt" />
        <Field
          k="coordinator"
          v={rt ? `${rt.configured_endpoints.coordinator.public_base_url} · port=${rt.configured_endpoints.coordinator.port}` : "未取得"}
          prov="asbuilt"
        />
        <Field
          k="conversion"
          v={rt ? `${rt.configured_endpoints.conversion_authority.authority} · ${rt.configured_endpoints.conversion_authority.base_url}` : "未取得"}
          prov="asbuilt"
        />
        <Field k="stage truth detail" v={summary.stageTruth.detail} prov="asbuilt" />
      </details>
      <div className="ec-actions">
        <Btn caption="endpoint / viewer lease" onClick={() => go("atc")}>看 ATC Tower</Btn>
        <Btn caption="ready 判斷路徑" onClick={() => go("lifecycle")}>看 Lifecycle Flow</Btn>
        <Btn caption="工程證據" onClick={() => go("debug")}>看 Terminal / Debug</Btn>
      </div>
    </Panel>
  );
}

function AtcTab({ rt }: { rt: RuntimeStatus | null }) {
  const rows = useMemo(() => buildEndpointRows(rt), [rt]);

  return (
    <>
      <Panel title="ATC Tower" sub="Phase 1 read-only endpoint / viewer lease control tower" prov="asbuilt">
        <p className="ec-note">
          Open primary URL 不等於 occupied；occupied 必須等 browser first-frame evidence。port listening ≠ has frame。
        </p>
        {rows.length > 0 ? (
          <table className="ec-table">
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
                <tr key={`${row.role}-${row.port}`}>
                  <td>{row.endpointId}</td>
                  <td>{row.role}</td>
                  <td>{row.leaseState}</td>
                  <td>{row.businessStatus}</td>
                  <td>{evidenceLabel(row.firstFrame)}</td>
                  <td>{evidenceLabel(row.stageTruth)}</td>
                  <td>{row.nextAllowedAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ec-note">目前沒有 coordinator-visible endpoint rows；等 /api/runtime/status 回來後只讀呈現。</p>
        )}
      </Panel>
      <Panel title="Controlled Actions" sub="Phase 1 read-only；state-changing action 全部停用" prov="asbuilt">
        <div className="ec-actions">
          <ActionButton>Open primary URL</ActionButton>
          <ActionButton>Open spectator URL</ActionButton>
          <ActionButton>Apply Stage Binding</ActionButton>
          <ActionButton>Close Session</ActionButton>
          <ActionButton>Reclaim stale spectator</ActionButton>
          <ActionButton>Force release / restart failed runtime</ActionButton>
        </div>
        <p className="ec-note">Audit rule：正式放開前必須記錄 operator、reason、target endpoint、Kit-side evidence 與 Browser-side evidence。</p>
      </Panel>
    </>
  );
}

function LifecycleTab() {
  return (
    <Panel title="Lifecycle Flow" sub="判斷為什麼還不能算 ready；Phase 1 read-only" prov="asbuilt">
      <p className="ec-note">Lifecycle Flow 用來判斷為什麼還不能算 ready.</p>
      <p className="ec-note">Session / Endpoint / Stage lifecycle tracks</p>
      <p className="ec-note">Kit-side evidence + Browser-side evidence 必須同時成立，才從 runtime-ready 推進到可審查 ready。</p>
      <div className="ec-grid">
        <Field k="Session" v="created -> active -> closing -> closed / failed；active 不等於 viewer 已看到畫面" prov="asbuilt" />
        <Field k="Endpoint" v="free -> reserved -> signaling -> connected -> draining；connected 仍需 first-frame evidence" prov="asbuilt" />
        <Field k="Stage" v="expected_stage_url -> Kit loaded -> browser first-frame；缺任一證據都維持 pending" prov="asbuilt" />
      </div>
    </Panel>
  );
}

function DebugTab({ rt }: { rt: RuntimeStatus | null }) {
  return (
    <Panel title="Terminal / Debug" sub="工程證據頁；保留 raw JSON 入口但 Phase 1 不在總覽展開" prov="asbuilt">
      <p className="ec-note">Terminal / Debug 是工程證據頁.</p>
      <p className="ec-note">
        Debug categories：service health、coordinator endpoint、conversion authority、Kit binding、browser evidence、exception details。
      </p>
      <Field k="service" v={rt ? `${rt.service.name} · ${rt.service.status}` : "未取得 /api/runtime/status"} prov="asbuilt" />
      <Field
        k="runtime endpoint"
        v={rt ? `${rt.configured_endpoints.coordinator.public_base_url}/api/runtime/status` : "/api/runtime/status"}
        prov="asbuilt"
      />
      <Field k="raw JSON" v="僅在工程排障視角檢視；Classic Dashboard 不直接展開 payload" prov="asbuilt" />
    </Panel>
  );
}

export function CoordinatorGovernanceTabs(props: CoordinatorGovernanceTabsProps) {
  const [active, setActive] = useState<CoordinatorTab>("classic");

  return (
    <>
      <div className="ec-actions" role="tablist" aria-label="Coordinator runtime governance perspectives">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`ec-btn ${active === tab.id ? "primary" : ""}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="ec-note">
        Classic Dashboard 是 operator 第一眼總覽；ATC Tower 是 endpoint / viewer lease 的航管塔；Lifecycle Flow 用來判斷為什麼還不能算 ready；Terminal / Debug 是工程證據頁。
      </p>
      <p className="ec-note">
        Open primary URL 不等於 occupied；occupied 必須等 browser first-frame evidence；Kit-side evidence + Browser-side evidence 才能宣告可審查 ready。
      </p>
      {active === "classic" && <ClassicTab {...props} go={setActive} />}
      {active === "atc" && <AtcTab rt={props.rt} />}
      {active === "lifecycle" && <LifecycleTab />}
      {active === "debug" && <DebugTab rt={props.rt} />}
    </>
  );
}
