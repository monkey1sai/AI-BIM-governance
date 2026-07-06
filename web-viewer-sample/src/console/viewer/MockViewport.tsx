// CH-H1：中央視區「不空白」核心。無真實 WebRTC 幀（harness 或尚未出幀）時，以資訊濃密 mock viewport
// 取代空白——明標「deterministic · no-GPU」避免被當壞掉，並把範本①模型資訊 + ④對構表 + 選取/高亮 echo
// 放進中央。有真實 Kit 幀時，Window 不渲染本元件（讓 <video> 顯示）。誠實鐵律：缺資料顯誠實狀態、不捏造。
import { ModelInfoCard, type ModelInfoModel, type QualityMetricsSummary } from "./ModelInfoCard";
import { MappingTable } from "./MappingTable";
import { IfcSemanticPanel } from "./IfcSemanticPanel";
import { StructureStats } from "./StructureStats";
import { coordinatorClient } from "../coordinatorClient";
import type { TriReadyState } from "../../utils/triReady";

export interface ArtifactBindingLite {
  artifact_id?: string | null;
  display_name?: string | null;
  url?: string | null;
  load_order?: number | null;
  ready_status?: string | null;
  source_ifc_filename?: string | null;
}

export interface MockViewportProps {
  harness?: boolean;
  stageUrl?: string | null;
  loadedStageUrl?: string | null;
  webrtcStatus?: string | null;
  selectedGuid?: string | null;
  selectedPrim?: string | null;
  bindings?: ArtifactBindingLite[];
  model?: ModelInfoModel | null;
  metrics?: QualityMetricsSummary | null;
  projectId?: string | null;
  modelVersionId?: string | null;
  mappedCount?: number | null;
  isFake?: boolean;
  mappingUrl?: string | null;
  onSelectGuid?: (guid: string) => void;
  reservedRight?: number;
  reservedLeft?: number;
  sessionId?: string | null;
  streamRole?: "primary" | "spectator";
  lifecycleStatus?: string | null;
  frameObserved?: boolean;
  triReady?: { file: TriReadyState; runtime: TriReadyState; semantic: TriReadyState };
  onReconnect?: () => void;
  // CH-H3：取得真實 Kit 幀（_hasRemoteVideoFrame）後仍掛載——改為左側語意側欄，與中央 live 3D <video> 並存
  // （對齊範本：①③ 左欄 + ②④⑥ 隨點構件），而非整片消失。誠實鐵律：liveMode 下 banner 標「live 3D 已出幀」，不再宣稱 no-GPU。
  liveMode?: boolean;
}

const DASH = "—";
const viewerAxes = [
  { code: "01", title: "點選", detail: "live prim / 對構表選取" },
  { code: "02", title: "IFC 語意", detail: "Type / Name / GlobalId" },
  { code: "03", title: "Pset/Qto", detail: "屬性與數量" },
  { code: "04", title: "Spatial", detail: "樓層 / 空間關係" },
  { code: "05", title: "GUID ⇔ USD", detail: "mapping 可追溯" },
  { code: "06", title: "A1 疊加", detail: "overlay / highlight result" },
  { code: "07", title: "反向定位", detail: "table/tree/list → 3D focus" },
] as const;
type ViewerAxisCode = typeof viewerAxes[number]["code"];
type ViewerAxisTone = "observed" | "index" | "pending" | "blocked";

