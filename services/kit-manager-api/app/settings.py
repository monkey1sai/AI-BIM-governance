from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    runtime_mode: str
    host_local_runtime_allowed: bool
    storage_root: Path
    kit_instance_id: str
    kit_control_url: str
    kit_signaling_host: str
    kit_signaling_port: int
    kit_media_port: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            runtime_mode=os.getenv("RUNTIME_MODE", "docker-container"),
            host_local_runtime_allowed=os.getenv("HOST_LOCAL_RUNTIME_ALLOWED", "false").lower() == "true",
            storage_root=Path(os.getenv("STORAGE_ROOT", "/workspace/storage")),
            kit_instance_id=os.getenv("KIT_INSTANCE_ID", "kit_local_gpu_001"),
            kit_control_url=os.getenv("KIT_CONTROL_URL", "http://streaming-server:49101").rstrip("/"),
            kit_signaling_host=os.getenv("KIT_SIGNALING_HOST", "127.0.0.1"),
            kit_signaling_port=int(os.getenv("KIT_SIGNALING_PORT", "49100")),
            kit_media_port=int(os.getenv("KIT_MEDIA_PORT", "47998")),
        )
