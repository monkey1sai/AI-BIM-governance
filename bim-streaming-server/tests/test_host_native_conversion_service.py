import hashlib
import json
import os
import stat
import subprocess
import sys
import types
from pathlib import Path

import pytest
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
    def preflight(self) -> None:
        # harden-host-native-conversion-service #4: a ready converter exposes a
        # passing preflight so GET /health can report status="ok". No-op = ready.
        return None

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        mapping_path = output_dir / "element_mapping.json"
        entity_index_path = output_dir / "entity_index.json"
        metadata_path = output_dir / "metadata.json"
        model_path.write_bytes(b"PXR-USDC-fake-openable\n")
        mapping_path.write_text(
            '{"mapping_provenance": "converter_verified", "mock": false, "allow_fake_mapping": false, "summary": {"mapped_count": 2, "fake_mapping_count": 0}, "items": []}',
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


@pytest.fixture(autouse=True)
def _default_storage_root(monkeypatch, tmp_path_factory):
    """harden-host-native-conversion-service #13: the adapter now refuses to fall
    back to ``Path.cwd()`` and requires an explicit sandbox base (STORAGE_ROOT env
    or ``storage_root=``). Adapter-constructing tests that do not pass an explicit
    ``storage_root`` rely on a configured ``STORAGE_ROOT``; set a per-test temp
    root so those constructions are sandboxed instead of raising. Tests asserting
    the *missing* STORAGE_ROOT contract override this with ``monkeypatch.delenv``.
    """
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path_factory.mktemp("storage_root")))


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
    # harden-internal-auth-and-config-hygiene #2: align the host-native enforcement
    # test with the authority layer's existing 401/403/202 ladder — a *present but
    # wrong* token MUST be rejected with 403 (distinct from 401 missing-token), not
    # silently accepted.
    invalid = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(),
        headers={"X-Internal-Conversion-Token": "wrong-token"},
    )
    valid = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(),
        headers={"X-Internal-Conversion-Token": "secret-token"},
    )

    assert missing.status_code == 401
    assert invalid.status_code == 403
    assert valid.status_code == 202


def test_host_native_load_config_reads_token_from_env():
    """harden-internal-auth-and-config-hygiene #2: load_config maps
    STREAMING_CONVERSION_INTERNAL_TOKEN into internal_conversion_token, and the
    `or None` normalization means an empty string is treated as "no token"
    (None) rather than an empty-but-truthy secret that would 401 every caller.
    """
    set_token = load_config({"STREAMING_CONVERSION_INTERNAL_TOKEN": "abc"})
    assert set_token.internal_conversion_token == "abc"

    blank_token = load_config({"STREAMING_CONVERSION_INTERNAL_TOKEN": ""})
    assert blank_token.internal_conversion_token is None


def test_host_native_service_unconfigured_token_keeps_demo_open(tmp_path: Path):
    """harden-internal-auth-and-config-hygiene #2 (regression guard): with no token
    configured (the default), the demo POST path stays open — an ifc-to-usdc
    request WITHOUT an X-Internal-Conversion-Token header still returns 202. This
    locks in that hardening the *configured* case never accidentally starts
    requiring a token when none is set.
    """
    client = _client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())

    assert response.status_code == 202


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
    expected_platform = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    assert expected_platform in raised.message
    assert "HOOPS entrypoint not found" in raised.message


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
            json.dumps(
                {
                    "mapping_provenance": "converter_verified",
                    "mock": False,
                    "allow_fake_mapping": False,
                    "summary": {"mapped_count": 1, "fake_mapping_count": 0},
                    "items": [
                        {
                            "ifc_guid": "2abc",
                            "usd_prim_path": "/World/IfcShape_000001",
                            "ifc_type": "IfcBuildingElementProxy",
                            "ifc_name": "Demo element",
                        }
                    ],
                }
            ),
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
        job={
            "conversion_job_id": "stream_conv_real",
            "trace_id": "ifcready_1779687625000_064c6813",
        },
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
    assert cmd.count("-TraceId") == 1
    assert cmd[cmd.index("-TraceId") + 1] == "ifcready_1779687625000_064c6813"
    assert captured["kwargs"]["shell"] is False
    assert captured["kwargs"]["cwd"] == str(repo_root)
    assert Path(result["model_path"]).name == "model.usdc"
    assert result["quality_metrics"]["coverage_status"] == "pass"


def test_adapter_from_env_keeps_unset_paths_none(tmp_path: Path):
    adapter = adapter_from_env(tmp_path, env={})
    assert adapter.kit_exe_path is None
    assert adapter.hoops_main_path is None
    assert adapter.timeout_seconds == 600


def _write_cad_converter_lock(repo_root: Path, version: str = "508.0.3") -> None:
    app_path = repo_root / "source" / "apps" / "ezplus.bim_ifc_usd_converter.kit"
    app_path.parent.mkdir(parents=True, exist_ok=True)
    app_path.write_text(
        '[settings.app.exts]\nenabled = [\n'
        f'    "omni.services.convert.cad-{version}",\n'
        ']\n',
        encoding="utf-8",
    )


def _cad_package_name(
    label: str,
    *,
    version: str = "508.0.3",
    platform_marker: str | None = None,
) -> str:
    marker = platform_marker or ("wx64" if sys.platform == "win32" else "lx64")
    return f"omni.services.convert.cad-{version}+110.0.0.{marker}.r.cp312.{label}"


def _write_trusted_cad_manifest(
    repo_root: Path,
    *,
    package_name: str,
    hoops_main: Path,
) -> None:
    platform_key = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    manifest_path = repo_root / "config" / "trusted-cad-entrypoints.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    body = hoops_main.read_bytes()
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": "trusted-cad-entrypoints/v1",
                "packages": {
                    platform_key: {
                        "extension_package": package_name,
                        "hoops_main_sha256": hashlib.sha256(body).hexdigest(),
                        "hoops_main_size": len(body),
                    }
                },
            }
        ),
        encoding="utf-8",
    )


def test_trusted_cad_entrypoint_rejects_opposite_platform_package(tmp_path: Path):
    _write_cad_converter_lock(tmp_path)
    hoops_main = tmp_path / "hoops_main.py"
    hoops_main.write_text("# fixture", encoding="utf-8")
    opposite_marker = "lx64" if sys.platform == "win32" else "wx64"
    _write_trusted_cad_manifest(
        tmp_path,
        package_name=_cad_package_name("wrong-platform", platform_marker=opposite_marker),
        hoops_main=hoops_main,
    )
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        storage_root=tmp_path / "storage",
    )

    with pytest.raises(ConversionAuthorityError, match="selected platform"):
        adapter._trusted_cad_entrypoint()


def _validated_explicit_hoops(
    adapter: Ifc2UsdcPowershellConverterAdapter,
) -> tuple[Path, tuple[int, int, int, int, str]]:
    hoops_main = adapter.repo_root / "fixture-hoops_main.py"
    hoops_main.write_text("# explicit fixture", encoding="utf-8")
    adapter.hoops_main_path = hoops_main
    resolved = hoops_main.resolve(strict=True)
    return resolved, adapter._hoops_file_identity(resolved)


@pytest.mark.skipif(os.name == "nt", reason="POSIX group ownership contract")
def test_group_privacy_fails_closed_when_user_database_is_not_enumerable(
    tmp_path: Path, monkeypatch
):
    import pwd

    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(pwd, "getpwall", lambda: [])

    assert adapter._group_is_private_to_process(os.getegid()) is False


@pytest.mark.skipif(os.name == "nt", reason="POSIX group ownership contract")
def test_group_privacy_result_is_cached_per_gid(tmp_path: Path, monkeypatch):
    import pwd

    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    group_id = os.getegid()
    enumerations = 0

    def _users():
        nonlocal enumerations
        enumerations += 1
        return [types.SimpleNamespace(pw_gid=group_id, pw_uid=os.geteuid())]

    monkeypatch.setattr(pwd, "getpwall", _users)

    assert adapter._group_is_private_to_process(group_id) is False
    assert adapter._group_is_private_to_process(group_id) is False
    assert enumerations == 0
    assert adapter._group_privacy_cache[group_id] is False


@pytest.mark.skipif(os.name == "nt", reason="POSIX group ownership contract")
def test_group_privacy_rejects_partial_nss_enumeration(tmp_path: Path, monkeypatch):
    import pwd

    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(
        pwd,
        "getpwall",
        lambda: [types.SimpleNamespace(pw_gid=os.getegid(), pw_uid=os.geteuid())],
    )

    assert adapter._group_is_private_to_process(os.getegid()) is False


def _write_symlinked_cad_package(
    *,
    release_root: Path,
    package_cache: Path,
    package_name: str,
    root_name: str = "extscache",
) -> tuple[Path, Path]:
    package_root = package_cache / package_name
    hoops_main = (
        package_root
        / "omni"
        / "services"
        / "convert"
        / "cad"
        / "services"
        / "process"
        / "hoops_main.py"
    )
    hoops_main.parent.mkdir(parents=True, exist_ok=True)
    hoops_main.write_text("# fixture", encoding="utf-8")
    extension_cache = release_root / root_name
    extension_cache.mkdir(parents=True, exist_ok=True)
    extension_link = extension_cache / package_name
    try:
        extension_link.symlink_to(package_root, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"directory symlinks are unavailable on this test host: {exc}")
    return extension_link, hoops_main


def test_default_hoops_entrypoint_resolves_pinned_owner_cache_symlink(
    tmp_path: Path, monkeypatch
):
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    release_root = tmp_path / "_build" / platform_dir / "release"
    package_cache = tmp_path / "official-cache"
    _write_cad_converter_lock(tmp_path)
    package_name = _cad_package_name("fixture")
    _, hoops_main = _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=package_cache,
        package_name=package_name,
    )
    _write_trusted_cad_manifest(tmp_path, package_name=package_name, hoops_main=hoops_main)

    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(adapter, "_trusted_extension_cache_roots", lambda: (package_cache,))

    resolved_hoops_main = adapter._default_hoops_main()

    assert resolved_hoops_main is not None
    assert resolved_hoops_main.resolve() == hoops_main.resolve()


def test_default_hoops_entrypoint_treats_junction_like_a_link(tmp_path: Path, monkeypatch):
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    release_root = tmp_path / "_build" / platform_dir / "release"
    package_cache = tmp_path / "official-cache"
    _write_cad_converter_lock(tmp_path)
    package_name = _cad_package_name("junction")
    extension_link, hoops_main = _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=package_cache,
        package_name=package_name,
    )
    _write_trusted_cad_manifest(tmp_path, package_name=package_name, hoops_main=hoops_main)
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(adapter, "_trusted_extension_cache_roots", lambda: (package_cache,))
    original_is_symlink = Path.is_symlink
    original_link_probe = adapter._path_is_directory_link
    monkeypatch.setattr(
        Path,
        "is_symlink",
        lambda path: False if path == extension_link else original_is_symlink(path),
    )
    monkeypatch.setattr(
        adapter,
        "_path_is_directory_link",
        lambda path: True if path == extension_link else original_link_probe(path),
    )

    resolved_hoops_main = adapter._default_hoops_main()

    assert resolved_hoops_main is not None
    assert resolved_hoops_main.resolve() == hoops_main.resolve()


def test_directory_link_probe_uses_reparse_attributes_without_path_is_junction():
    class LegacyJunctionPath:
        def is_symlink(self):
            return False

        def lstat(self):
            return type("LegacyWindowsStat", (), {"st_file_attributes": 0x400})()

    assert Ifc2UsdcPowershellConverterAdapter._path_is_directory_link(LegacyJunctionPath())


def test_directory_link_probe_fails_closed_when_link_state_cannot_be_read():
    class UninspectableLegacyPath:
        def is_symlink(self):
            return False

        def lstat(self):
            raise OSError("fixture access denied")

    with pytest.raises(ConversionAuthorityError, match="could not be inspected safely"):
        Ifc2UsdcPowershellConverterAdapter._path_is_directory_link(
            UninspectableLegacyPath()
        )


def test_windows_acl_policy_rejects_untrusted_owner_or_writer():
    current_user = "S-1-5-21-1000"
    trusted_admin = "S-1-5-32-544"
    everyone = "S-1-1-0"

    assert Ifc2UsdcPowershellConverterAdapter._windows_acl_has_only_trusted_writers(
        current_user,
        current_user,
        ((current_user, 0x40000000, False), (trusted_admin, 0x10000000, False)),
    )
    assert Ifc2UsdcPowershellConverterAdapter._windows_acl_has_only_trusted_writers(
        current_user,
        current_user,
        (("S-1-3-4", 0x10000000, False),),
    )
    assert not Ifc2UsdcPowershellConverterAdapter._windows_acl_has_only_trusted_writers(
        everyone,
        current_user,
        ((current_user, 0x40000000, False),),
    )
    assert not Ifc2UsdcPowershellConverterAdapter._windows_acl_has_only_trusted_writers(
        current_user,
        current_user,
        ((everyone, 0x40000000, False),),
    )
    assert Ifc2UsdcPowershellConverterAdapter._windows_acl_has_only_trusted_writers(
        current_user,
        current_user,
        ((everyone, 0x40000000, True),),
    )


