import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "agent-skills-manifest.json"
DECLARED_ROOTS = {".claude/skills", ".codex/skills"}


def _tracked_files() -> set[Path]:
    result = subprocess.run(
        ["git", "-c", f"safe.directory={ROOT.as_posix()}", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return {
        Path(item)
        for item in result.stdout.decode("utf-8").split("\0")
        if item
    }


def test_manifest_declares_only_claude_and_codex_roots():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert manifest["roots"] == {
        "claude": ".claude/skills",
        "codex": ".codex/skills",
    }


def test_tracked_skill_trees_are_all_declared():
    tracked_roots = set()
    for path in _tracked_files():
        parts = path.parts
        # `.github/skills` is a separate tracked OpenSpec documentation bundle,
        # not an agent skill root.  Only the agent platform roots participate in
        # this manifest parity assertion; this still catches a tracked `.agents`
        # tree or any newly introduced `.claude`/`.codex` sibling root.
        if len(parts) < 2 or parts[0] not in {".agents", ".claude", ".codex"}:
            continue
        if parts[1] != "skills":
            continue
        tracked_roots.add("/".join(parts[:2]))
    assert tracked_roots <= DECLARED_ROOTS, sorted(tracked_roots - DECLARED_ROOTS)


def test_agent_persona_paths_are_classified_as_root_contracts():
    manifest = json.loads((ROOT / "scripts" / "verification-manifest.json").read_text(encoding="utf-8"))
    root_target = next(target for target in manifest["targets"] if target["id"] == "root-contracts")
    globs = set(root_target["path_globs"])
    assert {".claude/agents/**", ".codex/agents/**", "scripts/gen_agent_personas.py"} <= globs
