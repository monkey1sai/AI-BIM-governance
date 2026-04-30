import type { ReviewArtifact } from "../types/artifacts";

interface ArtifactPanelProps {
    artifacts: ReviewArtifact[];
    width: number;
}

export default function ArtifactPanel({ artifacts, width }: ArtifactPanelProps) {
    return (
        <div style={{ width, background: "#FEFEFE", color: "#656565", borderBottom: "1px solid #d8d8d8" }}>
            <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 600 }}>成果檔</div>
            <div style={{ padding: 8, fontSize: 12 }}>
                {artifacts.map((artifact) => (
                    <div key={artifact.artifact_id} style={{ marginBottom: 6 }}>
                        <strong>{artifact.artifact_type.toUpperCase()}</strong> {artifact.status}
                    </div>
                ))}
                {artifacts.length === 0 && <div>目前沒有成果檔</div>}
            </div>
        </div>
    );
}
