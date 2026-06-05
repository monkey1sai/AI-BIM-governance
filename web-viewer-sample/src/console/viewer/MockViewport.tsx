// CH-H1：中央視區「不空白」核心。無真實 WebRTC 幀（harness 或尚未出幀）時，以資訊濃密 mock viewport
// 取代空白——明標「deterministic · no-GPU」避免被當壞掉，並把範本①模型資訊 + ④對構表 + 選取/高亮 echo
// 放進中央。有真實 Kit 幀時，Window 不渲染本元件（讓 <video> 顯示）。誠實鐵律：缺資料顯誠實狀態、不捏造。
import { ModelInfoCard, type ModelInfoModel, type QualityMetricsSummary } from "./ModelInfoCard";
import { MappingTable } from "./MappingTable";

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
}

const DASH = "—";

export function MockViewport(props: MockViewportProps) {
  const { harness, stageUrl, loadedStageUrl, webrtcStatus, selectedGuid, selectedPrim, bindings = [], reservedRight = 0, reservedLeft = 0 } = props;
  const layers = bindings.filter((b) => b.ready_status === "ready");
  const pad =
    reservedRight || reservedLeft ? { paddingRight: reservedRight || undefined, paddingLeft: reservedLeft || undefined } : undefined;
  return (
    <div className="gv-mock" data-testid="mock-viewport" style={pad}>
      <div className="gv-mock__banner" data-testid="mock-viewport-banner">
        <span className="gv-dot" /> Mock Viewport · <strong>deterministic · no-GPU</strong>
        <span className="gv-mock__hint">
          {harness ? "harness 決定性模式（不連真 Kit）" : "尚未取得真實 WebRTC 視訊幀"}；此為刻意佔位非錯誤，取得真 Kit 幀後自動切換為 live 3D。
        </span>
      </div>

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
        </div>

        <div className="gv-mock__col gv-mock__col--wide">
          <MappingTable mappingUrl={props.mappingUrl} selectedGuid={selectedGuid} onSelectGuid={props.onSelectGuid} />
        </div>
      </div>
    </div>
  );
}
