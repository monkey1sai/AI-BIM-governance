// CH-H1：中央視區「不空白」核心。無真實 WebRTC 幀（harness 或尚未出幀）時，以資訊濃密 mock viewport
// 取代空白——明標「deterministic · no-GPU」避免被當壞掉，並把範本①模型資訊 + ④對構表 + 選取/高亮 echo
// 放進中央。有真實 Kit 幀時，Window 不渲染本元件（讓 <video> 顯示）。誠實鐵律：缺資料顯誠實狀態、不捏造。
import { ModelInfoCard, type ModelInfoModel, type QualityMetricsSummary } from "./ModelInfoCard";
import { MappingTable } from "./MappingTable";
import { IfcSemanticPanel } from "./IfcSemanticPanel";
import { StructureStats } from "./StructureStats";
import { coordinatorClient } from "../coordinatorClient";

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
  // CH-H3：取得真實 Kit 幀（_hasRemoteVideoFrame）後仍掛載——改為左側語意側欄，與中央 live 3D <video> 並存
  // （對齊範本：①③ 左欄 + ②④⑥ 隨點構件），而非整片消失。誠實鐵律：liveMode 下 banner 標「live 3D 已出幀」，不再宣稱 no-GPU。
  liveMode?: boolean;
}

const DASH = "—";

export function MockViewport(props: MockViewportProps) {
  const { harness, stageUrl, loadedStageUrl, webrtcStatus, selectedGuid, selectedPrim, bindings = [], reservedRight = 0, reservedLeft = 0, liveMode = false } = props;
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
  return (
    <div className={`gv-mock${liveMode ? " gv-mock--live" : ""}`} data-testid="mock-viewport" style={pad}>
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
      <div className="gv-mock__grid">
        <div className="gv-mock__col">
          {/* viewport 狀態 echo：證明互動通路暢通（選取/高亮會回饋到這） */}
          <section className="gv-card" data-testid="mock-stage">
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

        <div className="gv-mock__col gv-mock__col--wide">
          <MappingTable mappingUrl={mappingSrc} selectedGuid={selectedGuid} onSelectGuid={props.onSelectGuid} />
          {/* CH-H2：點構件 → ② IFC 語意 + ⑥ 空間（真實 ifcopenshell 萃取，經 coordinator for-session proxy）。 */}
          <IfcSemanticPanel sessionId={props.sessionId} selectedGuid={selectedGuid} />
        </div>
      </div>
    </div>
  );
}
