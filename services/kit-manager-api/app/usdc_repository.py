from pathlib import Path
from .models import UsdcArtifact


class UsdcRepository:
    def __init__(self, storage_root: Path):
        self.storage_root = storage_root.resolve()

    def list_artifacts(self) -> list[UsdcArtifact]:
        self.storage_root.mkdir(parents=True, exist_ok=True)
        artifacts: list[UsdcArtifact] = []
        for path in sorted(self.storage_root.rglob("*.usdc")):
            if not path.is_file():
                continue
            rel = path.resolve().relative_to(self.storage_root).as_posix()
            artifacts.append(
                UsdcArtifact(
                    artifact_id=self._artifact_id(rel),
                    filename=path.name,
                    relative_path=rel,
                    runtime_uri=f"file:///workspace/storage/{rel}",
                    size_bytes=path.stat().st_size,
                )
            )
        return artifacts

    def resolve(self, artifact_ids: list[str]) -> list[UsdcArtifact]:
        by_id = {artifact.artifact_id: artifact for artifact in self.list_artifacts()}
        missing = [artifact_id for artifact_id in artifact_ids if artifact_id not in by_id]
        if missing:
            raise KeyError(", ".join(missing))
        return [by_id[artifact_id] for artifact_id in artifact_ids]

    def _artifact_id(self, relative_path: str) -> str:
        safe = relative_path.replace("/", "__").replace("\\", "__").replace(" ", "_")
        return f"usdc_{safe}"
