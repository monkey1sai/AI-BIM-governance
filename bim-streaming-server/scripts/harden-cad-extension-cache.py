"""Harden the pinned CAD converter entrypoint after Kit precache/build."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    args = parser.parse_args()
    repo_root = Path(args.repo_root).resolve()
    sys.path.insert(0, str(_messaging_root(repo_root)))

    from conversion_authority import ConversionAuthorityError
    from ifc2usdc_powershell_adapter import Ifc2UsdcPowershellConverterAdapter

    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        storage_root=repo_root / "_cache" / "host-native-conversion" / "storage",
    )
    try:
        adapter.harden_default_hoops_main_permissions()
    except ConversionAuthorityError as exc:
        print(
            json.dumps(
                {
                    "schema_version": "cad-extension-cache-hardening/v1",
                    "status": "failed",
                    "reason_kind": exc.code,
                },
                sort_keys=True,
            )
        )
        return 1
    print(
        json.dumps(
            {
                "schema_version": "cad-extension-cache-hardening/v1",
                "status": "passed",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
