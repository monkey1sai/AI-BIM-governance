"""Host-native conversion authority service runner (introduce-host-native-conversion-authority-service).

Thin runner (design.md D1): loads the EXISTING ``create_conversion_api_app`` and
binds it to ``127.0.0.1:49101`` by default so ``bim-review-coordinator`` can call
it as ``STREAMING_CONVERSION_API_BASE``. It does not re-implement conversion logic
and does not start Kit/WebRTC; it only serves the internal conversion API +
``GET /health`` (conversion-only identity).

Configuration is read from ``STREAMING_CONVERSION_*`` environment variables with
safe local-dev defaults. This module never edits real ``.env`` secret files; it
only reads ``os.environ``.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
import os
import sys

_MODULE_DIR = Path(__file__).resolve().parent
if str(_MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(_MODULE_DIR))

from conversion_authority import (
    ConversionAuthorityError,
    ConversionAuthoritySettings,
    create_conversion_api_app,
)
from ifc2usdc_powershell_adapter import adapter_from_env


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 49101


@dataclass(frozen=True)
class HostNativeServiceConfig:
    host: str
    port: int
    service_root: Path
    artifacts_root: Path
    jobs_dir: Path
    public_artifacts_url: str
    internal_conversion_token: str | None
    repo_root: Path

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"


def _repo_root() -> Path:
    # messaging/ -> bim_review_stream/ -> ezplus/ -> <ext>/ -> extensions/
    # -> source/ -> bim-streaming-server/
    return _MODULE_DIR.parents[5]


def load_config(env: Mapping[str, str] | None = None) -> HostNativeServiceConfig:
    src = dict(os.environ if env is None else env)
    repo_root = (
        Path(src["STREAMING_CONVERSION_REPO_ROOT"])
        if src.get("STREAMING_CONVERSION_REPO_ROOT")
        else _repo_root()
    )
    service_root = (
        Path(src["STREAMING_CONVERSION_SERVICE_ROOT"])
        if src.get("STREAMING_CONVERSION_SERVICE_ROOT")
        # default under bim-streaming-server/_cache/ (already git-ignored) so
        # local runs do not dirty the working tree.
        else repo_root / "_cache" / "host-native-conversion"
    )
    artifacts_root = (
        Path(src["STREAMING_CONVERSION_ARTIFACTS_ROOT"])
        if src.get("STREAMING_CONVERSION_ARTIFACTS_ROOT")
        else service_root / "artifacts"
    )
    jobs_dir = (
        Path(src["STREAMING_CONVERSION_JOBS_DIR"])
        if src.get("STREAMING_CONVERSION_JOBS_DIR")
        else service_root / "jobs"
    )
    host = src.get("STREAMING_CONVERSION_HOST", DEFAULT_HOST)
    port_raw = src.get("STREAMING_CONVERSION_PORT")
    try:
        parsed_port = int(port_raw) if port_raw else DEFAULT_PORT
    except ValueError:
        parsed_port = DEFAULT_PORT
    # out-of-range (0, negative, >65535) -> fall back instead of bind failure
    port = parsed_port if 1 <= parsed_port <= 65535 else DEFAULT_PORT
    public_artifacts_url = src.get(
        "STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL",
        f"http://{host}:{port}/artifacts",
    )
    token = src.get("STREAMING_CONVERSION_INTERNAL_TOKEN") or None
    return HostNativeServiceConfig(
        host=host,
        port=port,
        service_root=service_root,
        artifacts_root=artifacts_root,
        jobs_dir=jobs_dir,
        public_artifacts_url=public_artifacts_url,
        internal_conversion_token=token,
        repo_root=repo_root,
    )


def build_app(
    config: HostNativeServiceConfig | None = None,
    *,
    converter: Any | None = None,
    run_background: bool = True,
):
    """Build the FastAPI app using the existing factory + the host-native adapter.

    ``converter`` is injectable so tests reuse the existing fake-converter
    harness without a real Kit/USD runtime.
    """
    config = config or load_config()
    settings = ConversionAuthoritySettings(
        service_root=config.service_root,
        artifacts_root=config.artifacts_root,
        jobs_dir=config.jobs_dir,
        public_artifacts_url=config.public_artifacts_url,
        bim_control_callback_url=None,
        internal_conversion_token=config.internal_conversion_token,
    )
    if converter is None:
        converter = adapter_from_env(config.repo_root)
    app = create_conversion_api_app(
        settings=settings, converter=converter, run_background=run_background
    )
    # Serve produced artifacts so the URLs advertised in results
    # (public_artifacts_url default = this service /artifacts) are reachable
    # by coordinator/viewer instead of dead links. Scoped, traversal-safe route
    # (not StaticFiles) so a crafted job_id/filename cannot escape artifacts_root.
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    Path(config.artifacts_root).mkdir(parents=True, exist_ok=True)
    _artifacts_root = Path(config.artifacts_root).resolve()

    @app.get("/artifacts/{job_id}/{filename}")
    def _serve_artifact(job_id: str, filename: str):
        # per-job scope:job_dir 必須在 artifacts_root 內(擋 job_id 穿越),candidate
        # 必須在 job_dir 內(擋 filename 穿越與跨 job)。Windows 上 filename 含 encoded
        # backslash(%5C)會被 Path 當路徑分隔,只驗 artifacts_root 會放行 sibling job
        # 的跨 job 讀取,故兩層都要 relative_to。
        job_dir = (_artifacts_root / job_id).resolve()
        candidate = (job_dir / filename).resolve()
        try:
            job_dir.relative_to(_artifacts_root)
            candidate.relative_to(job_dir)
        except ValueError:
            raise HTTPException(status_code=404)
        if not candidate.is_file():
            raise HTTPException(status_code=404)
        try:
            app.state.conversion_store.assert_artifact_downloadable(job_id, candidate)
        except KeyError:
            raise HTTPException(status_code=404)
        except ConversionAuthorityError as exc:
            raise HTTPException(status_code=409, detail=exc.message) from exc
        return FileResponse(str(candidate))

    return app


def main() -> int:
    config = load_config()
    try:
        import uvicorn
    except Exception as exc:  # noqa: BLE001 - honest startup failure
        sys.stderr.write(
            f"host-native conversion service requires uvicorn: {exc}\n"
        )
        return 2
    app = build_app(config)
    sys.stderr.write(
        "host-native conversion authority listening on "
        f"{config.base_url} (conversion-only; not WebRTC/Kit)\n"
    )
    uvicorn.run(app, host=config.host, port=config.port, log_level="info")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