@pytest.mark.skipif(os.name != "nt", reason="Windows security descriptor contract")
def test_windows_acl_snapshot_reads_current_temp_path(tmp_path: Path):
    owner_sid, current_user_sid, allow_aces = (
        Ifc2UsdcPowershellConverterAdapter._windows_path_security_snapshot(tmp_path)
    )

    assert owner_sid.startswith("S-1-")
    assert current_user_sid.startswith("S-1-")
    assert isinstance(allow_aces, tuple)


def test_default_hoops_entrypoint_rejects_symlink_outside_trusted_cache(
    tmp_path: Path, monkeypatch
):
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    release_root = tmp_path / "_build" / platform_dir / "release"
    trusted_cache = tmp_path / "official-cache"
    trusted_cache.mkdir()
    _write_cad_converter_lock(tmp_path)
    package_name = _cad_package_name("escape")
    _, hoops_main = _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=tmp_path / "untrusted-cache",
        package_name=package_name,
    )
    _write_trusted_cad_manifest(tmp_path, package_name=package_name, hoops_main=hoops_main)
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(adapter, "_trusted_extension_cache_roots", lambda: (trusted_cache,))

    with pytest.raises(ConversionAuthorityError, match="outside an owner-approved cache root"):
        adapter._default_hoops_main()


def test_default_hoops_entrypoint_rejects_unpinned_package_version(
    tmp_path: Path, monkeypatch
):
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    release_root = tmp_path / "_build" / platform_dir / "release"
    package_cache = tmp_path / "official-cache"
    _write_cad_converter_lock(tmp_path, version="508.0.3")
    _, hoops_main = _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=package_cache,
        package_name=_cad_package_name("unpinned", version="508.0.4"),
    )
    _write_trusted_cad_manifest(
        tmp_path,
        package_name=_cad_package_name("trusted"),
        hoops_main=hoops_main,
    )
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(adapter, "_trusted_extension_cache_roots", lambda: (package_cache,))

    with pytest.raises(ConversionAuthorityError, match="does not match the trusted package build"):
        adapter._default_hoops_main()


def test_default_hoops_entrypoint_rejects_unpinned_real_directory(tmp_path: Path):
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    release_root = tmp_path / "_build" / platform_dir / "release"
    package_name = _cad_package_name("unpinned", version="508.0.4")
    hoops_main = (
        release_root
        / "exts"
        / package_name
        / "omni"
        / "services"
        / "convert"
        / "cad"
        / "services"
        / "process"
        / "hoops_main.py"
    )
    hoops_main.parent.mkdir(parents=True)
    hoops_main.write_text("# fixture", encoding="utf-8")
    _write_cad_converter_lock(tmp_path, version="508.0.3")
    _write_trusted_cad_manifest(
        tmp_path,
        package_name=_cad_package_name("trusted"),
        hoops_main=hoops_main,
    )
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")

    with pytest.raises(ConversionAuthorityError, match="does not match the trusted package build"):
        adapter._default_hoops_main()


def test_default_hoops_entrypoint_rejects_linked_search_root(tmp_path: Path):
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    release_root = tmp_path / "_build" / platform_dir / "release"
    external_root = tmp_path / "external-exts"
    package_name = _cad_package_name("linked-root")
    hoops_main = (
        external_root
        / package_name
        / "omni"
        / "services"
        / "convert"
        / "cad"
        / "services"
        / "process"
        / "hoops_main.py"
    )
    hoops_main.parent.mkdir(parents=True)
    hoops_main.write_text("# fixture", encoding="utf-8")
    release_root.mkdir(parents=True)
    try:
        (release_root / "exts").symlink_to(external_root, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"directory symlinks are unavailable on this test host: {exc}")
    _write_cad_converter_lock(tmp_path)
    _write_trusted_cad_manifest(tmp_path, package_name=package_name, hoops_main=hoops_main)
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")

    with pytest.raises(ConversionAuthorityError, match="search root must not be a link or junction"):
        adapter._default_hoops_main()


def test_default_hoops_entrypoint_rejects_ambiguous_pinned_candidates(
    tmp_path: Path, monkeypatch
):
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    release_root = tmp_path / "_build" / platform_dir / "release"
    package_cache = tmp_path / "official-cache"
    _write_cad_converter_lock(tmp_path)
    package_name = _cad_package_name("ambiguous")
    _, hoops_main = _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=package_cache,
        package_name=package_name,
        root_name="extscache",
    )
    _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=package_cache,
        package_name=package_name,
        root_name="extsbuild",
    )
    _write_trusted_cad_manifest(tmp_path, package_name=package_name, hoops_main=hoops_main)
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(adapter, "_trusted_extension_cache_roots", lambda: (package_cache,))

    with pytest.raises(ConversionAuthorityError, match="Multiple CAD extension entrypoints"):
        adapter._default_hoops_main()


def test_powershell_conversion_rejects_hoops_path_swap_after_preflight(
    tmp_path: Path, monkeypatch
):
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    release_root = tmp_path / "_build" / platform_dir / "release"
    package_cache = tmp_path / "official-cache"
    _write_cad_converter_lock(tmp_path)
    package_name = _cad_package_name("swap")
    _, hoops_main = _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=package_cache,
        package_name=package_name,
    )
    _write_trusted_cad_manifest(tmp_path, package_name=package_name, hoops_main=hoops_main)
    kit_name = "kit.exe" if os.name == "nt" else "kit"
    kit_path = release_root / "kit" / kit_name
    kit_path.parent.mkdir(parents=True)
    kit_path.write_bytes(b"kit")
    ps1_path = tmp_path / "scripts" / "convert-ifc-to-usdc.ps1"
    ps1_path.parent.mkdir(parents=True)
    ps1_path.write_text("# fixture", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(adapter, "_trusted_extension_cache_roots", lambda: (package_cache,))
    monkeypatch.setattr(adapter, "_powershell_resolvable", lambda: True)
    validated_hoops_main, validated_hoops_identity = adapter._preflight_with_hoops_validation()
    assert not hasattr(adapter, "_validated_hoops_main_path")
    assert not hasattr(adapter, "_validated_hoops_main_identity")

    hoops_main.write_text("# swapped fixture with a different identity", encoding="utf-8")
    subprocess_called = False

    def _unexpected_subprocess(*args, **kwargs):
        nonlocal subprocess_called
        subprocess_called = True
        raise AssertionError("subprocess must not run after a HOOPS path identity change")

    monkeypatch.setattr("subprocess.run", _unexpected_subprocess)
    with pytest.raises(ConversionAuthorityError, match="content digest does not match"):
        adapter._run_powershell_conversion(
            ifc_path=tmp_path / "input.ifc",
            output_dir=tmp_path / "out",
            validated_hoops_main=validated_hoops_main,
            validated_hoops_identity=validated_hoops_identity,
        )
    assert subprocess_called is False


@pytest.mark.skipif(os.name != "nt", reason="Windows pinned-handle execution contract")
def test_windows_execution_guard_blocks_hoops_write_until_converter_exits(
    tmp_path: Path, monkeypatch
):
    private_root = tmp_path / "private-cad-cache"
    private_root.mkdir()
    hoops_main = private_root / "hoops_main.py"
    original = b"# pinned fixture"
    hoops_main.write_bytes(original)
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        hoops_main_path=hoops_main,
        storage_root=tmp_path / "storage",
    )
    validated = hoops_main.resolve(strict=True)
    identity = adapter._hoops_file_identity(validated)
    blocked_write = None

    def _attempt_write_while_converter_runs(args, **kwargs):
        nonlocal blocked_write
        try:
            hoops_main.write_bytes(b"# attacker replacement")
        except OSError as exc:
            blocked_write = exc
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("subprocess.run", _attempt_write_while_converter_runs)

    adapter._run_powershell_conversion(
        ifc_path=tmp_path / "input.ifc",
        output_dir=tmp_path / "out",
        validated_hoops_main=validated,
        validated_hoops_identity=identity,
    )

    assert blocked_write is not None
    assert hoops_main.read_bytes() == original


@pytest.mark.skipif(os.name != "nt", reason="Windows pinned-handle execution contract")
def test_windows_execution_guard_rejects_preopened_writer(
    tmp_path: Path, monkeypatch
):
    import ctypes
    from ctypes import wintypes

    private_root = tmp_path / "private-cad-cache"
    private_root.mkdir()
    hoops_main = private_root / "hoops_main.py"
    hoops_main.write_bytes(b"# pinned fixture")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        hoops_main_path=hoops_main,
        storage_root=tmp_path / "storage",
    )
    validated = hoops_main.resolve(strict=True)
    identity = adapter._hoops_file_identity(validated)
    subprocess_called = False

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateFileW.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    writer = kernel32.CreateFileW(
        str(hoops_main),
        0x40000000,  # GENERIC_WRITE
        0x00000001 | 0x00000002 | 0x00000004,  # share read/write/delete
        None,
        3,  # OPEN_EXISTING
        0x00000080,  # FILE_ATTRIBUTE_NORMAL
        None,
    )
    writer_value = int(writer) if writer is not None else 0
    assert writer_value not in (0, ctypes.c_void_p(-1).value)

    def _unexpected_subprocess(*args, **kwargs):
        nonlocal subprocess_called
        subprocess_called = True
        raise AssertionError("subprocess must not run with a pre-opened HOOPS writer")

    monkeypatch.setattr("subprocess.run", _unexpected_subprocess)
    try:
        with pytest.raises(ConversionAuthorityError, match="could not be pinned safely"):
            adapter._run_powershell_conversion(
                ifc_path=tmp_path / "input.ifc",
                output_dir=tmp_path / "out",
                validated_hoops_main=validated,
                validated_hoops_identity=identity,
            )
    finally:
        kernel32.CloseHandle(wintypes.HANDLE(writer_value))

    assert subprocess_called is False


@pytest.mark.skipif(os.name == "nt", reason="POSIX atomic replacement contract")
def test_hardener_atomically_replaces_pinned_entrypoint_with_private_inode(
    tmp_path: Path, monkeypatch
):
    release_root = tmp_path / "_build" / "linux-x86_64" / "release"
    package_cache = tmp_path / "official-cache"
    _write_cad_converter_lock(tmp_path)
    package_name = _cad_package_name("permissions")
    _, hoops_main = _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=package_cache,
        package_name=package_name,
    )
    _write_trusted_cad_manifest(tmp_path, package_name=package_name, hoops_main=hoops_main)
    hoops_main.chmod(0o777)
    original_identity = (hoops_main.stat().st_dev, hoops_main.stat().st_ino)
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(adapter, "_trusted_extension_cache_roots", lambda: (package_cache,))

    hardened = adapter.harden_default_hoops_main_permissions()

    assert hardened.resolve() == hoops_main.resolve()
    assert (hardened.stat().st_dev, hardened.stat().st_ino) != original_identity
    assert stat.S_IMODE(hardened.stat().st_mode) & (stat.S_IWGRP | stat.S_IWOTH) == 0


@pytest.mark.skipif(os.name == "nt", reason="POSIX private-inode idempotency contract")
def test_hardener_preserves_already_private_pinned_entrypoint_inode(
    tmp_path: Path, monkeypatch
):
    release_root = tmp_path / "_build" / "linux-x86_64" / "release"
    package_cache = tmp_path / "official-cache"
    _write_cad_converter_lock(tmp_path)
    package_name = _cad_package_name("already-private")
    _, hoops_main = _write_symlinked_cad_package(
        release_root=release_root,
        package_cache=package_cache,
        package_name=package_name,
    )
    _write_trusted_cad_manifest(tmp_path, package_name=package_name, hoops_main=hoops_main)
    hoops_main.chmod(0o400)
    original_identity = (hoops_main.stat().st_dev, hoops_main.stat().st_ino)
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path, storage_root=tmp_path / "storage"
    )
    monkeypatch.setattr(adapter, "_trusted_extension_cache_roots", lambda: (package_cache,))

    hardened = adapter.harden_default_hoops_main_permissions()

    assert (hardened.stat().st_dev, hardened.stat().st_ino) == original_identity
    assert stat.S_IMODE(hardened.stat().st_mode) == 0o400


@pytest.mark.skipif(os.name == "nt", reason="POSIX descriptor hardening contract")
def test_hardener_rejects_oversized_inode_before_reading(tmp_path: Path, monkeypatch):
    hoops_main = tmp_path / "hoops_main.py"
    hoops_main.write_bytes(b"oversized")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=tmp_path / "storage")
    monkeypatch.setattr(adapter, "_discover_default_hoops_main", lambda **kwargs: hoops_main)
    monkeypatch.setattr(adapter, "_trusted_cad_entrypoint", lambda: ("fixture-package", "0" * 64, 1))
    monkeypatch.setattr(
        adapter,
        "_open_owner_private_parent_descriptor",
        lambda candidate: os.open(candidate.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)),
    )
    read_called = False
    real_read = os.read

    def _read(*args, **kwargs):
        nonlocal read_called
        read_called = True
        return real_read(*args, **kwargs)

    monkeypatch.setattr(os, "read", _read)

    with pytest.raises(ConversionAuthorityError, match="size changed before atomic hardening"):
        adapter.harden_default_hoops_main_permissions()
    assert read_called is False


def test_cad_hardener_argument_failure_emits_structured_status(tmp_path: Path):
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "harden-cad-extension-cache.py"
    completed = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 1
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    assert payload == {
        "reason_kind": "invalid_arguments",
        "schema_version": "cad-extension-cache-hardening/v1",
        "status": "failed",
    }


