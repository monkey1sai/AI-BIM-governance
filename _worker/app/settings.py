from dataclasses import dataclass
import os
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]


def _resolve_path(value: Path | str, base: Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (base / path).resolve()


@dataclass
class Settings:
    service_root: Path | str = SERVICE_ROOT
    objects_root: Path | str | None = None
    jobs_dir: Path | str | None = None
    dev_storage_root: Path | str | None = None
    fake_bim_control_url: str = "http://127.0.0.1:8001"
    public_objects_url: str = "http://127.0.0.1:8005/objects"

    def __post_init__(self) -> None:
        self.service_root = Path(self.service_root).resolve()
        self.objects_root = _resolve_path(self.objects_root or "./data/objects", self.service_root)
        self.jobs_dir = _resolve_path(self.jobs_dir or "./data/jobs", self.service_root)
        self.dev_storage_root = _resolve_path(self.dev_storage_root or "../storage", self.service_root)
        self.fake_bim_control_url = self.fake_bim_control_url.rstrip("/")
        self.public_objects_url = self.public_objects_url.rstrip("/")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            objects_root=os.getenv("WORKER_OBJECTS_ROOT"),
            jobs_dir=os.getenv("WORKER_JOBS_DIR"),
            dev_storage_root=os.getenv("WORKER_DEV_STORAGE_ROOT"),
            fake_bim_control_url=os.getenv("WORKER_BIM_CONTROL_URL", "http://127.0.0.1:8001"),
            public_objects_url=os.getenv("WORKER_PUBLIC_OBJECTS_URL", "http://127.0.0.1:8005/objects"),
        )
