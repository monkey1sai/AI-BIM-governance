import { UsdcArtifact } from "../models";

interface Props {
  artifacts: UsdcArtifact[];
  selected: Set<string>;
  onToggle: (artifactId: string) => void;
}

export function UsdcChecklist({artifacts, selected, onToggle}: Props) {
  if (artifacts.length === 0) {
    return <p className="empty">storage/ 內尚未找到 .usdc 檔案。</p>;
  }

  return (
    <div className="list">
      {artifacts.map((artifact) => (
        <label className="row" key={artifact.artifact_id}>
          <input
            type="checkbox"
            checked={selected.has(artifact.artifact_id)}
            onChange={() => onToggle(artifact.artifact_id)}
          />
          <span>
            <strong>{artifact.filename}</strong>
            <small>{artifact.relative_path} · {Math.round(artifact.size_bytes / 1024)} KB</small>
          </span>
        </label>
      ))}
    </div>
  );
}
