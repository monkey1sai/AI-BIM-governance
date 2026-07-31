import pathlib
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE_TEST = ROOT / "tests" / "test_fu_adversarial_runtime.mjs"


def test_fu_adversarial_runtime_contract():
    result = subprocess.run(
        ["node", "--test", str(NODE_TEST)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
