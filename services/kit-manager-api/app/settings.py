from dataclasses import dataclass
import os
from pathlib import Path


def _parse_cors_origins(raw: str) -> list[str]:
    # 預設行為刻意不破壞 dev：未設定或空字串時回 ["*"]（沿用既有寬鬆 CORS）。
    # 僅在明確提供 comma-separated origins 時才收緊白名單（#26 收緊旋鈕）。
    if not raw.strip():
        return ["*"]
    return [s.strip() for s in raw.split(",") if s.strip()]


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
    cors_origins: list[str]

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
            cors_origins=_parse_cors_origins(os.getenv("KIT_MANAGER_CORS_ORIGINS", "")),
        )
