from dataclasses import dataclass
import os
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]


def _resolve_path(value: Path | str, base: Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (base / path).resolve()


# Canonical batch queue manifest defaults OUTSIDE the git worktree (design Decision 4):
# root-fixes the Windows `.tmp`-rename lock and keeps the worktree free of scratch state.
DEFAULT_BATCH_QUEUE_PATH = Path.home() / ".ai-bim-governance" / "batch_queue" / "batch_queue.json"


@dataclass
class Settings:
    service_root: Path | str = SERVICE_ROOT
    objects_root: Path | str | None = None
    jobs_dir: Path | str | None = None
    dev_storage_root: Path | str | None = None
    batch_queue_path: Path | str | None = None
    fake_bim_control_url: str = "http://127.0.0.1:8001"
    public_objects_url: str = "http://127.0.0.1:8005/objects"

    def __post_init__(self) -> None:
        self.service_root = Path(self.service_root).resolve()
        self.objects_root = _resolve_path(self.objects_root or "./data/objects", self.service_root)
        self.jobs_dir = _resolve_path(self.jobs_dir or "./data/jobs", self.service_root)
        self.dev_storage_root = _resolve_path(self.dev_storage_root or "../storage", self.service_root)
        # Relative override resolves against service_root; the unset default is an absolute
        # out-of-worktree path so canonical scratch never lands inside the git tree.
        if self.batch_queue_path:
            self.batch_queue_path = _resolve_path(self.batch_queue_path, self.service_root)
        else:
            self.batch_queue_path = DEFAULT_BATCH_QUEUE_PATH.resolve()
        self.fake_bim_control_url = self.fake_bim_control_url.rstrip("/")
        self.public_objects_url = self.public_objects_url.rstrip("/")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            objects_root=os.getenv("WORKER_OBJECTS_ROOT"),
            jobs_dir=os.getenv("WORKER_JOBS_DIR"),
            dev_storage_root=os.getenv("WORKER_DEV_STORAGE_ROOT"),
            batch_queue_path=os.getenv("WORKER_BATCH_QUEUE_PATH"),
            fake_bim_control_url=os.getenv("WORKER_BIM_CONTROL_URL", "http://127.0.0.1:8001"),
            public_objects_url=os.getenv("WORKER_PUBLIC_OBJECTS_URL", "http://127.0.0.1:8005/objects"),
        )