def test_cad_hardener_import_failure_emits_structured_status(tmp_path: Path):
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "harden-cad-extension-cache.py"
    clean_env = dict(os.environ)
    clean_env["PYTHONPATH"] = ""
    clean_env["PYTHONNOUSERSITE"] = "1"
    completed = subprocess.run(
        [sys.executable, str(script_path), "--repo-root", str(tmp_path)],
        cwd=tmp_path,
        env=clean_env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 1
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    assert payload == {
        "reason_kind": "unexpected_error",
        "schema_version": "cad-extension-cache-hardening/v1",
        "status": "failed",
    }


def test_adapter_from_env_prefers_pwsh_when_available(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "shutil.which",
        lambda name: "C:/Program Files/PowerShell/7/pwsh.exe" if name == "pwsh" else None,
    )

    adapter = adapter_from_env(tmp_path, env={})

    assert adapter.powershell_exe == "C:/Program Files/PowerShell/7/pwsh.exe"


def test_direct_adapter_prefers_pwsh_when_available(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "shutil.which",
        lambda name: "/usr/bin/pwsh" if name == "pwsh" else None,
    )

    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        storage_root=tmp_path,
    )

    assert adapter.powershell_exe == "/usr/bin/pwsh"


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


# --- streaming-server-capture-kit-conversion-logs:ConversionAuthorityError.metadata
#     propagates through _fail_job into result.error so callers can read Kit
#     subprocess stdout/stderr log paths without re-running the conversion.


class FakeConverterWithLogPaths:
    """Fixture converter that raises with kit_stdout_log / kit_stderr_log metadata."""

    def __init__(self, stdout_log: str, stderr_log: str):
        self._stdout_log = stdout_log
        self._stderr_log = stderr_log

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        raise ConversionAuthorityError(
            "converter_failed",
            "convert-ifc-to-usdc.ps1 exited 1: ...stderr tail...",
            metadata={
                "kit_stdout_log": self._stdout_log,
                "kit_stderr_log": self._stderr_log,
            },
        )


def test_failed_conversion_surfaces_kit_log_paths_in_result_error(tmp_path: Path):
    stdout_log = str(tmp_path / "artifacts" / "demo" / "kit-stdout.log")
    stderr_log = str(tmp_path / "artifacts" / "demo" / "kit-stderr.log")
    client = _client(
        tmp_path,
        converter=FakeConverterWithLogPaths(stdout_log=stdout_log, stderr_log=stderr_log),
    )

    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    error = result["error"]
    assert error["code"] == "converter_failed"
    assert error["kit_stdout_log"] == stdout_log
    assert error["kit_stderr_log"] == stderr_log


def test_failed_conversion_without_metadata_still_works(tmp_path: Path):
    """Regression guard:既有 ConversionAuthorityError 不帶 metadata 不應破。"""
    client = _client(tmp_path, converter=FakeFailedConverter())
    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    error = result["error"]
    assert error["code"] == "converter_failed"
    # 沒 metadata 時不該硬加 keys
    assert "kit_stdout_log" not in error
    assert "kit_stderr_log" not in error


