import importlib.util
import re
import subprocess
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = ROOT / "scripts" / "gen_agent_personas.py"
LEGACY_REFERENCE = re.compile(r"/(?:review|ship|test|audit)\b|agents/README\.md")


def _load_generator():
    spec = importlib.util.spec_from_file_location("gen_agent_personas", GENERATOR_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tracked(pattern: str) -> set[Path]:
    result = subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={ROOT.as_posix()}",
            "ls-files",
            "-z",
            "--",
            pattern,
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return {
        Path(item)
        for item in result.stdout.decode("utf-8").split("\0")
        if item
    }


def _persona_paths() -> tuple[set[Path], set[Path]]:
    claude = {
        path
        for path in _tracked(".claude/agents/*.md")
        if path.name != "README.md"
    }
    codex = _tracked(".codex/agents/*.toml")
    return claude, codex


def test_claude_and_codex_persona_sets_are_identical():
    claude, codex = _persona_paths()
    claude_names = {path.stem for path in claude}
    codex_names = {path.stem for path in codex}
    assert claude_names, "no tracked Claude persona files found"
    assert codex_names == claude_names


def test_generated_codex_personas_are_byte_equal_to_generator_output():
    generator = _load_generator()
    claude, codex = _persona_paths()
    codex_by_name = {path.stem: path for path in codex}
    for source in sorted(claude):
        generated = generator.render_persona(ROOT / source)
        tracked = (ROOT / codex_by_name[source.stem]).read_text(encoding="utf-8")
        assert tracked == generated, f"generated drift for {source.stem}"


def test_generator_check_mode_is_clean():
    result = subprocess.run(
        [sys.executable, str(GENERATOR_PATH), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"generator drift: {result.stdout}{result.stderr}"


def test_codex_metadata_and_instructions_follow_claude_source():
    generator = _load_generator()
    claude, codex = _persona_paths()
    codex_by_name = {path.stem: path for path in codex}
    for source in sorted(claude):
        metadata, body = generator.read_persona(ROOT / source)
        target = ROOT / codex_by_name[source.stem]
        content = target.read_text(encoding="utf-8")
        parsed = tomllib.loads(content)
        assert parsed["name"] == metadata["name"]
        assert parsed["description"] == metadata["description"]
        assert parsed["developer_instructions"] == body
        assert not LEGACY_REFERENCE.search(parsed["developer_instructions"])
        if metadata.get("model"):
            assert parsed["model"] == generator.MODEL_MAP[metadata["model"]]
        if metadata.get("effort"):
            assert parsed["model_reasoning_effort"] == metadata["effort"]
        if metadata.get("disallowedTools"):
            assert parsed["default_permissions"] == ":read-only"
            assert parsed["approval_policy"] == "never"
        else:
            assert "default_permissions" not in parsed
