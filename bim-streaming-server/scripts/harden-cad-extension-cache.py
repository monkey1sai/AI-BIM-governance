"""Harden the pinned CAD converter entrypoint after Kit precache/build."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


SCHEMA_VERSION = "cad-extension-cache-hardening/v1"


class _ArgumentContractError(ValueError):
    code = "invalid_arguments"


class _StatusArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise _ArgumentContractError(message)


def _messaging_root(repo_root: Path) -> Path:
    return (
        repo_root
        / "source"
        / "extensions"
        / "ezplus.bim_review_stream.messaging"
        / "ezplus"
        / "bim_review_stream"
        / "messaging"
    )


def _emit_status(*, status: str, reason_kind: str | None = None) -> None:
    payload = {
        "schema_version": SCHEMA_VERSION,
        "status": status,
    }
    if reason_kind is not None:
        payload["reason_kind"] = reason_kind
    print(json.dumps(payload, sort_keys=True))


def main() -> int:
    try:
        parser = _StatusArgumentParser()
        parser.add_argument("--repo-root", required=True)
        args = parser.parse_args()
        repo_root = Path(args.repo_root).resolve()
        sys.path.insert(0, str(_messaging_root(repo_root)))

        from ifc2usdc_powershell_adapter import Ifc2UsdcPowershellConverterAdapter

        adapter = Ifc2UsdcPowershellConverterAdapter(
            repo_root=repo_root,
            storage_root=repo_root / "_cache" / "host-native-conversion" / "storage",
        )
        adapter.harden_default_hoops_main_permissions()
    except Exception as exc:
        reason_kind = getattr(exc, "code", None)
        if not isinstance(reason_kind, str) or not reason_kind:
            reason_kind = "unexpected_error"
        _emit_status(status="failed", reason_kind=reason_kind)
        return 1
    _emit_status(status="passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
