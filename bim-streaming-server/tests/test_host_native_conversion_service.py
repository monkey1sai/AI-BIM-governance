import sys
from pathlib import Path

from fastapi.testclient import TestClient

MODULE_DIR = (
    Path(__file__).resolve().parents[1]
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))

from conversion_authority import ConversionAuthorityError  # noqa: E402
from host_native_conversion_service import (  # noqa: E402
    DEFAULT_HOST,
    DEFAULT_PORT,
    build_app,
    load_config,
)
from ifc2usdc_powershell_adapter import (  # noqa: E402
    Ifc2UsdcPowershellConverterAdapter,
    adapter_from_env,
)


class FakeSuccessfulConverter:
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        mapping_path = output_dir / "element_mapping.json"
        entity_index_path = output_dir / "entity_index.json"
        metadata_path = output_dir / "metadata.json"
        model_path.write_bytes(b"PXR-USDC-fake-openable\n")
        mapping_path.write_text(
            '{"mock": false, "summary": {"mapped_count": 2, "fake_mapping_count": 0}, "items": []}',
            encoding="utf-8",
        )
        entity_index_path.write_text('{"entities": []}', encoding="utf-8")
        metadata_path.write_text('{"source": "ifc_ready"}', encoding="utf-8")
        return {
            "model_path": model_path,
            "mapping_path": mapping_path,
            "entity_index_path": entity_index_path,
            "metadata_path": metadata_path,
            "quality_metrics": {
                "source_ifc_entity_count": 2,
                "mapped_count": 2,
                "unmapped_count": 0,
                "coverage_ratio": 1.0,
                "coverage_status": "pass",
                "materialization_strategy": "sidecar",
                "sidecar_carrier_count": 1,
                "minimum_coverage_baseline_locked": True,
                "hard_quality_gates": {
                    "usdc_openable": True,
                    "has_renderable_prims": True,
                    "placeholder_output": False,
                },
            },
        }


class FakeFailedConverter:
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        raise ConversionAuthorityError("converter_failed", "fixture converter failed")


def _config(tmp_path: Path, token: str | None = None):
    env = {
        "STREAMING_CONVERSION_SERVICE_ROOT": str(tmp_path / "svc"),
        "STREAMING_CONVERSION_ARTIFACTS_ROOT": str(tmp_path / "svc" / "artifacts"),
        "STREAMING_CONVERSION_JOBS_DIR": str(tmp_path / "svc" / "jobs"),
        "STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL": "http://testserver/artifacts",
    }
    if token:
        env["STREAMING_CONVERSION_INTERNAL_TOKEN"] = token
    return load_config(env)


def _client(tmp_path: Path, converter, run_background: bool = True, token: str | None = None):
    app = build_app(
        _config(tmp_path, token=token), converter=converter, run_background=run_background
    )
    return TestClient(app)


def ifc_ready_payload(**overrides):
    payload = {
        "event_type": "ifc_ready",
        "event_id": "evt_ifc_hn_001",
        "correlation_id": "corr_hn_001",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "export_job_id": "rvt_export_demo_001",
        "source_rvt_artifact_id": "artifact_rvt_demo_001",
        "ifc_artifact": {
            "artifact_id": "artifact_ifc_hn_001",
            "format": "ifc",
            "filename": "demo-model.ifc",
            "url": "edge-local://fixtures/demo-model.ifc",
        },
        "requested_outputs": ["usdc", "element_mapping", "entity_index", "metadata"],
    }
    payload.update(overrides)
    return payload


# --- service contract (load existing factory; conversion-only identity) -----


def test_load_config_defaults_to_local_conversion_port():
    config = load_config({})
    assert config.host == DEFAULT_HOST == "127.0.0.1"
    assert config.port == DEFAULT_PORT == 49101
    assert config.base_url == "http://127.0.0.1:49101"
    assert config.service_root == config.repo_root / "_cache" / "host-native-conversion"
    assert config.internal_conversion_token is None


def test_health_reports_conversion_only_identity(tmp_path: Path):
    client = _client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["authority"] == "bim-streaming-server"
    assert body["service"] == "host-native-conversion-authority"
    assert body["role"] == "conversion-only"
    # MUST NOT claim WebRTC / Kit launcher / viewport readiness.
    assert body["claims"]["ifc_to_usdc_conversion"] is True
    assert body["claims"]["webrtc_49100"] is False
    assert body["claims"]["kit_launcher"] is False
    assert body["claims"]["viewport_render"] is False


def test_host_native_service_creates_and_completes_job(tmp_path: Path):
    client = _client(tmp_path, converter=FakeSuccessfulConverter())

    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    assert create.status_code == 202
    conversion_job_id = create.json()["conversion_job_id"]
    assert conversion_job_id.startswith("stream_conv_")
    assert create.json()["authority"] == "bim-streaming-server"

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["status"] == "succeeded"
    assert result["model"]["status"] == "ready"
    assert result["artifacts"]["model_usdc"]["url"].endswith("/model.usdc")
    assert result["quality_metrics"]["coverage_status"] == "pass"