def test_run_powershell_conversion_regex_extracts_log_paths_from_ps1_throw(tmp_path: Path, monkeypatch):
    """Review Important #2:lock in ps1 throw shape ↔ Python regex 契約。
    monkeypatch subprocess.run 返回 ps1 真實 throw heredoc 形狀,assert
    `_run_powershell_conversion` 拋出 ConversionAuthorityError 且 metadata 含兩個 path。
    包含 Windows path 內的冒號(`C:\\...`)與空格,測 regex 不會被 drive-letter colon 截斷。
    """
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root)
    validated_hoops_main, validated_hoops_identity = _validated_explicit_hoops(adapter)

    # 真實 ps1 throw shape(對齊 convert-ifc-to-usdc.ps1::Invoke-KitConversion）。
    # harden-host-native-conversion-service #11:log path 改由結構化 sentinel
    # `##CONV_META## {json}` 抽取(非脆弱 prose regex);保留人類可讀 prose 兩行
    # 供 operator 閱讀。JSON string 內 Windows path 的反斜線須跳脫(json.dumps 處理)。
    stdout_log_path = r"C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_cache\host-native-conversion\artifacts\stream_conv_demo\kit-stdout.log"
    stderr_log_path = r"C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_cache\host-native-conversion\artifacts\stream_conv_demo\kit-stderr.log"
    sentinel = "##CONV_META## " + json.dumps(
        {"kit_stdout_log": stdout_log_path, "kit_stderr_log": stderr_log_path}
    )
    ps1_throw = (
        "Kit CAD conversion completed but output was not created: C:\\foo\\model.usdc\n"
        f"{sentinel}\n"
        f"  kit_stdout_log: {stdout_log_path}\n"
        f"  kit_stderr_log: {stderr_log_path}\n"
        "  ---- stderr tail (last 100 lines) ----\n"
        "<fake stderr lines>\n"
        "  ---- stdout tail (last 50 lines) ----\n"
        "<fake stdout lines>\n"
    )

    class _FakeCompleted:
        returncode = 1
        stderr = ps1_throw
        stdout = ""

    def _fake_run(*args, **kwargs):
        return _FakeCompleted()

    monkeypatch.setattr("subprocess.run", _fake_run)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_powershell_conversion(
            ifc_path=tmp_path / "fake.ifc",
            output_dir=tmp_path / "out",
            validated_hoops_main=validated_hoops_main,
            validated_hoops_identity=validated_hoops_identity,
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_failed"
    assert raised.metadata.get("kit_stdout_log") == stdout_log_path
    assert raised.metadata.get("kit_stderr_log") == stderr_log_path
    # spec scenario 1:message MUST contain the tail header substring + log paths
    assert "kit_stdout_log:" in raised.message
    assert "kit_stderr_log:" in raised.message
    assert "---- stderr tail (last 100 lines) ----" in raised.message


# --- fix-ifc-usdc-hoops-load-failure:HOOPS import failure uses real fallback ----


def _write_minimal_converter_sidecars(output_dir: Path) -> None:
    (output_dir / "model.usdc").write_bytes(b"PXR-USDC-real-fallback\n")
    (output_dir / "element_mapping.json").write_text(
        json.dumps(
            {
                "mapping_provenance": "converter_verified",
                "mock": False,
                "allow_fake_mapping": False,
                "summary": {"mapped_count": 1, "fake_mapping_count": 0},
                "items": [
                    {
                        "ifc_guid": "2abc",
                        "usd_prim_path": "/World/IfcShape_000001",
                        "ifc_type": "IfcBuildingElementProxy",
                        "ifc_name": "Demo element",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (output_dir / "entity_index.json").write_text(
        json.dumps({"entities": [{"usd_prim_path": "/World/IfcShape_000001"}]}),
        encoding="utf-8",
    )
    (output_dir / "metadata.json").write_text(
        json.dumps({"source": "ifcopenshell_openusd_fallback"}),
        encoding="utf-8",
    )
    (output_dir / "quality_metrics.json").write_text(
        json.dumps(
            {
                "source_ifc_entity_count": 1,
                "mapped_count": 1,
                "unmapped_count": 0,
                "coverage_ratio": 1.0,
                "coverage_status": "pass",
                "materialization_strategy": "ifcopenshell_openusd_fallback",
                "sidecar_carrier_count": 1,
                "minimum_coverage_baseline_locked": False,
                "hard_quality_gates": {
                    "usdc_openable": True,
                    "has_renderable_prims": True,
                    "placeholder_output": False,
                },
            }
        ),
        encoding="utf-8",
    )


def _write_default_converter_prereqs(repo_root: Path) -> None:
    """Materialize the platform defaults so downstream convert tests reach their subject."""
    platform_dir = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    kit_name = "kit.exe" if os.name == "nt" else "kit"
    release_root = repo_root / "_build" / platform_dir / "release"
    kit_path = release_root / "kit" / kit_name
    kit_path.parent.mkdir(parents=True, exist_ok=True)
    kit_path.write_bytes(b"fixture")
    package_name = _cad_package_name("u7f4", version="508.0.1")
    hoops_path = (
        release_root
        / "exts"
        / package_name
        / "omni"
        / "services"
        / "convert"
        / "cad"
        / "services"
        / "process"
        / "hoops_main.py"
    )
    hoops_path.parent.mkdir(parents=True, exist_ok=True)
    hoops_path.write_text("# fixture", encoding="utf-8")
    _write_cad_converter_lock(repo_root, version="508.0.1")
    _write_trusted_cad_manifest(repo_root, package_name=package_name, hoops_main=hoops_path)


def _clear_pxr_test_stubs(monkeypatch) -> None:
    for name in ("pxr", "pxr.Gf", "pxr.Sdf", "pxr.Usd", "pxr.UsdGeom", "pxr.UsdLux"):
        monkeypatch.delitem(sys.modules, name, raising=False)


# --- author-ifc-openusd-identity-paths: IFC-first OpenUSD identity authoring ---


def test_identity_path_generation_is_deterministic_usd_safe_and_preserves_originals():
    from ifc_openusd_identity_author import build_identity_root_path, usd_safe_identifier

    encoded_class = usd_safe_identifier("Ifc Wall/Type", fallback="Unclassified")
    encoded_guid = usd_safe_identifier("19nzyxtx5CXwVzdF/4phxj", fallback="Shape")
    identity = build_identity_root_path("Ifc Wall/Type", "19nzyxtx5CXwVzdF/4phxj")

    assert encoded_class == "Ifc_Wall_Type"
    assert encoded_guid == "_19nzyxtx5CXwVzdF_4phxj"
    assert identity.path == "/World/Elements/Ifc_Wall_Type/G_19nzyxtx5CXwVzdF_4phxj"
    assert identity.ifc_type == "Ifc Wall/Type"
    assert identity.ifc_guid == "19nzyxtx5CXwVzdF/4phxj"
    assert identity.class_token == "Ifc_Wall_Type"
    assert identity.guid_token == "G_19nzyxtx5CXwVzdF_4phxj"


def _install_fake_identity_ifcopenshell(
    monkeypatch,
    shapes: list[dict[str, str]],
) -> None:
    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

        def by_type(self, name: str):
            if name == "IfcProduct":
                return [
                    _FakeIfcProduct(
                        guid=shape["guid"],
                        ifc_type=shape["ifc_type"],
                        name=shape.get("name"),
                    )
                    for shape in shapes
                ]
            return []

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = (0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        faces = (0, 1, 2)

    class FakeShape:
        def __init__(self, spec: dict[str, str]):
            self.guid = spec["guid"]
            self.name = spec.get("name") or ""
            self.type = spec["ifc_type"]
            self.geometry = FakeGeometry()

    class FakeIterator:
        def __init__(self):
            self._shapes = [FakeShape(shape) for shape in shapes]
            self._index = 0

        def initialize(self) -> bool:
            return len(self._shapes) > 0

        def get(self):
            return self._shapes[self._index]

        def next(self) -> bool:
            self._index += 1
            return self._index < len(self._shapes)

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator()
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)


def _run_identity_authoring(
    tmp_path: Path,
    monkeypatch,
    *,
    shapes: list[dict[str, str]],
) -> tuple[Path, dict[str, Path], dict]:
    _clear_pxr_test_stubs(monkeypatch)
    _install_fake_identity_ifcopenshell(monkeypatch, shapes)
    ifc_file = tmp_path / "source.ifc"
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    output_dir = tmp_path / "identity-out"

    from ifc_openusd_identity_author import IfcOpenUsdIdentityAuthor

    result = IfcOpenUsdIdentityAuthor(
        ifc_path=ifc_file,
        output_dir=output_dir,
        source_model_version_id="version_identity_001",
    ).author()
    paths = {key: Path(value) for key, value in result["paths"].items()}
    quality_metrics = result["quality_metrics"]
    return output_dir, paths, quality_metrics


def test_identity_authoring_creates_stable_element_roots_and_split_mesh_children(
    tmp_path: Path,
    monkeypatch,
):
    output_dir, paths, _metrics = _run_identity_authoring(
        tmp_path,
        monkeypatch,
        shapes=[
            {"guid": "GUID_A", "name": "Wall body A", "ifc_type": "IfcWall"},
            {"guid": "GUID_A", "name": "Wall body B", "ifc_type": "IfcWall"},
        ],
    )

    from pxr import Usd

    stage = Usd.Stage.Open(str(paths["model_path"]))
    assert stage is not None
    root_path = "/World/Elements/IfcWall/G_GUID_A"
    root = stage.GetPrimAtPath(root_path)
    assert root.IsValid()
    assert root.GetCustomDataByKey("bim:ifc_guid") == "GUID_A"
    assert root.GetCustomDataByKey("bim:ifc_type") == "IfcWall"
    assert root.GetCustomDataByKey("bim:ifc_name") == "Wall body A"
    assert root.GetCustomDataByKey("bim:source_model_version_id") == "version_identity_001"
    assert stage.GetPrimAtPath(f"{root_path}/Body_000").IsValid()
    assert stage.GetPrimAtPath(f"{root_path}/Body_001").IsValid()

    mapping = json.loads((output_dir / "element_mapping.json").read_text(encoding="utf-8"))
    assert mapping["mapping_fidelity"] == "guid_exact"
    assert mapping["items"] == [
        {
            "ifc_guid": "GUID_A",
            "usd_prim_path": root_path,
            "ifc_type": "IfcWall",
            "ifc_class": "IfcWall",
            "ifc_name": "Wall body A",
            "entity_id": "ifc:GUID_A",
            "mapping_fidelity": "guid_exact",
        }
    ]


def test_identity_authoring_emits_guid_exact_mapping_and_joinable_geo_indexes(
    tmp_path: Path,
    monkeypatch,
):
    output_dir, paths, metrics = _run_identity_authoring(
        tmp_path,
        monkeypatch,
        shapes=[
            {"guid": "GUID_WALL", "name": "Wall", "ifc_type": "IfcWall"},
            {"guid": "GUID_DOOR", "name": "Door", "ifc_type": "IfcDoor"},
        ],
    )

    expected_paths = {
        "model_path",
        "mapping_path",
        "entity_index_path",
        "metadata_path",
        "pset_index_path",
        "spatial_index_path",
        "bbox_index_path",
        "quality_metrics_path",
        "geo_reference_path",
    }
    assert expected_paths.issubset(paths.keys())
    for key in expected_paths:
        assert paths[key].is_file(), key

    mapping = json.loads((output_dir / "element_mapping.json").read_text(encoding="utf-8"))
    entity_index = json.loads((output_dir / "entity_index.json").read_text(encoding="utf-8"))
    pset_index = json.loads((output_dir / "pset_index.json").read_text(encoding="utf-8"))
    spatial_index = json.loads((output_dir / "spatial_index.json").read_text(encoding="utf-8"))
    bbox_index = json.loads((output_dir / "bbox_index.json").read_text(encoding="utf-8"))
    quality = json.loads((output_dir / "quality_metrics.json").read_text(encoding="utf-8"))

    assert mapping["format_version"] == 2
    assert mapping["mapping_fidelity"] == "guid_exact"
    mapping_ids = {item["entity_id"] for item in mapping["items"]}
    assert mapping_ids == {"ifc:GUID_WALL", "ifc:GUID_DOOR"}
    for doc in (entity_index, pset_index, spatial_index, bbox_index):
        assert {item["entity_id"] for item in doc["items"]} == mapping_ids
    for item in bbox_index["items"]:
        assert len(item["bbox_local"]) == 6
        assert item["bbox_world"] is None
    assert metrics["mapping_fidelity"] == quality["mapping_fidelity"] == "guid_exact"
    assert quality["identity_authoring_profile"] == "ifcopenshell_openusd_identity"
    assert quality["hard_quality_gates"]["usdc_openable"] is True
    assert quality["hard_quality_gates"]["has_renderable_prims"] is True


def test_identity_authoring_writes_psets_and_spatial_relationships_as_sidecars(
    tmp_path: Path,
    monkeypatch,
):
    _clear_pxr_test_stubs(monkeypatch)
    _install_fake_identity_ifcopenshell(
        monkeypatch,
        [{"guid": "GUID_SIDE_DATA", "name": "Side data wall", "ifc_type": "IfcWall"}],
    )
    ifc_file = tmp_path / "source.ifc"
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    output_dir = tmp_path / "identity-out"

    from ifc_openusd_identity_author import IfcOpenUsdIdentityAuthor

    monkeypatch.setattr(
        IfcOpenUsdIdentityAuthor,
        "_product_by_guid",
        lambda self, ifc_model, ifc_guid: {"guid": ifc_guid},
    )
    monkeypatch.setattr(
        IfcOpenUsdIdentityAuthor,
        "_extract_psets",
        lambda self, product: {"Pset_WallCommon": {"FireRating": "2hr"}},
    )
    monkeypatch.setattr(
        IfcOpenUsdIdentityAuthor,
        "_extract_spatial_relationships",
        lambda self, product: [
            {
                "type": "spatial_container",
                "related_entity_id": "ifc:STOREY_GUID",
                "related_ifc_type": "IfcBuildingStorey",
                "related_name": "Level 01",
            }
        ],
    )

    IfcOpenUsdIdentityAuthor(ifc_path=ifc_file, output_dir=output_dir).author()

    psets = json.loads((output_dir / "pset_index.json").read_text(encoding="utf-8"))
    spatial = json.loads((output_dir / "spatial_index.json").read_text(encoding="utf-8"))

    assert psets["items"][0]["entity_id"] == "ifc:GUID_SIDE_DATA"
    assert psets["items"][0]["psets"]["Pset_WallCommon"]["FireRating"] == "2hr"
    assert spatial["items"][0]["usd_prim_path"] == "/World/Elements/IfcWall/G_GUID_SIDE_DATA"
    assert spatial["items"][0]["relationships"] == [
        {
            "type": "spatial_container",
            "related_entity_id": "ifc:STOREY_GUID",
            "related_ifc_type": "IfcBuildingStorey",
            "related_name": "Level 01",
        }
    ]
    assert "/Level" not in spatial["items"][0]["usd_prim_path"]


def test_identity_authoring_missing_geo_records_quality_warning_not_fabricated(
    tmp_path: Path,
    monkeypatch,
):
    output_dir, _paths, metrics = _run_identity_authoring(
        tmp_path,
        monkeypatch,
        shapes=[{"guid": "GUID_GEO", "name": "Geo missing", "ifc_type": "IfcColumn"}],
    )

    geo = json.loads((output_dir / "geo_reference.json").read_text(encoding="utf-8"))
    assert geo["available"] is False
    assert geo["crs"] is None
    assert geo["model_to_world_matrix"] is None
    assert "geo_reference_missing" in geo["warnings"]
    assert "geo_reference_missing" in metrics["warnings"]


def test_sidecar_ordinal_mapping_is_explicitly_not_guid_exact(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    _write_usd_stage_with_ifc_prims(usdc, [{"path": "/World/NakedMesh"}])
    _write_sidecar_doc(
        out_dir,
        [{"ifc_guid": "GUID_SIDE", "ifc_type": "IfcWall", "ifc_name": "Sidecar wall", "shape_index": 0}],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    assert quality["mapping_fidelity"] == "sidecar_ordinal"
    mapping = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    assert mapping["mapping_fidelity"] == "sidecar_ordinal"


def test_identity_profile_convert_uses_ifc_directly_without_powershell_or_revit(
    tmp_path: Path,
    monkeypatch,
):
    _clear_pxr_test_stubs(monkeypatch)
    _install_fake_identity_ifcopenshell(
        monkeypatch,
        [{"guid": "GUID_PROFILE", "name": "Profile wall", "ifc_type": "IfcWall"}],
    )
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    def powershell_must_not_run(**_kwargs):
        raise AssertionError("identity profile must not require PowerShell, HOOPS, Revit Connector, or Revit add-in")

    monkeypatch.setattr(adapter, "_run_powershell_conversion", powershell_must_not_run)

    result = adapter.convert(
        job={
            "conversion_job_id": "stream_conv_identity",
            "conversion_profile": "ifcopenshell_openusd_identity",
            "model_version_id": "version_identity_001",
        },
        ifc_ready_event=ifc_ready_payload(
            conversion_profile="ifcopenshell_openusd_identity",
            ifc_artifact={
                "artifact_id": "artifact_ifc_identity",
                "format": "ifc",
                "filename": "source.ifc",
                "url": "edge-local://fixtures/source.ifc",
            },
        ),
        output_dir=tmp_path / "out",
    )

    assert Path(result["model_path"]).is_file()
    assert result["quality_metrics"]["identity_authoring_profile"] == "ifcopenshell_openusd_identity"
    assert result["quality_metrics"]["mapping_fidelity"] == "guid_exact"
    assert Path(result["pset_index_path"]).name == "pset_index.json"
    assert Path(result["geo_reference_path"]).name == "geo_reference.json"


def test_adapter_falls_back_when_hoops_cannot_load_parseable_ifc(tmp_path: Path, monkeypatch):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    _write_default_converter_prereqs(repo_root)
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        work_dir=repo_root,
    )

    def fake_primary_failure(
        *,
        ifc_path: Path,
        output_dir: Path,
        trace_id: str,
        validated_hoops_main: Path,
        validated_hoops_identity: tuple[int, int, int, int, str],
    ) -> None:
        raise ConversionAuthorityError(
            "converter_failed",
            "Failed to import model C:/source.ifc. Error Code -10007 (A3D_LOAD_CANNOT_LOAD_MODEL)",
        )

    fallback_called = {}

    def fake_fallback(*, ifc_path: Path, output_dir: Path, primary_error: ConversionAuthorityError) -> None:
        fallback_called["ifc_path"] = ifc_path
        fallback_called["primary_error"] = primary_error.message
        output_dir.mkdir(parents=True, exist_ok=True)
        _write_minimal_converter_sidecars(output_dir)

    monkeypatch.setattr(adapter, "_run_powershell_conversion", fake_primary_failure)
    monkeypatch.setattr(adapter, "_run_ifcopenshell_openusd_fallback", fake_fallback, raising=False)

    result = adapter.convert(
        job={"conversion_job_id": "stream_conv_fallback"},
        ifc_ready_event=ifc_ready_payload(
            ifc_artifact={
                "artifact_id": "artifact_ifc_fallback",
                "format": "ifc",
                "filename": "source.ifc",
                "url": "edge-local://fixtures/source.ifc",
            }
        ),
        output_dir=tmp_path / "out",
    )

    assert fallback_called["ifc_path"] == ifc_file.resolve()
    assert "A3D_LOAD_CANNOT_LOAD_MODEL" in fallback_called["primary_error"]
    assert Path(result["model_path"]).name == "model.usdc"
    assert result["quality_metrics"]["materialization_strategy"] == "ifcopenshell_openusd_fallback"


def test_adapter_does_not_fallback_for_non_import_converter_failure(tmp_path: Path, monkeypatch):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    _write_default_converter_prereqs(repo_root)
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        work_dir=repo_root,
    )

    def fake_primary_failure(
        *,
        ifc_path: Path,
        output_dir: Path,
        trace_id: str,
        validated_hoops_main: Path,
        validated_hoops_identity: tuple[int, int, int, int, str],
    ) -> None:
        raise ConversionAuthorityError("converter_failed", "license checkout failed")

    def fallback_must_not_run(**_kwargs) -> None:
        raise AssertionError("fallback should only run for primary IFC import failures")

    monkeypatch.setattr(adapter, "_run_powershell_conversion", fake_primary_failure)
    monkeypatch.setattr(adapter, "_run_ifcopenshell_openusd_fallback", fallback_must_not_run, raising=False)

    raised: ConversionAuthorityError | None = None
    try:
        adapter.convert(
            job={"conversion_job_id": "stream_conv_no_fallback"},
            ifc_ready_event=ifc_ready_payload(
                ifc_artifact={
                    "artifact_id": "artifact_ifc_no_fallback",
                    "format": "ifc",
                    "filename": "source.ifc",
                    "url": "edge-local://fixtures/source.ifc",
                }
            ),
            output_dir=tmp_path / "out",
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_failed"
    assert raised.message == "license checkout failed"


def test_adapter_rejects_placeholder_written_by_fallback(tmp_path: Path, monkeypatch):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    _write_default_converter_prereqs(repo_root)
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        work_dir=repo_root,
    )

    def fake_primary_failure(
        *,
        ifc_path: Path,
        output_dir: Path,
        trace_id: str,
        validated_hoops_main: Path,
        validated_hoops_identity: tuple[int, int, int, int, str],
    ) -> None:
        raise ConversionAuthorityError(
            "converter_failed",
            "Failed to import model C:/source.ifc. Error Code -10007 (A3D_LOAD_CANNOT_LOAD_MODEL)",
        )

    def fake_placeholder_fallback(**kwargs) -> None:
        output_dir = kwargs["output_dir"]
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "model.usdc").write_bytes(b"worker adapter usdc placeholder\n")

    monkeypatch.setattr(adapter, "_run_powershell_conversion", fake_primary_failure)
    monkeypatch.setattr(
        adapter,
        "_run_ifcopenshell_openusd_fallback",
        fake_placeholder_fallback,
        raising=False,
    )

    raised: ConversionAuthorityError | None = None
    try:
        adapter.convert(
            job={"conversion_job_id": "stream_conv_placeholder"},
            ifc_ready_event=ifc_ready_payload(
                ifc_artifact={
                    "artifact_id": "artifact_ifc_placeholder",
                    "format": "ifc",
                    "filename": "source.ifc",
                    "url": "edge-local://fixtures/source.ifc",
                }
            ),
            output_dir=tmp_path / "out",
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "placeholder_usdc"


def test_ifcopenshell_openusd_fallback_writes_openable_usdc_and_sidecars(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

        def by_type(self, name: str):
            return [object(), object()] if name == "IfcProduct" else []

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = (0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        faces = (0, 1, 2)

    class FakeShape:
        guid = "2abc"
        name = "Demo element"
        type = "IfcBuildingElementProxy"
        geometry = FakeGeometry()

    class FakeIterator:
        def __init__(self):
            self.done = False

        def initialize(self) -> bool:
            return True

        def get(self):
            return FakeShape()

        def next(self) -> bool:
            if self.done:
                return False
            self.done = True
            return False

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator()
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)

    output_dir = tmp_path / "out"
    adapter._run_ifcopenshell_openusd_fallback(
        ifc_path=ifc_file,
        output_dir=output_dir,
        primary_error=ConversionAuthorityError("converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"),
    )

    from pxr import Usd

    assert Usd.Stage.Open(str(output_dir / "model.usdc")) is not None
    mapping = json.loads((output_dir / "element_mapping.json").read_text(encoding="utf-8"))
    metrics = json.loads((output_dir / "quality_metrics.json").read_text(encoding="utf-8"))
    assert mapping["mock"] is False
    assert mapping["summary"]["mapped_count"] == 1
    assert mapping["summary"]["fake_mapping_count"] == 0
    assert metrics["materialization_strategy"] == "ifcopenshell_openusd_fallback"
    assert metrics["hard_quality_gates"]["usdc_openable"] is True
    assert metrics["hard_quality_gates"]["has_renderable_prims"] is True


def test_ifcopenshell_openusd_fallback_missing_dependency_remains_unavailable(
    tmp_path: Path, monkeypatch
):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)
    monkeypatch.setitem(sys.modules, "ifcopenshell", None)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_ifcopenshell_openusd_fallback(
            ifc_path=ifc_file,
            output_dir=tmp_path / "out",
            primary_error=ConversionAuthorityError(
                "converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"
            ),
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_unavailable"


def test_ifcopenshell_openusd_fallback_rejects_no_renderable_geometry(
    tmp_path: Path, monkeypatch
):
    _clear_pxr_test_stubs(monkeypatch)
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = ()
        faces = ()

    class FakeShape:
        guid = "2abc"
        geometry = FakeGeometry()

    class FakeIterator:
        def initialize(self) -> bool:
            return True

        def get(self):
            return FakeShape()

        def next(self) -> bool:
            return False

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator()
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_ifcopenshell_openusd_fallback(
            ifc_path=ifc_file,
            output_dir=tmp_path / "out",
            primary_error=ConversionAuthorityError(
                "converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"
            ),
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "fallback_no_renderable_geometry"


# --- streaming-server-fallback-semantic-mapping:fallback semantic mapping fidelity ---


def _run_fallback_with_single_shape(
    tmp_path: Path,
    monkeypatch,
    *,
    ifc_guid: str,
    ifc_name: str,
    ifc_type: str,
) -> tuple[dict, dict, dict]:
    """Run `_run_ifcopenshell_openusd_fallback` against a single mocked shape and
    return parsed (mapping_doc, entity_index_doc, quality_metrics_doc)."""
    _clear_pxr_test_stubs(monkeypatch)
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

        def by_type(self, name: str):
            return [object()] if name == "IfcProduct" else []

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = (0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        faces = (0, 1, 2)

    class FakeShape:
        guid = ifc_guid
        name = ifc_name
        type = ifc_type
        geometry = FakeGeometry()

    class FakeIterator:
        def __init__(self):
            self.done = False

        def initialize(self) -> bool:
            return True

        def get(self):
            return FakeShape()

        def next(self) -> bool:
            if self.done:
                return False
            self.done = True
            return False

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator()
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)

    output_dir = tmp_path / "out"
    adapter._run_ifcopenshell_openusd_fallback(
        ifc_path=ifc_file,
        output_dir=output_dir,
        primary_error=ConversionAuthorityError(
            "converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"
        ),
    )

    mapping_doc = json.loads((output_dir / "element_mapping.json").read_text(encoding="utf-8"))
    entity_index_doc = json.loads((output_dir / "entity_index.json").read_text(encoding="utf-8"))
    metrics_doc = json.loads((output_dir / "quality_metrics.json").read_text(encoding="utf-8"))
    return mapping_doc, entity_index_doc, metrics_doc


def test_fallback_mapping_carries_ifc_type_and_name(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_A",
        ifc_name="樓梯1",
        ifc_type="IfcStair",
    )
    assert mapping_doc["items"], "fallback mapping must have at least one item"
    item = mapping_doc["items"][0]
    assert item["ifc_type"] == "IfcStair"
    assert item["ifc_name"] == "樓梯1"
    assert isinstance(item["entity_id"], str) and item["entity_id"]


def test_fallback_prim_paths_are_ifc_class_grouped(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_B",
        ifc_name="梁1",
        ifc_type="IfcBeam",
    )
    item = mapping_doc["items"][0]
    assert item["usd_prim_path"].startswith("/World/IfcBeam/"), item["usd_prim_path"]


def test_fallback_unclassified_grouping(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_C",
        ifc_name="",
        ifc_type="",
    )
    item = mapping_doc["items"][0]
    assert item["usd_prim_path"].startswith("/World/Unclassified/"), item["usd_prim_path"]
    # ifc_type / ifc_name keys MUST still be present (may be null)
    assert "ifc_type" in item and item["ifc_type"] in (None, "")
    assert "ifc_name" in item and item["ifc_name"] in (None, "")


def test_fallback_prim_path_sanitization(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="abc$def-XYZ!",
        ifc_name="Demo",
        ifc_type="IfcBuildingElementProxy",
    )
    item = mapping_doc["items"][0]
    path = item["usd_prim_path"]
    assert path.startswith("/World/IfcBuildingElementProxy/"), path
    assert "$" not in path
    assert "!" not in path
    assert "-" not in path
    # path segments must be USD-legal: each /-separated segment is [A-Za-z_][A-Za-z0-9_]*
    import re

    for segment in path.split("/")[1:]:
        assert re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", segment), f"illegal USD segment: {segment!r}"


def test_fallback_quality_metrics_semantic_fields(tmp_path: Path, monkeypatch):
    _mapping_doc, _entity_doc, metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_D",
        ifc_name="梁2",
        ifc_type="IfcBeam",
    )
    assert metrics["semantic_mapping_fidelity"] == "ifc_class_grouped_with_name"
    assert metrics["mapping_has_ifc_type"] is True
    assert metrics["mapping_has_ifc_name"] is True
    # legacy quality fields must still be present
    assert metrics["materialization_strategy"] == "ifcopenshell_openusd_fallback"
    assert metrics["hard_quality_gates"]["usdc_openable"] is True


def test_fallback_entity_id_alignment(tmp_path: Path, monkeypatch):
    mapping_doc, entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_E",
        ifc_name="柱1",
        ifc_type="IfcColumn",
    )
    items = mapping_doc["items"]
    entities = entity_doc["entities"]
    assert len(items) == len(entities) == 1
    mapping_ids = {item["entity_id"] for item in items}
    entity_ids = {ent["entity_id"] for ent in entities}
    assert mapping_ids == entity_ids
    # cross-reference: matching entity record carries same ifc_guid + usd_prim_path
    item = items[0]
    matching = next(ent for ent in entities if ent["entity_id"] == item["entity_id"])
    assert matching["ifc_guid"] == item["ifc_guid"]
    assert matching["usd_prim_path"] == item["usd_prim_path"]


def test_fallback_mapping_backward_compat_keys(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_F",
        ifc_name="牆1",
        ifc_type="IfcWall",
    )
    item = mapping_doc["items"][0]
    # legacy schema keys retained for backward-compatible consumers
    assert "ifc_guid" in item
    assert "usd_prim_path" in item
    assert item["ifc_guid"] == "GUID_F"


def _run_fallback_with_multiple_shapes(
    tmp_path: Path,
    monkeypatch,
    *,
    shapes: list[dict[str, str]],
) -> tuple[dict, dict, dict]:
    """Multi-shape variant of `_run_fallback_with_single_shape`,用於驗證
    multi-shape invariant(prim path uniqueness、entity_id 對齊、跨 class 衝突)。"""
    _clear_pxr_test_stubs(monkeypatch)
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = (0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        faces = (0, 1, 2)

    class FakeShape:
        def __init__(self, *, guid: str, name: str, ifc_type: str):
            self.guid = guid
            self.name = name
            self.type = ifc_type
            self.geometry = FakeGeometry()

    class FakeIterator:
        def __init__(self, shape_specs: list[dict[str, str]]):
            self._shapes = [
                FakeShape(guid=s["guid"], name=s["name"], ifc_type=s["ifc_type"])
                for s in shape_specs
            ]
            self._index = 0

        def initialize(self) -> bool:
            return len(self._shapes) > 0

        def get(self):
            return self._shapes[self._index]

        def next(self) -> bool:
            self._index += 1
            return self._index < len(self._shapes)

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator(shapes)
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)

    output_dir = tmp_path / "out"
    adapter._run_ifcopenshell_openusd_fallback(
        ifc_path=ifc_file,
        output_dir=output_dir,
        primary_error=ConversionAuthorityError("converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"),
    )

    mapping_doc = json.loads((output_dir / "element_mapping.json").read_text(encoding="utf-8"))
    entity_index_doc = json.loads((output_dir / "entity_index.json").read_text(encoding="utf-8"))
    metrics_doc = json.loads((output_dir / "quality_metrics.json").read_text(encoding="utf-8"))
    return mapping_doc, entity_index_doc, metrics_doc


def test_fallback_sanitized_clash_does_not_overwrite_prim(tmp_path: Path, monkeypatch):
    """不同原始 GUID 但 sanitize 成同 token,prim path 必須 unique。"""
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_multiple_shapes(
        tmp_path,
        monkeypatch,
        shapes=[
            {"guid": "abc$", "name": "牆 A", "ifc_type": "IfcWall"},
            {"guid": "abc!", "name": "牆 B", "ifc_type": "IfcWall"},
            {"guid": "abc-", "name": "牆 C", "ifc_type": "IfcWall"},
        ],
    )
    items = mapping_doc["items"]
    paths = [item["usd_prim_path"] for item in items]
    assert len(items) == 3, "三個 shape 都應該有對應 mapping item"
    assert len(set(paths)) == 3, f"prim path 必須 unique:{paths}"
    assert all(p.startswith("/World/IfcWall/abc_") for p in paths)


def test_fallback_entity_id_one_to_one_with_entity_index_multi_shape(tmp_path: Path, monkeypatch):
    """multi-shape 場景下 mapping items 與 entity_index entry 1:1 對齊。"""
    mapping_doc, entity_doc, _metrics = _run_fallback_with_multiple_shapes(
        tmp_path,
        monkeypatch,
        shapes=[
            {"guid": "GUID_AA", "name": "梁 1", "ifc_type": "IfcBeam"},
            {"guid": "GUID_BB", "name": "柱 1", "ifc_type": "IfcColumn"},
            {"guid": "GUID_CC", "name": "牆 1", "ifc_type": "IfcWall"},
        ],
    )
    items = mapping_doc["items"]
    entities = entity_doc["entities"]
    assert len(items) == len(entities) == 3
    mapping_ids = {item["entity_id"] for item in items}
    entity_ids = {ent["entity_id"] for ent in entities}
    assert mapping_ids == entity_ids
    for item in items:
        matching = next(ent for ent in entities if ent["entity_id"] == item["entity_id"])
        assert matching["ifc_guid"] == item["ifc_guid"]
        assert matching["usd_prim_path"] == item["usd_prim_path"]


# --- streaming-server-enumeration-semantic-mapping ----------------------------


def _make_enumeration_adapter(tmp_path: Path) -> Ifc2UsdcPowershellConverterAdapter:
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    return Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)


def _write_usd_stage_with_ifc_prims(usdc_path: Path, prims_spec: list[dict[str, str]]) -> None:
    """寫一個 USD stage with CustomData 模擬 HOOPS / C1 fallback 產出的 prim。"""
    from pxr import Sdf, Usd, UsdGeom

    usdc_path.parent.mkdir(parents=True, exist_ok=True)
    stage = Usd.Stage.CreateNew(str(usdc_path))
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    for idx, spec in enumerate(prims_spec, start=1):
        path = spec.get("path") or f"/World/Prim_{idx:06d}"
        mesh = UsdGeom.Mesh.Define(stage, path)
        prim = mesh.GetPrim()
        if spec.get("ifc_guid"):
            prim.SetCustomDataByKey("ifcGlobalId", spec["ifc_guid"])
        if spec.get("ifc_type"):
            prim.SetCustomDataByKey("ifcType", spec["ifc_type"])
        if spec.get("ifc_name"):
            prim.SetCustomDataByKey("ifcName", spec["ifc_name"])
    stage.GetRootLayer().Save()


def _write_usd_stage_with_xform_prims(usdc_path: Path, paths: list[str]) -> None:
    from pxr import Usd, UsdGeom

    usdc_path.parent.mkdir(parents=True, exist_ok=True)
    stage = Usd.Stage.CreateNew(str(usdc_path))
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    for path in paths:
        UsdGeom.Xform.Define(stage, path)
    stage.GetRootLayer().Save()


def test_enumeration_path_writes_semantic_fields(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    _write_usd_stage_with_ifc_prims(
        usdc,
        [
            {"path": "/World/IfcWall/wall_001", "ifc_guid": "GUID_A1", "ifc_type": "IfcWall", "ifc_name": "外牆 1"},
            {"path": "/World/IfcBeam/beam_001", "ifc_guid": "GUID_B1", "ifc_type": "IfcBeam", "ifc_name": "梁 1"},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    assert quality["materialization_strategy"] == "usd_stage_enumeration"
    assert quality["semantic_mapping_fidelity"] == "ifc_class_grouped_with_name"
    assert quality["mapping_has_ifc_type"] is True
    assert quality["mapping_has_ifc_name"] is True

    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    items = mapping_doc["items"]
    assert len(items) == 2
    for item in items:
        for key in ("ifc_guid", "usd_prim_path", "ifc_type", "ifc_name", "entity_id"):
            assert key in item
    assert {item["ifc_type"] for item in items} == {"IfcWall", "IfcBeam"}

    index_doc = json.loads((out_dir / "entity_index.json").read_text(encoding="utf-8"))
    entities = index_doc["entities"]
    assert isinstance(entities, list) and len(entities) == 2
    # entity_id alignment
    mapping_ids = {item["entity_id"] for item in items}
    entity_ids = {ent["entity_id"] for ent in entities}
    assert mapping_ids == entity_ids


def test_enumeration_path_empty_custom_data_stays_honest(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    # 兩個純 mesh prim 完全沒 IFC custom data
    _write_usd_stage_with_ifc_prims(
        usdc,
        [
            {"path": "/World/Naked_1"},
            {"path": "/World/Naked_2"},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    # 誠實:沒 IFC data 就是 None / False,不偽宣告
    assert quality["semantic_mapping_fidelity"] is None
    assert quality["mapping_has_ifc_type"] is False
    assert quality["mapping_has_ifc_name"] is False
    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    assert mapping_doc["items"] == []


def test_adopt_path_supplements_missing_semantic_fields(tmp_path: Path):
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    # converter emit 完整 sidecars,但 quality 沒寫 semantic 欄位
    (out_dir / "element_mapping.json").write_text(
        json.dumps(
            {
                "mapping_provenance": "converter_verified",
                "mock": False,
                "allow_fake_mapping": False,
                "summary": {"mapped_count": 2, "fake_mapping_count": 0},
                "items": [
                    {"ifc_guid": "GUID_X", "usd_prim_path": "/World/IfcWall/x",
                     "ifc_type": "IfcWall", "ifc_name": "牆"},
                    {"ifc_guid": "GUID_Y", "usd_prim_path": "/World/IfcBeam/y",
                     "ifc_type": "IfcBeam", "ifc_name": "梁"},
                ],
            }
        ),
        encoding="utf-8",
    )
    (out_dir / "entity_index.json").write_text(json.dumps({"entities": []}), encoding="utf-8")
    (out_dir / "metadata.json").write_text(json.dumps({"source": "converter"}), encoding="utf-8")
    (out_dir / "quality_metrics.json").write_text(
        json.dumps(
            {
                "source_ifc_entity_count": 2,
                "mapped_count": 2,
                "materialization_strategy": "converter_native",
                "coverage_status": "pass",
            }
        ),
        encoding="utf-8",
    )

    quality = adapter._adopt_converter_sidecars(
        output_dir=out_dir,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )
    assert quality is not None
    assert quality["semantic_mapping_fidelity"] == "ifc_class_grouped_with_name"
    assert quality["mapping_has_ifc_type"] is True
    assert quality["mapping_has_ifc_name"] is True
    # converter native 既有欄位不被蓋
    assert quality["materialization_strategy"] == "converter_native"
    assert quality["coverage_status"] == "pass"


def test_adopt_path_does_not_overwrite_existing_semantic(tmp_path: Path):
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "element_mapping.json").write_text(
        json.dumps(
            {
                "mapping_provenance": "converter_verified",
                "mock": False,
                "allow_fake_mapping": False,
                "summary": {"mapped_count": 1, "fake_mapping_count": 0},
                "items": [
                    {"ifc_guid": "GUID_Z", "usd_prim_path": "/World/x",
                     "ifc_type": "IfcDoor", "ifc_name": "門"},
                ],
            }
        ),
        encoding="utf-8",
    )
    (out_dir / "entity_index.json").write_text(json.dumps({"entities": []}), encoding="utf-8")
    (out_dir / "metadata.json").write_text(json.dumps({"source": "converter"}), encoding="utf-8")
    # converter 自己已寫 semantic_mapping_fidelity:adopt 不可蓋
    (out_dir / "quality_metrics.json").write_text(
        json.dumps(
            {
                "source_ifc_entity_count": 1,
                "materialization_strategy": "converter_native",
                "semantic_mapping_fidelity": "converter_native_high_fidelity",
                "mapping_has_ifc_type": True,
                "mapping_has_ifc_name": False,
            }
        ),
        encoding="utf-8",
    )

    quality = adapter._adopt_converter_sidecars(
        output_dir=out_dir,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )
    assert quality is not None
    # 既有值不被蓋
    assert quality["semantic_mapping_fidelity"] == "converter_native_high_fidelity"
    assert quality["mapping_has_ifc_type"] is True
    # converter 寫 False 也保留,不被 mapping 推導蓋掉
    assert quality["mapping_has_ifc_name"] is False


# --- streaming-server-ifcopenshell-semantic-sidecar-pass ----------------------


class _FakeIfcProduct:
    """Fake IfcProduct with a truthy Representation by default (renderable).

    Pass `representation=None` to simulate spatial / container products
    (IfcSite / IfcBuilding / IfcBuildingStorey / IfcSpace) that the sidecar
    pass MUST skip.
    """

    def __init__(
        self,
        *,
        guid: str,
        ifc_type: str,
        name: str | None,
        representation: object = "fake-representation",
    ):
        self.GlobalId = guid
        self._ifc_type = ifc_type
        self.Name = name
        self.Representation = representation

    def is_a(self) -> str:
        return self._ifc_type


def _install_fake_ifcopenshell(
    monkeypatch,
    products: list[_FakeIfcProduct],
    *,
    by_type_raises: bool = False,
) -> None:
    fake_module = types.ModuleType("ifcopenshell")

    class FakeIfcFile:
        def by_type(self, type_name: str):
            if by_type_raises:
                raise RuntimeError("simulated ifc parser failure")
            if type_name == "IfcProduct":
                return list(products)
            return []

    fake_module.open = lambda _path: FakeIfcFile()
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_module)


def _write_sidecar_doc(artifact_dir: Path, entries: list[dict[str, object]]) -> Path:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    sidecar_path = artifact_dir / "ifc_semantic_sidecar.json"
    sidecar_doc = {
        "format_version": "1",
        "ifc_source": str(artifact_dir / "source.ifc"),
        "entries": entries,
        "summary": {
            "count": len(entries),
            "has_type": any(e.get("ifc_type") for e in entries),
            "has_name": any(e.get("ifc_name") for e in entries),
        },
    }
    sidecar_path.write_text(json.dumps(sidecar_doc, ensure_ascii=False), encoding="utf-8")
    return sidecar_path


def test_sidecar_pass_writes_json_for_valid_ifc(tmp_path: Path, monkeypatch):
    adapter = _make_enumeration_adapter(tmp_path)
    artifact_dir = tmp_path / "artifact"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")
    _install_fake_ifcopenshell(
        monkeypatch,
        [
            _FakeIfcProduct(guid="GUID_A1", ifc_type="IfcWall", name="外牆 1"),
            _FakeIfcProduct(guid="GUID_B1", ifc_type="IfcBeam", name="梁 1"),
            _FakeIfcProduct(guid="", ifc_type="IfcSpace", name="略過 (no GUID)"),
        ],
    )

    sidecar_path = adapter._run_ifcopenshell_semantic_sidecar(
        ifc_source_path=ifc_source,
        artifact_dir=artifact_dir,
    )

    assert sidecar_path is not None
    assert sidecar_path == artifact_dir / "ifc_semantic_sidecar.json"
    assert sidecar_path.is_file()
    doc = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert doc["format_version"] == "1"
    assert doc["ifc_source"] == str(ifc_source)
    entries = doc["entries"]
    assert len(entries) == 2  # 無 GlobalId 的 product 被略過
    assert {e["ifc_guid"] for e in entries} == {"GUID_A1", "GUID_B1"}
    for entry in entries:
        for key in ("ifc_guid", "ifc_type", "ifc_name", "shape_index"):
            assert key in entry
    assert doc["summary"] == {"count": 2, "has_type": True, "has_name": True}


def test_sidecar_pass_returns_none_for_missing_ifc(tmp_path: Path, monkeypatch):
    adapter = _make_enumeration_adapter(tmp_path)
    artifact_dir = tmp_path / "artifact"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    missing_ifc = tmp_path / "does_not_exist.ifc"
    _install_fake_ifcopenshell(monkeypatch, [])

    result = adapter._run_ifcopenshell_semantic_sidecar(
        ifc_source_path=missing_ifc,
        artifact_dir=artifact_dir,
    )

    assert result is None
    assert not (artifact_dir / "ifc_semantic_sidecar.json").exists()


def test_sidecar_pass_returns_none_when_ifcopenshell_missing(tmp_path: Path, monkeypatch):
    adapter = _make_enumeration_adapter(tmp_path)
    artifact_dir = tmp_path / "artifact"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")
    # Force ImportError when import ifcopenshell runs inside the helper
    monkeypatch.setitem(sys.modules, "ifcopenshell", None)

    result = adapter._run_ifcopenshell_semantic_sidecar(
        ifc_source_path=ifc_source,
        artifact_dir=artifact_dir,
    )

    assert result is None
    assert not (artifact_dir / "ifc_semantic_sidecar.json").exists()


def test_enumeration_reads_sidecar_when_prim_custom_data_empty(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    # HOOPS happy path 真實情境:USD prim 完全沒 IFC CustomData
    _write_usd_stage_with_ifc_prims(
        usdc,
        [
            {"path": "/World/HoopsMesh_001"},
            {"path": "/World/HoopsMesh_002"},
        ],
    )
    # Sidecar 由先前 `_run_ifcopenshell_semantic_sidecar` 寫好,落地於 out_dir
    _write_sidecar_doc(
        out_dir,
        [
            {"ifc_guid": "GUID_A1", "ifc_type": "IfcWall", "ifc_name": "外牆", "shape_index": 0},
            {"ifc_guid": "GUID_B1", "ifc_type": "IfcBeam", "ifc_name": "梁", "shape_index": 1},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    assert quality["materialization_strategy"] == "usd_stage_enumeration"
    assert quality["semantic_mapping_fidelity"] == "usd_enumeration_with_ifc_sidecar_supplement"
    assert quality["mapping_has_ifc_type"] is True
    assert quality["mapping_has_ifc_name"] is True

    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    items = mapping_doc["items"]
    assert len(items) == 2
    for item in items:
        for key in ("ifc_guid", "usd_prim_path", "ifc_type", "ifc_name", "entity_id"):
            assert key in item
    assert {item["ifc_guid"] for item in items} == {"GUID_A1", "GUID_B1"}
    assert {item["ifc_type"] for item in items} == {"IfcWall", "IfcBeam"}

    index_doc = json.loads((out_dir / "entity_index.json").read_text(encoding="utf-8"))
    entities = index_doc["entities"]
    assert isinstance(entities, list) and len(entities) == 2
    assert {ent["entity_id"] for ent in entities} == {item["entity_id"] for item in items}


def test_enumeration_reports_incomplete_mapping_when_sidecar_has_entries_but_stage_has_no_joinable_prims(
    tmp_path: Path, monkeypatch
):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    _write_usd_stage_with_xform_prims(
        usdc,
        [
            "/World/IFCDOOR_25312",
            "/World/IFCDOOR_25341",
        ],
    )
    _write_sidecar_doc(
        out_dir,
        [
            {"ifc_guid": "GUID_DOOR_A", "ifc_type": "IfcDoor", "ifc_name": "Door:25312", "shape_index": 0},
            {"ifc_guid": "GUID_DOOR_B", "ifc_type": "IfcDoor", "ifc_name": "Door:25341", "shape_index": 1},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    assert quality["mapping_information_status"] == "incomplete"
    assert quality["mapping_issue_count"] == 1
    assert quality["sidecar_entry_count"] == 2
    assert quality["usd_mesh_prim_count"] == 0
    issue = quality["mapping_issues"][0]
    assert issue["code"] == "ifc_usdc_mapping_information_incomplete"
    assert issue["sidecar_entry_count"] == 2

    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    assert mapping_doc["items"] == []
    assert mapping_doc["summary"]["mapping_information_status"] == "incomplete"
    assert mapping_doc["issues"][0]["code"] == "ifc_usdc_mapping_information_incomplete"


def test_enumeration_prefers_prim_custom_data_over_sidecar(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    # 兩個 prim 都帶完整 IFC CustomData (C6 path)
    _write_usd_stage_with_ifc_prims(
        usdc,
        [
            {"path": "/World/IfcDoor/d001", "ifc_guid": "PRIM_GUID_X", "ifc_type": "IfcDoor", "ifc_name": "門"},
            {"path": "/World/IfcWindow/w001", "ifc_guid": "PRIM_GUID_Y", "ifc_type": "IfcWindow", "ifc_name": "窗"},
        ],
    )
    # Sidecar 也存在 (內容刻意 inconsistent 來確認不被讀取)
    _write_sidecar_doc(
        out_dir,
        [
            {"ifc_guid": "SIDECAR_GUID_SHOULD_BE_IGNORED", "ifc_type": "IfcWall",
             "ifc_name": "牆 (sidecar 不該被讀)", "shape_index": 0},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    # C6 既有 fidelity 維持,不被 sidecar fidelity 蓋掉
    assert quality["semantic_mapping_fidelity"] == "ifc_class_grouped_with_name"
    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    guids = {item["ifc_guid"] for item in mapping_doc["items"]}
    assert guids == {"PRIM_GUID_X", "PRIM_GUID_Y"}
    assert "SIDECAR_GUID_SHOULD_BE_IGNORED" not in guids


def test_materialize_sidecars_runs_sidecar_pass_when_hoops_has_no_ifc_custom_data(
    tmp_path: Path, monkeypatch
):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    # HOOPS-produced prim 沒 IFC CustomData
    _write_usd_stage_with_ifc_prims(
        usdc,
        [
            {"path": "/World/HoopsMesh_A"},
            {"path": "/World/HoopsMesh_B"},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")
    # IfcOpenShell parser 跑出兩個 IfcProduct → sidecar pass 應寫 sidecar 給 enumeration
    _install_fake_ifcopenshell(
        monkeypatch,
        [
            _FakeIfcProduct(guid="MAT_GUID_A", ifc_type="IfcSlab", name="樓板 A"),
            _FakeIfcProduct(guid="MAT_GUID_B", ifc_type="IfcColumn", name="柱 B"),
        ],
    )

    quality = adapter._materialize_sidecars(
        model_path=usdc,
        ifc_path=ifc_source,
        output_dir=out_dir,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    # 1) sidecar JSON 落地
    sidecar_path = out_dir / "ifc_semantic_sidecar.json"
    assert sidecar_path.is_file()
    sidecar_doc = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert sidecar_doc["summary"]["count"] == 2

    # 2) enumeration 從 sidecar 補,quality 三 semantic 欄位 truthy
    assert quality["semantic_mapping_fidelity"] == "usd_enumeration_with_ifc_sidecar_supplement"
    assert quality["mapping_has_ifc_type"] is True
    assert quality["mapping_has_ifc_name"] is True

    # 3) element_mapping items 來自 sidecar
    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    guids = {item["ifc_guid"] for item in mapping_doc["items"]}
    assert guids == {"MAT_GUID_A", "MAT_GUID_B"}


def test_sidecar_pass_skips_ifcproduct_without_representation(tmp_path: Path, monkeypatch):
    """CodeRabbit P0 fix: IfcSite / IfcBuilding / IfcBuildingStorey / IfcSpace
    (spatial/container products without Representation) MUST be excluded from
    sidecar entries, otherwise mesh-index ↔ sidecar-index ordinal join is
    全錯位."""
    adapter = _make_enumeration_adapter(tmp_path)
    artifact_dir = tmp_path / "artifact"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")
    _install_fake_ifcopenshell(
        monkeypatch,
        [
            # 空間 / 容器 product:沒 Representation,SHALL 被過濾
            _FakeIfcProduct(guid="SITE_GUID", ifc_type="IfcSite", name="基地", representation=None),
            _FakeIfcProduct(guid="BLDG_GUID", ifc_type="IfcBuilding", name="主建", representation=None),
            _FakeIfcProduct(guid="STOREY_GUID", ifc_type="IfcBuildingStorey", name="一樓", representation=None),
            # 真實 renderable product:SHALL 入 sidecar
            _FakeIfcProduct(guid="WALL_GUID", ifc_type="IfcWall", name="牆"),
            _FakeIfcProduct(guid="BEAM_GUID", ifc_type="IfcBeam", name="梁"),
        ],
    )

    sidecar_path = adapter._run_ifcopenshell_semantic_sidecar(
        ifc_source_path=ifc_source,
        artifact_dir=artifact_dir,
    )

    assert sidecar_path is not None
    doc = json.loads(sidecar_path.read_text(encoding="utf-8"))
    # 只有兩個 renderable product 進 sidecar
    assert doc["summary"]["count"] == 2
    guids = {entry["ifc_guid"] for entry in doc["entries"]}
    assert guids == {"WALL_GUID", "BEAM_GUID"}
    assert "SITE_GUID" not in guids
    # shape_index 從 0 連續,不留 spatial product 留下的 gap
    shape_indexes = [entry["shape_index"] for entry in doc["entries"]]
    assert shape_indexes == [0, 1]


def test_sidecar_pass_returns_none_when_by_type_raises(tmp_path: Path, monkeypatch):
    """CodeRabbit P0 fix: by_type 失敗 SHALL return None 且不寫 sidecar
    (對齊 docstring「never raises」+ spec「parse failure → None」contract)。"""
    adapter = _make_enumeration_adapter(tmp_path)
    artifact_dir = tmp_path / "artifact"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")
    _install_fake_ifcopenshell(monkeypatch, [], by_type_raises=True)

    result = adapter._run_ifcopenshell_semantic_sidecar(
        ifc_source_path=ifc_source,
        artifact_dir=artifact_dir,
    )

    assert result is None
    assert not (artifact_dir / "ifc_semantic_sidecar.json").exists()


def test_materialize_runs_sidecar_pass_when_adopt_returns_semantic_falsy(
    tmp_path: Path, monkeypatch
):
    """CodeRabbit P0 fix: HOOPS emit 四檔 sidecars 但 mapping 無 IFC type/name 時,
    _materialize_sidecars SHALL 仍跑 sidecar pass + enumeration supplement
    (對齊 spec scenario「HOOPS success without IFC CustomData triggers sidecar pass」)。
    """
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    # HOOPS-produced prim 沒 IFC CustomData
    _write_usd_stage_with_ifc_prims(
        usdc,
        [
            {"path": "/World/HoopsMesh_X"},
            {"path": "/World/HoopsMesh_Y"},
        ],
    )
    # converter (HOOPS) 自己 emit 四個 sidecars,但 mapping 沒 ifc_type / ifc_name
    (out_dir / "element_mapping.json").write_text(
        json.dumps(
            {
                "mapping_provenance": "converter_verified",
                "mock": False,
                "allow_fake_mapping": False,
                "summary": {"mapped_count": 2, "fake_mapping_count": 0},
                "items": [
                    {"ifc_guid": "GUID_NO_SEMANTIC_1", "usd_prim_path": "/World/HoopsMesh_X"},
                    {"ifc_guid": "GUID_NO_SEMANTIC_2", "usd_prim_path": "/World/HoopsMesh_Y"},
                ],
            }
        ),
        encoding="utf-8",
    )
    (out_dir / "entity_index.json").write_text(json.dumps({"entities": []}), encoding="utf-8")
    (out_dir / "metadata.json").write_text(json.dumps({"source": "converter"}), encoding="utf-8")
    # quality 沒 semantic 欄位 + items 也沒 ifc_type/name → adopt supplement 推導出
    # mapping_has_ifc_type=False, mapping_has_ifc_name=False
    (out_dir / "quality_metrics.json").write_text(
        json.dumps(
            {
                "source_ifc_entity_count": 2,
                "mapped_count": 2,
                "materialization_strategy": "converter_native",
                "coverage_status": "pass",
            }
        ),
        encoding="utf-8",
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")
    _install_fake_ifcopenshell(
        monkeypatch,
        [
            _FakeIfcProduct(guid="REAL_GUID_X", ifc_type="IfcSlab", name="樓板"),
            _FakeIfcProduct(guid="REAL_GUID_Y", ifc_type="IfcColumn", name="柱"),
        ],
    )

    quality = adapter._materialize_sidecars(
        model_path=usdc,
        ifc_path=ifc_source,
        output_dir=out_dir,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    # 1) sidecar JSON 落地
    sidecar_path = out_dir / "ifc_semantic_sidecar.json"
    assert sidecar_path.is_file()
    # 2) enumeration 重寫 element_mapping,semantic 三欄位 truthy
    assert quality["materialization_strategy"] == "usd_stage_enumeration"
    assert quality["semantic_mapping_fidelity"] == "usd_enumeration_with_ifc_sidecar_supplement"
    assert quality["mapping_has_ifc_type"] is True
    assert quality["mapping_has_ifc_name"] is True
    # 3) mapping items 來自 sidecar(不是 adopt path 的 GUID_NO_SEMANTIC_*)
    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    guids = {item["ifc_guid"] for item in mapping_doc["items"]}
    assert guids == {"REAL_GUID_X", "REAL_GUID_Y"}


# ============================================================================
# harden-host-native-conversion-service CH-1 — 5 條 hardening spec scenario
# (#3 traversal-safe /artifacts、#4 honest health、#10 全檔 placeholder 掃描、
#  #11 結構化 sentinel log path、#13 storage sandbox root 顯式化)
# ============================================================================


# --- #3 Conversion artifacts served through a per-job, traversal-safe route ---


def test_artifacts_route_serves_completed_job_model_usdc(tmp_path: Path):
    """spec scenario「Completed job artifact is retrievable」:完成 job 後
    GET /artifacts/{job_id}/model.usdc → 200 且 bytes 與產出一致。"""
    client = _client(tmp_path, converter=FakeSuccessfulConverter())

    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    # 等 background 完成並確認 ready(model.usdc 已落地)
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["model"]["status"] == "ready"

    response = client.get(f"/artifacts/{conversion_job_id}/model.usdc")

    assert response.status_code == 200
    # FakeSuccessfulConverter 寫入的真實 bytes
    assert response.content == b"PXR-USDC-fake-openable\n"


def test_artifacts_route_rejects_tampered_model_usdc(tmp_path: Path):
    client = _client(tmp_path, converter=FakeSuccessfulConverter())
    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["model"]["status"] == "ready"

    model_path = Path(result["artifacts"]["model_usdc"]["path"])
    model_path.write_bytes(b"tampered-after-publish")

    response = client.get(f"/artifacts/{conversion_job_id}/model.usdc")
    assert response.status_code == 409
    assert response.json()["detail"] == "artifact checksum mismatch"


def test_artifacts_route_rejects_path_traversal_with_404(tmp_path: Path):
    """spec scenario「Path traversal attempt is rejected」:帶 ../ 會 resolve 到
    artifacts_root 之外的請求 → 404 且不洩漏 root 外檔案內容。"""
    client = _client(tmp_path, converter=FakeSuccessfulConverter())
    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    client.get(f"/api/conversions/{conversion_job_id}/result")

    # artifacts_root = tmp_path/svc/artifacts;在其 parent(tmp_path/svc)放一個
    # 不該被取到的 secret,用 ../ 嘗試逃逸。
    secret = tmp_path / "svc" / "SECRET_outside_artifacts.txt"
    secret.parent.mkdir(parents=True, exist_ok=True)
    secret.write_bytes(b"TOP-SECRET-SHOULD-NOT-BE-SERVED")

    # job_id 逃逸:`%2e%2e`(encoded `..`)是單一 path segment,會 routing-match 到
    # job_id="..",進到 handler 後 resolve 落在 artifacts_root 之外 → relative_to
    # guard 擋下回 404(真正觸發 traversal guard,非 routing 404)。
    escaped = client.get("/artifacts/%2e%2e/SECRET_outside_artifacts.txt")
    assert escaped.status_code == 404
    assert b"TOP-SECRET" not in escaped.content

    # 多段 `..%2f..` 逃逸:無論被 router 正規化或進到 guard,結果都 SHALL 為 404
    # 且 SHALL NOT 回傳 artifacts_root 之外的 secret 內容。
    escaped_multi = client.get(
        f"/artifacts/{conversion_job_id}/%2e%2e%2f%2e%2e%2fSECRET_outside_artifacts.txt"
    )
    assert escaped_multi.status_code == 404
    assert b"TOP-SECRET" not in escaped_multi.content


def test_artifacts_route_rejects_cross_job_backslash_with_404(tmp_path: Path):
    """spec「擋跨 job 存取」+ Copilot/Codex P2 review:Windows 上 filename 含 encoded
    backslash(%5C)會被 Path 當路徑分隔,只驗 artifacts_root(不驗 per-job)會放行
    sibling job 讀取。per-job guard 兩層 relative_to 必須擋下 → 404。
    (Windows 上 %5C 真正穿透到 guard;Linux 上反斜線非分隔、檔案不存在亦回 404。)"""
    client = _client(tmp_path, converter=FakeSuccessfulConverter())
    job_a = client.post(
        "/api/conversions/ifc-to-usdc", json=ifc_ready_payload()
    ).json()["conversion_job_id"]
    client.get(f"/api/conversions/{job_a}/result")
    # 第二個 job(不同 event/correlation → 不同 job_id),在 artifacts_root 下成為 sibling
    job_b = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(event_id="evt_ifc_hn_002", correlation_id="corr_hn_002"),
    ).json()["conversion_job_id"]
    client.get(f"/api/conversions/{job_b}/result")
    assert job_a != job_b

    # 從 job A 用 encoded backslash / forward slash 跨到 job B 的 model.usdc → 必須 404
    for sep in ("%5C", "%2f"):
        cross = client.get(f"/artifacts/{job_a}/..{sep}{job_b}{sep}model.usdc")
        assert cross.status_code == 404, f"cross-job via {sep} 應 404,不得讀到 sibling job"


def test_artifacts_route_returns_404_for_missing_job_or_filename(tmp_path: Path):
    """spec scenario「Missing job or filename returns 404」:不存在的 job 或
    filename → 404。"""
    client = _client(tmp_path, converter=FakeSuccessfulConverter())
    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    client.get(f"/api/conversions/{conversion_job_id}/result")

    # 不存在的 job_id
    missing_job = client.get("/artifacts/stream_conv_does_not_exist/model.usdc")
    assert missing_job.status_code == 404

    # 存在的 job、不存在的 filename
    missing_file = client.get(f"/artifacts/{conversion_job_id}/no_such_file.usdc")
    assert missing_file.status_code == 404


# --- #4 Health endpoint reflects converter preflight readiness ----------------


class _FakePreflightUnavailableConverter:
    """preflight 會 raise converter_unavailable 的 fake converter(未就緒)。"""

    def preflight(self) -> None:
        raise ConversionAuthorityError(
            "converter_unavailable",
            "host-native converter prerequisites missing (fixture).",
        )

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        raise ConversionAuthorityError("converter_unavailable", "not configured (fixture).")


def test_health_reports_ok_when_converter_preflight_passes(tmp_path: Path):
    """spec scenario「Converter ready reports ok」。"""
    client = _client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["ifc_to_usdc_conversion"] is True
    # conversion-only 身分維持
    assert body["authority"] == "bim-streaming-server"
    assert body["role"] == "conversion-only"
    assert body["claims"]["webrtc_49100"] is False
    assert body["claims"]["kit_launcher"] is False
    assert body["claims"]["viewport_render"] is False


def test_health_reports_degraded_when_preflight_raises(tmp_path: Path):
    """spec scenario「Converter not ready reports degraded without lying」:
    注入 preflight 會 raise 的 fake converter → degraded + reason,HTTP 仍 200。"""
    client = _client(
        tmp_path, converter=_FakePreflightUnavailableConverter(), run_background=False
    )

    response = client.get("/health")

    assert response.status_code == 200  # health 為身分 introspection,非 liveness probe
    body = response.json()
    assert body["status"] == "degraded"
    assert body["ifc_to_usdc_conversion"] is False
    assert isinstance(body.get("reason"), str) and body["reason"]
    # 不得謊報就緒
    assert body["claims"]["ifc_to_usdc_conversion"] is False
    assert body["authority"] == "bim-streaming-server"


def test_health_reports_degraded_when_converter_not_configured(tmp_path: Path):
    """spec scenario「Converter not ready」的 converter=None 落到
    HeadlessConverterNotConfigured 變體:其 preflight raise → degraded。"""
    from conversion_authority import HeadlessConverterNotConfigured

    client = _client(
        tmp_path, converter=HeadlessConverterNotConfigured(), run_background=False
    )

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["ifc_to_usdc_conversion"] is False
    assert isinstance(body.get("reason"), str) and body["reason"]


# --- #10 Placeholder detection scans the full published artifact --------------


def _adapter_with_ps1(tmp_path: Path) -> Ifc2UsdcPowershellConverterAdapter:
    """建一個 ps1 齊備、storage_root 顯式的 adapter(供 convert 路徑測試)。"""
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    _write_default_converter_prereqs(repo_root)
    ifc_file = repo_root / "fixtures" / "demo-model.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    return Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        work_dir=repo_root,
        storage_root=repo_root,
    )


def test_adapter_convert_rejects_placeholder_marker_beyond_prefix(tmp_path: Path, monkeypatch):
    """#10 adapter convert 路徑:placeholder 標記寫在 >4096 offset(前面填約 5KB
    合法 bytes)→ 仍 raise placeholder_usdc(證明 adapter 掃全檔非僅前綴)。"""
    adapter = _adapter_with_ps1(tmp_path)

    def fake_run_ps1(
        *,
        ifc_path: Path,
        output_dir: Path,
        trace_id: str,
        validated_hoops_main: Path,
        validated_hoops_identity: tuple[int, int, int, int, str],
    ) -> None:
        output_dir.mkdir(parents=True, exist_ok=True)
        # 前 5KB 合法,placeholder 標記落在 4096 之後
        (output_dir / "model.usdc").write_bytes(
            b"PXR-USDC-real-prefix\n" + b"B" * 5000 + b"\nplaceholder\n"
        )

    monkeypatch.setattr(adapter, "_run_powershell_conversion", fake_run_ps1)

    raised: ConversionAuthorityError | None = None
    try:
        adapter.convert(
            job={"conversion_job_id": "stream_conv_ph_offset"},
            ifc_ready_event=ifc_ready_payload(),
            output_dir=tmp_path / "out",
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "placeholder_usdc"


def test_store_publish_gate_rejects_placeholder_marker_beyond_prefix(tmp_path: Path):
    """#10 store _assert_publishable_outputs 路徑:placeholder 在 >4096 offset →
    job failed、error.code == placeholder_usdc(透過 build_app 全 HTTP 棧)。"""

    class _PlaceholderBeyondPrefixConverter(FakeSuccessfulConverter):
        def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
            result = super().convert(job=job, ifc_ready_event=ifc_ready_event, output_dir=output_dir)
            Path(result["model_path"]).write_bytes(
                b"PXR-USDC-real-prefix\n" + b"C" * 5000 + b"\nplaceholder\n"
            )
            return result

    client = _client(tmp_path, converter=_PlaceholderBeyondPrefixConverter())
    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    assert result["error"]["code"] == "placeholder_usdc"


def test_placeholder_markers_single_source_shared_between_modules():
    """CH-1 共用契約:_PLACEHOLDER_MARKERS single source = conversion_authority;
    adapter import 同一份(消除 producer / gate 脫節)。"""
    import conversion_authority
    import ifc2usdc_powershell_adapter

    assert conversion_authority._PLACEHOLDER_MARKERS == (b"placeholder",)
    # adapter 引用的是同一個 object(同 identity),不是各寫一份 literal
    assert (
        ifc2usdc_powershell_adapter._PLACEHOLDER_MARKERS
        is conversion_authority._PLACEHOLDER_MARKERS
    )


# --- #11 Conversion failure log paths via a structured ##CONV_META## sentinel --


def _adapter_for_sentinel(tmp_path: Path) -> Ifc2UsdcPowershellConverterAdapter:
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    return Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, storage_root=repo_root)


def _patch_subprocess_returning(monkeypatch, *, returncode: int, stderr: str, stdout: str = "") -> None:
    class _FakeCompleted:
        pass

    _FakeCompleted.returncode = returncode
    _FakeCompleted.stderr = stderr
    _FakeCompleted.stdout = stdout

    monkeypatch.setattr("subprocess.run", lambda *a, **k: _FakeCompleted())


def test_sentinel_yields_log_paths_with_windows_drive_path(tmp_path: Path, monkeypatch):
    """spec scenario「Structured sentinel yields log paths」:##CONV_META## 單行 JSON
    含 Windows C:\\ 絕對路徑 → 抽進 metadata 的 kit_stdout_log / kit_stderr_log。"""
    adapter = _adapter_for_sentinel(tmp_path)
    validated_hoops_main, validated_hoops_identity = _validated_explicit_hoops(adapter)
    stdout_log = r"C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_cache\artifacts\stream_conv_demo\kit-stdout.log"
    stderr_log = r"C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_cache\artifacts\stream_conv_demo\kit-stderr.log"
    combined = (
        "convert failed: output not created\n"
        "##CONV_META## "
        + json.dumps({"kit_stdout_log": stdout_log, "kit_stderr_log": stderr_log})
        + "\n  ---- stderr tail (last 100 lines) ----\n<lines>\n"
    )
    _patch_subprocess_returning(monkeypatch, returncode=1, stderr=combined)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_powershell_conversion(
            ifc_path=tmp_path / "fake.ifc",
            output_dir=tmp_path / "out",
            validated_hoops_main=validated_hoops_main,
            validated_hoops_identity=validated_hoops_identity,
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_failed"
    assert raised.metadata.get("kit_stdout_log") == stdout_log
    assert raised.metadata.get("kit_stderr_log") == stderr_log


def test_missing_sentinel_degrades_to_empty_metadata_without_unexpected_raise(
    tmp_path: Path, monkeypatch
):
    """spec scenario「Missing or corrupt sentinel degrades safely」(無 sentinel 變體):
    僅有人類可讀 prose、無 ##CONV_META## → metadata 空,仍正常 raise converter_failed
    (不拋非預期例外),其餘失敗診斷欄位不變。"""
    adapter = _adapter_for_sentinel(tmp_path)
    validated_hoops_main, validated_hoops_identity = _validated_explicit_hoops(adapter)
    combined = (
        "convert-ifc-to-usdc.ps1 failed\n"
        "  kit_stdout_log: C:\\some\\human\\readable\\prose\\stdout.log\n"
        "  ---- stderr tail (last 100 lines) ----\n<lines>\n"
    )
    _patch_subprocess_returning(monkeypatch, returncode=1, stderr=combined)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_powershell_conversion(
            ifc_path=tmp_path / "fake.ifc",
            output_dir=tmp_path / "out",
            validated_hoops_main=validated_hoops_main,
            validated_hoops_identity=validated_hoops_identity,
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_failed"
    # 無 sentinel → 不從 prose 臆測 log path,metadata 缺省
    assert "kit_stdout_log" not in raised.metadata
    assert "kit_stderr_log" not in raised.metadata


def test_corrupt_sentinel_json_degrades_to_empty_metadata(tmp_path: Path, monkeypatch):
    """spec scenario「Missing or corrupt sentinel degrades safely」(損壞 JSON 變體):
    ##CONV_META## 後接損壞 JSON → fallback 空 metadata,不因解析失敗拋非預期例外。"""
    adapter = _adapter_for_sentinel(tmp_path)
    validated_hoops_main, validated_hoops_identity = _validated_explicit_hoops(adapter)
    combined = (
        "convert failed\n"
        '##CONV_META## {"kit_stdout_log": "C:\\broken\\path, "kit_stderr_log" :::}\n'
        "  ---- stderr tail (last 100 lines) ----\n<lines>\n"
    )
    _patch_subprocess_returning(monkeypatch, returncode=1, stderr=combined)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_powershell_conversion(
            ifc_path=tmp_path / "fake.ifc",
            output_dir=tmp_path / "out",
            validated_hoops_main=validated_hoops_main,
            validated_hoops_identity=validated_hoops_identity,
        )
    except ConversionAuthorityError as exc:
        raised = exc

    # 解析失敗不得變成非預期例外型別;仍是 converter_failed
    assert raised is not None
    assert raised.code == "converter_failed"
    assert "kit_stdout_log" not in raised.metadata
    assert "kit_stderr_log" not in raised.metadata


# --- #13 Conversion sandbox root is explicit, never silently falls back to CWD -


def test_adapter_ctor_raises_when_storage_root_missing(tmp_path: Path, monkeypatch):
    """spec scenario「Missing STORAGE_ROOT fails honestly at startup」:未設
    STORAGE_ROOT 且未顯式傳入 → 建構時 raise converter_unavailable,不退化 cwd。"""
    monkeypatch.delenv("STORAGE_ROOT", raising=False)  # 覆寫 autouse fixture 設的值

    raised: ConversionAuthorityError | None = None
    try:
        Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path)
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_unavailable"


def test_adapter_ctor_raises_when_storage_root_blank(tmp_path: Path, monkeypatch):
    """#13 review fix:顯式 storage_root="" (空字串、非 None)與 STORAGE_ROOT 為純
    空白皆不得被當成有效 sandbox base — 否則 Path("").resolve() 會靜默退化成 cwd。
    兩者皆空白 → 建構時 raise converter_unavailable(對齊 missing 契約)。"""
    monkeypatch.delenv("STORAGE_ROOT", raising=False)

    raised: ConversionAuthorityError | None = None
    try:
        Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root="")
    except ConversionAuthorityError as exc:
        raised = exc
    assert raised is not None
    assert raised.code == "converter_unavailable"

    # STORAGE_ROOT 設成純空白字串也不得繞過(strip 後為空 → 視同未設)。
    monkeypatch.setenv("STORAGE_ROOT", "   ")
    raised_env: ConversionAuthorityError | None = None
    try:
        Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path)
    except ConversionAuthorityError as exc:
        raised_env = exc
    assert raised_env is not None
    assert raised_env.code == "converter_unavailable"


def test_adapter_from_env_raises_when_storage_root_missing(tmp_path: Path, monkeypatch):
    """#13:adapter_from_env 在 env 與 os.environ 皆無 STORAGE_ROOT 時 → raise
    converter_unavailable(顯式讀並傳 storage_root,缺失即誠實 blocker)。"""
    monkeypatch.delenv("STORAGE_ROOT", raising=False)

    raised: ConversionAuthorityError | None = None
    try:
        adapter_from_env(tmp_path, env={})
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_unavailable"


def test_adapter_sandbox_root_is_explicit_storage_root(tmp_path: Path):
    """spec scenario「Explicit STORAGE_ROOT bounds the sandbox」(顯式傳入變體):
    storage_root 顯式傳入 → adapter.storage_root == 該 root(resolve 後)。"""
    storage = tmp_path / "explicit_storage"
    storage.mkdir()
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path, storage_root=storage)

    assert adapter.storage_root == storage.resolve()


def test_adapter_sandbox_root_from_env_storage_root(tmp_path: Path, monkeypatch):
    """spec scenario「Explicit STORAGE_ROOT bounds the sandbox」(env 變體):
    STORAGE_ROOT env 設為某 storage 目錄 → adapter sandbox = 該目錄。"""
    storage = tmp_path / "env_storage"
    storage.mkdir()
    monkeypatch.setenv("STORAGE_ROOT", str(storage))

    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path)

    assert adapter.storage_root == storage.resolve()