export function MockViewport(props: MockViewportProps) {
  const { harness, stageUrl, loadedStageUrl, webrtcStatus, selectedGuid, selectedPrim, bindings = [], reservedRight = 0, reservedLeft = 0, liveMode = false, streamRole = "primary", lifecycleStatus, frameObserved = false, triReady, onReconnect } = props;
  const layers = bindings.filter((b) => b.ready_status === "ready");
  // ④對構表資料源：經 coordinator :8004 element-mapping for-session proxy（CORS-safe + 守邊界，
  // 瀏覽器不直連 :49101 artifact server）。harness 無真實 coordinator session → null（誠實空狀態）。
  const mappingSrc = !harness && props.sessionId
    ? `${coordinatorClient.base}/api/governance/element-mapping/for-session/${encodeURIComponent(props.sessionId)}`
    : null;
  // ③ 空間巢狀樹資料源：coordinator spatial-tree for-session proxy（真實 session）；harness 無 → null（退類別計數/空）。
  const spatialSrc = !harness && props.sessionId
    ? `${coordinatorClient.base}/api/governance/spatial-tree/for-session/${encodeURIComponent(props.sessionId)}`
    : null;
  // liveMode（已出真 Kit 幀）：固定左側欄，不套 reserved padding（不覆蓋中央 live 3D）。非 liveMode：維持中央佔位（既有行為）。
  const pad =
    !liveMode && (reservedRight || reservedLeft)
      ? { paddingRight: reservedRight || undefined, paddingLeft: reservedLeft || undefined }
      : undefined;
  const roleLabel = streamRole === "primary" ? "PRIMARY · control lane" : "SPECTATOR · view-only";
  const streamEvidence = harness
    ? "harness stream"
    : frameObserved || liveMode
      ? "first frame observed"
      : "not_observed";
  const canReconnect = Boolean(onReconnect) && ["stopped", "terminated", "failed"].includes(webrtcStatus ?? "");
  const axisState = (code: ViewerAxisCode): { label: string; tone: ViewerAxisTone } => {
    if (code === "01") {
      return selectedGuid || selectedPrim
        ? { label: "已選取", tone: "observed" }
        : { label: "等待選取", tone: "pending" };
    }
    if (code === "05") {
      return mappingSrc
        ? { label: "proxy path set", tone: "index" }
        : { label: "未取得", tone: "pending" };
    }
    if (code === "06") {
      return selectedGuid || selectedPrim
        ? { label: "A1 可高亮", tone: "observed" }
        : props.sessionId
          ? { label: "等待 A1 結果", tone: "pending" }
          : { label: "等待 session", tone: "pending" };
    }
    if (code === "07") {
      return selectedGuid || selectedPrim
        ? { label: "可回焦 3D", tone: "observed" }
        : mappingSrc
          ? { label: "等待表列選取", tone: "index" }
          : { label: "等待對構", tone: "pending" };
    }
    return props.sessionId
      ? { label: "查詢入口", tone: "index" }
      : { label: "等待 session", tone: "pending" };
  };
  return (
    <div className={`gv-mock gv-C${liveMode ? " gv-mock--live" : ""}`} data-testid="mock-viewport" style={pad}>
      <div className="gv-mock__banner" data-testid="mock-viewport-banner">
        {liveMode ? (
          <>
            <span className="gv-dot" /> 語意側欄 · <strong>live 3D 已出幀</strong>
            <span className="gv-mock__hint">中央為 live 3D 視訊（真 Kit 幀）；此側欄同步 ①模型資訊 / ②IFC語意 / ③結構 / ④對構 / ⑥空間，點構件即查語意。</span>
          </>
        ) : (
          <>
            <span className="gv-dot" /> Mock Viewport · <strong>deterministic · no-GPU</strong>
            <span className="gv-mock__hint">
              {harness ? "harness 決定性模式（不連真 Kit）" : "尚未取得真實 WebRTC 視訊幀"}；此為刻意佔位非錯誤，取得真 Kit 幀後自動切換為 live 3D。
            </span>
          </>
        )}
      </div>

      {/* section nav 已上移至 viewer 層分頁列（Window.tsx），「問題」分頁隱 MockViewport 後仍可切回。 */}
      <div className="gv-axis-rail" data-testid="viewer-seven-axis-rail" aria-label="AI-BIM Geo viewer seven-axis IA">
        {viewerAxes.map((axis) => {
          const state = axisState(axis.code);
          return (
            <div key={axis.code} className={`gv-axis gv-axis--${state.tone}`}>
              <span className="gv-axis__code">{axis.code}</span>
              <strong>{axis.title}</strong>
              <span>{axis.detail}</span>
              <em>{state.label}</em>
            </div>
          );
        })}
      </div>
      <div className="gv-mock__grid">
        <div className="gv-mock__col gv-C__left" data-testid="geo-viewer-left-model">
          {/* viewport 狀態 echo：證明互動通路暢通（選取/高亮會回饋到這） */}
          <section className="gv-card gv-C__center" data-testid="mock-stage">
            <div data-testid="geo-viewer-center-stage">
            <header className="gv-card__title">Viewport 狀態</header>
            <table className="gv-kv"><tbody>
              <tr><td className="gv-kv__k">Stage URL</td><td className="gv-kv__v gv-mono" data-testid="mock-stage-url">{stageUrl || DASH}</td></tr>
              <tr><td className="gv-kv__k">loaded</td><td className="gv-kv__v gv-mono">{loadedStageUrl || "not_observed"}</td></tr>
              <tr><td className="gv-kv__k">WebRTC</td><td className="gv-kv__v">{webrtcStatus || DASH}</td></tr>
              <tr><td className="gv-kv__k">loaded layers</td><td className="gv-kv__v" data-testid="mock-layer-count">{layers.length}</td></tr>
              <tr><td className="gv-kv__k">selected</td><td className="gv-kv__v gv-mono" data-testid="mock-selected">{selectedGuid || selectedPrim || "（點結構樹 / 對構表選取）"}</td></tr>
            </tbody></table>
            {layers.length > 0 && (
              <ul className="gv-layers" data-testid="mock-layers">
                {layers.slice(0, 8).map((b, i) => (
                  <li key={b.artifact_id ?? i}><span className="gv-mono">#{b.load_order ?? i}</span> {b.display_name || b.artifact_id} <em>{b.source_ifc_filename || ""}</em></li>
                ))}
              </ul>
            )}
            </div>
          </section>

          <section className="gv-card gv-session-card" data-testid="viewer-session-bridge">
            <header className="gv-card__title" data-testid="edge-console-topbar">⑦ Session 連動 / Role</header>
            <table className="gv-kv" data-testid="geo-viewer-runtime-evidence"><tbody>
              <tr><td className="gv-kv__k">role</td><td className="gv-kv__v" data-testid="viewer-role">{roleLabel}</td></tr>
              <tr><td className="gv-kv__k">project</td><td className="gv-kv__v gv-mono" data-testid="topbar-project">project: {props.projectId || "未取得"}</td></tr>
              <tr><td className="gv-kv__k">version</td><td className="gv-kv__v gv-mono" data-testid="topbar-version">version: {props.modelVersionId || "未取得"}</td></tr>
              <tr><td className="gv-kv__k">session</td><td className="gv-kv__v gv-mono" data-testid="topbar-session">session: {props.sessionId || "未取得"}</td></tr>
              <tr><td className="gv-kv__k">lifecycle</td><td className="gv-kv__v">{lifecycleStatus || "unknown"}</td></tr>
              <tr><td className="gv-kv__k">stream</td><td className="gv-kv__v">{streamEvidence}</td></tr>
              <tr><td className="gv-kv__k">GPU rule</td><td className="gv-kv__v">{streamRole === "spectator" ? "shares primary stream" : "owns primary Kit stream"}</td></tr>
              {triReady && (
                <>
                  <tr><td className="gv-kv__k">File</td><td className="gv-kv__v gv-mono" data-testid="topbar-file-ready">{triReady.file}</td></tr>
                  <tr><td className="gv-kv__k">Runtime</td><td className="gv-kv__v gv-mono" data-testid="topbar-runtime-ready">{triReady.runtime}</td></tr>
                  <tr><td className="gv-kv__k">Semantic</td><td className="gv-kv__v gv-mono" data-testid="topbar-semantic-ready">{triReady.semantic}</td></tr>
                </>
              )}
            </tbody></table>
            {canReconnect && (
              <button className="gv-action" type="button" data-testid="viewer-reconnect-stream" onClick={onReconnect}>
                重新連線 WebRTC
              </button>
            )}
          </section>

          <ModelInfoCard
            model={props.model}
            metrics={props.metrics}
            projectId={props.projectId}
            modelVersionId={props.modelVersionId}
            mappedCount={props.mappedCount}
            isFake={props.isFake}
          />
          {/* ③ IFC 結構：真實 session 顯空間巢狀樹（spatial-tree proxy）；harness 退類別計數/空。 */}
          <StructureStats spatialUrl={spatialSrc} mappingUrl={mappingSrc} />
        </div>

        <div className="gv-mock__col gv-mock__col--wide gv-C__right" data-testid="geo-viewer-right-semantic">
          <div className="gv-C__bottom" data-testid="geo-viewer-bottom-mapping">
            <MappingTable mappingUrl={mappingSrc} selectedGuid={selectedGuid} onSelectGuid={props.onSelectGuid} />
          </div>
          {/* CH-H2：點構件 → ② IFC 語意 + ⑥ 空間（真實 ifcopenshell 萃取，經 coordinator for-session proxy）。 */}
          <IfcSemanticPanel sessionId={props.sessionId} selectedGuid={selectedGuid} />
        </div>
      </div>
    </div>
  );
}