def test_host_native_service_enforces_internal_token(tmp_path: Path):
    client = _client(
        tmp_path,
        converter=FakeSuccessfulConverter(),
        run_background=False,
        token="secret-token",
    )

    missing = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    valid = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(),
        headers={"X-Internal-Conversion-Token": "secret-token"},
    )

    assert missing.status_code == 401
    assert valid.status_code == 202


def test_host_native_service_failed_conversion_is_not_ready(tmp_path: Path):
    client = _client(tmp_path, converter=FakeFailedConverter())

    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    assert result["model"]["status"] != "ready"


# --- adapter D7 contract: honest blocker + correct PowerShell invocation ----


def test_adapter_preflight_missing_prereqs_raises_converter_unavailable(tmp_path: Path):
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,  # no scripts/convert-ifc-to-usdc.ps1 here
        kit_exe_path=None,
        hoops_main_path=None,
    )

    try:
        adapter.preflight()
        raised = None
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_unavailable"
    # Honest blocker message must name what is missing (script + kit prereqs).
    assert "converter script not found" in raised.message


def test_adapter_convert_blocks_instead_of_faking_when_prereqs_missing(tmp_path: Path):
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path)

    try:
        adapter.convert(
            job={"conversion_job_id": "stream_conv_x"},
            ifc_ready_event=ifc_ready_payload(),
            output_dir=tmp_path / "out",
        )
        raised = None
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_unavailable"
    # MUST NOT have produced any fake-ready artifacts.
    assert not (tmp_path / "out" / "model.usdc").exists()


def test_adapter_builds_powershell_command_and_confirms_usdc(tmp_path: Path, monkeypatch):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    ps1 = repo_root / "scripts" / "convert-ifc-to-usdc.ps1"
    ps1.write_text("# fake ps1", encoding="utf-8")
    kit_exe = repo_root / "kit.exe"
    kit_exe.write_text("", encoding="utf-8")
    hoops_main = repo_root / "hoops_main.py"
    hoops_main.write_text("", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "demo-model.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("IFC", encoding="utf-8")

    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        kit_exe_path=kit_exe,
        hoops_main_path=hoops_main,
        timeout_seconds=42,
        work_dir=repo_root,
    )
    # The fake subprocess emits converter-owned sidecars, so the adopt path
    # returns real metrics with no USD runtime needed (pxr is only required on
    # the enumeration fallback, not in preflight).

    captured = {}

    class _Completed:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        # emulate the ps1 producing only model.usdc
        out_dir = Path(cmd[cmd.index("-OutputDir") + 1])
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "model.usdc").write_bytes(b"PXR-USDC-real\n")
        # also emit converter-owned sidecars so _adopt path returns real metrics
        (out_dir / "element_mapping.json").write_text(
            '{"mock": false, "summary": {"mapped_count": 1, "fake_mapping_count": 0}}',
            encoding="utf-8",
        )
        (out_dir / "entity_index.json").write_text('{"entities": []}', encoding="utf-8")
        (out_dir / "metadata.json").write_text('{"source": "ifc_ready"}', encoding="utf-8")
        (out_dir / "quality_metrics.json").write_text(
            '{"coverage_status": "pass", "hard_quality_gates": '
            '{"usdc_openable": true, "has_renderable_prims": true}}',
            encoding="utf-8",
        )
        return _Completed()

    monkeypatch.setattr("subprocess.run", fake_run)

    result = adapter.convert(
        job={"conversion_job_id": "stream_conv_real"},
        ifc_ready_event=ifc_ready_payload(),
        output_dir=tmp_path / "out",
    )

    cmd = captured["cmd"]
    assert cmd[0] == "powershell.exe"
    assert "-NoProfile" in cmd
    assert "-ExecutionPolicy" in cmd and cmd[cmd.index("-ExecutionPolicy") + 1] == "Bypass"
    assert "-File" in cmd and cmd[cmd.index("-File") + 1] == str(ps1.resolve())
    assert cmd[cmd.index("-OutputName") + 1] == "model.usdc"
    assert cmd[cmd.index("-TimeoutSeconds") + 1] == "42"
    assert "-Force" in cmd
    assert captured["kwargs"]["shell"] is False
    assert captured["kwargs"]["cwd"] == str(repo_root)
    assert Path(result["model_path"]).name == "model.usdc"
    assert result["quality_metrics"]["coverage_status"] == "pass"


def test_adapter_from_env_keeps_unset_paths_none(tmp_path: Path):
    adapter = adapter_from_env(tmp_path, env={})
    assert adapter.kit_exe_path is None
    assert adapter.hoops_main_path is None
    assert adapter.timeout_seconds == 600


