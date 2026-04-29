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
    bim_streaming_server_root: Path | str | None = None
    work_dir: Path | str | None = None
    jobs_dir: Path | str | None = None
    logs_dir: Path | str | None = None
    fake_storage_root: Path | str | None = None
    fake_storage_static_url: str = "http://localhost:8002/static"
    fake_bim_control_url: str = "http://localhost:8001"
    conversion_timeout_seconds: int = 900

    def __post_init__(self) -> None:
        self.service_root = Path(self.service_root).resolve()
        self.bim_streaming_server_root = _resolve_path(
            self.bim_streaming_server_root or "../bim-streaming-server",
            self.service_root,
        )
        self.work_dir = _resolve_path(self.work_dir or "./data/work", self.service_root)
        self.jobs_dir = _resolve_path(self.jobs_dir or "./data/jobs", self.service_root)
        self.logs_dir = _resolve_path(self.logs_dir or "./data/logs", self.service_root)
        self.fake_storage_root = _resolve_path(self.fake_storage_root or "../_s3_storage", self.service_root)
        self.fake_storage_static_url = self.fake_storage_static_url.rstrip("/")
        self.fake_bim_control_url = self.fake_bim_control_url.rstrip("/")
        self.conversion_timeout_seconds = int(self.conversion_timeout_seconds)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            bim_streaming_server_root=os.getenv("BIM_STREAMING_SERVER_ROOT"),
            work_dir=os.getenv("CONVERSION_WORK_DIR"),
            fake_storage_root=os.getenv("FAKE_STORAGE_ROOT"),
            fake_storage_static_url=os.getenv("FAKE_STORAGE_STATIC_URL", "http://localhost:8002/static"),
            fake_bim_control_url=os.getenv("FAKE_BIM_CONTROL_URL", "http://localhost:8001"),
            conversion_timeout_seconds=int(os.getenv("CONVERSION_TIMEOUT_SECONDS", "900")),
        )
