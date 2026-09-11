"""Run retirement behavior assertions through the normal root pytest CI entrypoint."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_retired_workflows_never_dispatch_or_consume_budget():
    result = subprocess.run(
        ["node", "--test", "tests/test_spec_workflow_lean.mjs"],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