def test_adapter_from_env_prefers_pwsh_when_available(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "shutil.which",
        lambda name: "C:/Program Files/PowerShell/7/pwsh.exe" if name == "pwsh" else None,
    )

    adapter = adapter_from_env(tmp_path, env={})

    assert adapter.powershell_exe == "C:/Program Files/PowerShell/7/pwsh.exe"


def test_adapter_from_env_explicit_powershell_wins(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "shutil.which",
        lambda name: "C:/Program Files/PowerShell/7/pwsh.exe" if name == "pwsh" else None,
    )

    adapter = adapter_from_env(
        tmp_path,
        env={"STREAMING_CONVERSION_POWERSHELL_EXE": "powershell.exe"},
    )

    assert adapter.powershell_exe == "powershell.exe"


# --- streaming-server-prefer-local-ifc-path:dispatch payload local path resolution -----


def _adapter_with_storage(tmp_path: Path, *, storage_root: Path | None = None) -> Ifc2UsdcPowershellConverterAdapter:
    return Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        storage_root=storage_root,
    )


def test_adapter_resolve_prefers_host_local_path_inside_storage_root(tmp_path: Path):
    storage = tmp_path / "storage"
    ifc = storage / "ifc-cache" / "job_a" / "source.ifc"
    ifc.parent.mkdir(parents=True)
    ifc.write_bytes(b"IFC")
    adapter = _adapter_with_storage(tmp_path, storage_root=storage)
    event = ifc_ready_payload(
        ifc_artifact={
            "artifact_id": "artifact_local_001",
            "format": "ifc",
            "filename": "source.ifc",
            "url": "http://127.0.0.1:9000/should-not-be-fetched.ifc",
            "host_local_path": str(ifc),
        }
    )

    resolved = adapter._resolve_local_ifc(event)

    assert resolved == ifc.resolve()


def test_adapter_resolve_falls_back_to_local_path_when_host_local_path_missing(tmp_path: Path):
    storage = tmp_path / "storage"
    ifc = storage / "ifc-cache" / "job_b" / "source.ifc"
    ifc.parent.mkdir(parents=True)
    ifc.write_bytes(b"IFC")
    adapter = _adapter_with_storage(tmp_path, storage_root=storage)
    event = ifc_ready_payload(
        ifc_artifact={
            "artifact_id": "artifact_local_002",
            "format": "ifc",
            "filename": "source.ifc",
            "url": "http://127.0.0.1:9000/should-not-be-fetched.ifc",
            "local_path": str(ifc),
        }
    )

    resolved = adapter._resolve_local_ifc(event)

    assert resolved == ifc.resolve()


def test_adapter_resolve_falls_back_to_url_when_local_paths_unreadable(tmp_path: Path):
    """host_local_path/local_path 在 storage_root 內但檔案還沒寫好 → soft fallback url。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    # url 走 edge-local:// 解析(既有 _url_to_local_path 路徑)
    fixture_root = tmp_path / "fixtures"
    fixture_root.mkdir()
    ifc = fixture_root / "fallback.ifc"
    ifc.write_bytes(b"IFC")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        storage_root=storage,
        work_dir=tmp_path,
    )
    missing_local = storage / "ifc-cache" / "job_c" / "source.ifc"  # 不存在
    event = ifc_ready_payload(
        ifc_artifact={
            "artifact_id": "artifact_local_003",
            "format": "ifc",
            "filename": "fallback.ifc",
            "url": "edge-local://fixtures/fallback.ifc",
            "host_local_path": str(missing_local),
        }
    )

    resolved = adapter._resolve_local_ifc(event)

    assert resolved == ifc.resolve()


def test_adapter_resolve_rejects_local_path_outside_storage_root(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    outside = tmp_path / "outside" / "secret.ifc"
    outside.parent.mkdir()
    outside.write_bytes(b"OUT")
    adapter = _adapter_with_storage(tmp_path, storage_root=storage)
    event = ifc_ready_payload(
        ifc_artifact={
            "artifact_id": "artifact_local_004",
            "format": "ifc",
            "filename": "secret.ifc",
            "url": "edge-local://fixtures/demo-model.ifc",
            "host_local_path": str(outside),
        }
    )

    try:
        adapter._resolve_local_ifc(event)
        raised = None
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "invalid_ifc_input"
    assert "outside storage_root" in raised.message


def test_adapter_resolve_existing_edge_local_url_still_works(tmp_path: Path):
    """Regression guard:legacy edge-local:// url-only payload(無 local_path/host_local_path)仍能解析。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    ifc = tmp_path / "fixtures" / "demo-model.ifc"
    ifc.parent.mkdir()
    ifc.write_bytes(b"IFC")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        storage_root=storage,
        work_dir=tmp_path,
    )
    event = ifc_ready_payload()  # url=edge-local://fixtures/demo-model.ifc,無 local paths

    resolved = adapter._resolve_local_ifc(event)

    assert resolved == ifc.resolve()
