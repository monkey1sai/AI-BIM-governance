import type { ArtifactBinding, ReviewArtifact } from "../types/artifacts";

interface ArtifactPanelProps {
    artifacts: ReviewArtifact[];
    artifactBindings?: ArtifactBinding[];
    width: number;
}

export default function ArtifactPanel({ artifacts, artifactBindings = [], width }: ArtifactPanelProps) {
    return (
        <div style={{ width, background: "#FEFEFE", color: "#656565", borderBottom: "1px solid #d8d8d8" }}>
            <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 600 }}>成果檔</div>
            <div style={{ padding: 8, fontSize: 12 }}>
                {artifactBindings.map((binding) => (
                    <div key={binding.binding_id || binding.artifact_id} style={{ marginBottom: 8 }}>
                        <strong>{binding.artifact_role.toUpperCase()}</strong> {binding.ready_status}
                        <div style={{ color: "#818181" }}>
                            load {binding.load_order} · {binding.routing_policy}
                            {binding.mapping_url ? " · mapping ready" : " · mapping missing"}
                        </div>
                    </div>
                ))}
                {artifacts.map((artifact) => (
                    <div key={artifact.artifact_id} style={{ marginBottom: 6 }}>
                        <strong>{artifact.artifact_type.toUpperCase()}</strong> {artifact.status}
                    </div>
                ))}
                {artifacts.length === 0 && artifactBindings.length === 0 && <div>目前沒有成果檔</div>}
            </div>
        </div>
    );
}
