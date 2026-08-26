#!/usr/bin/env python3
"""Generate project-local Codex agent TOML from Claude persona Markdown.

The Claude persona files are the canonical source.  This generator keeps the
Codex adapter deterministic, translates the provider model aliases to the
Codex model names used by the routing contract, and carries read-only policy
into Codex's permission fields.  Generated TOML is never edited by hand.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CLAUDE_DIR = ROOT / ".claude" / "agents"
CODEX_DIR = ROOT / ".codex" / "agents"
PERSONA_FIELDS = {
    "name",
    "description",
    "tools",
    "model",
    "effort",
    "disallowedTools",
}
LIST_FIELDS = {"tools", "disallowedTools"}
MODEL_MAP = {
    "haiku": "gpt-5.6-luna",
    "sonnet": "gpt-5.6-terra",
    "opus": "gpt-5.5",
    "fable": "gpt-5.6-sol",
}
LEGACY_REFERENCE = re.compile(r"/(?:review|ship|test|audit)\b")
FRONTMATTER_KEY = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$")


def _split_frontmatter(text: str, path: Path) -> tuple[dict[str, Any], str]:
    """Parse the small, intentionally restricted frontmatter dialect."""

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if not lines or lines[0] != "---":
        raise ValueError(f"{path}: frontmatter must start with ---")

    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError(f"{path}: frontmatter closing --- is missing") from exc

    metadata: dict[str, Any] = {}
    for line_number, line in enumerate(lines[1:end], start=2):
        if not line.strip():
            raise ValueError(f"{path}:{line_number}: blank frontmatter line")
        match = FRONTMATTER_KEY.match(line)
        if not match:
            raise ValueError(f"{path}:{line_number}: malformed frontmatter field")
        key, value = match.groups()
        if key not in PERSONA_FIELDS:
            raise ValueError(f"{path}:{line_number}: unsupported field {key!r}")
        if key in metadata:
            raise ValueError(f"{path}:{line_number}: duplicate field {key!r}")
        value = value.strip()
        if not value:
            raise ValueError(f"{path}:{line_number}: empty field {key!r}")
        if key in LIST_FIELDS:
            values = [item.strip() for item in value.split(",")]
            if not values or any(not item for item in values):
                raise ValueError(f"{path}:{line_number}: invalid list field {key!r}")
            metadata[key] = values
        else:
            metadata[key] = value

    for required in ("name", "description"):
        if required not in metadata:
            raise ValueError(f"{path}: missing required field {required!r}")
    if metadata["name"] != path.stem:
        raise ValueError(
            f"{path}: frontmatter name {metadata['name']!r} does not match filename"
        )

    body = "\n".join(lines[end + 1 :])
    if body.startswith("\n"):
        body = body[1:]
    body = body.replace("agents/README.md", "README.md")
    if LEGACY_REFERENCE.search(body) or "agents/README.md" in body:
        raise ValueError(f"{path}: retired slash-command or README reference remains")
    if '"""' in body:
        raise ValueError(f"{path}: developer instructions contain a TOML triple quote")
    body = body.rstrip("\n") + "\n"
    return metadata, body


def read_persona(path: Path) -> tuple[dict[str, Any], str]:
    return _split_frontmatter(path.read_text(encoding="utf-8"), path)


def persona_sources() -> list[Path]:
    if not CLAUDE_DIR.is_dir():
        raise ValueError(f"canonical persona directory is missing: {CLAUDE_DIR}")
    paths = sorted(CLAUDE_DIR.glob("*.md"))
    paths = [path for path in paths if path.name != "README.md"]
    if not paths:
        raise ValueError(f"no persona Markdown files found under {CLAUDE_DIR}")
    return paths


def _toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_persona(path: Path) -> str:
    metadata, body = read_persona(path)
    lines = [
        f"# Generated from {path.relative_to(ROOT).as_posix()}; do not edit by hand.",
        f"name = {_toml_string(metadata['name'])}",
        f"description = {_toml_string(metadata['description'])}",
    ]

    claude_model = metadata.get("model")
    if claude_model:
        try:
            codex_model = MODEL_MAP[claude_model]
        except KeyError as exc:
            raise ValueError(f"{path}: unsupported Claude model {claude_model!r}") from exc
        lines.extend(
            [
                f"# Claude model: {claude_model}",
                f"model = {_toml_string(codex_model)}",
            ]
        )
    if metadata.get("effort"):
        lines.extend(
            [
                f"# Claude effort: {metadata['effort']}",
                f"model_reasoning_effort = {_toml_string(metadata['effort'])}",
            ]
        )

    tools = metadata.get("tools")
    if tools:
        lines.append(f"# Claude tools: {', '.join(tools)}")
    disallowed_tools = metadata.get("disallowedTools")
    if disallowed_tools:
        lines.extend(
            [
                f"# Claude disallowedTools: {', '.join(disallowed_tools)}",
                'default_permissions = ":read-only"',
                'approval_policy = "never"',
            ]
        )

    lines.extend(["developer_instructions = \"\"\"", body.rstrip("\n"), '\"\"\"', ""])
    return "\n".join(lines)


def generated_personas() -> dict[str, str]:
    return {path.stem: render_persona(path) for path in persona_sources()}


def _existing_names() -> set[str]:
    if not CODEX_DIR.is_dir():
        return set()
    return {path.stem for path in CODEX_DIR.glob("*.toml")}


def check_or_write(check: bool) -> int:
    generated = generated_personas()
    expected = set(generated)
    existing = _existing_names()
    missing = sorted(expected - existing)
    extra = sorted(existing - expected)
    drift = sorted(
        name
        for name, content in generated.items()
        if (CODEX_DIR / f"{name}.toml").is_file()
        and (CODEX_DIR / f"{name}.toml").read_text(encoding="utf-8") != content
    )

    if missing:
        print("MISSING:", ", ".join(missing))
    if extra:
        print("EXTRA:", ", ".join(extra))
    if drift:
        print("DRIFT:", ", ".join(drift))
    if missing or extra or drift:
        if check:
            return 1
        if extra:
            print("Refusing to remove unexpected Codex persona files; resolve them manually.")
            return 1

    if check:
        print(f"OK: {len(generated)} Codex personas match the Claude source")
        return 0

    CODEX_DIR.mkdir(parents=True, exist_ok=True)
    for name, content in generated.items():
        target = CODEX_DIR / f"{name}.toml"
        with target.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        print(f"generated {target.relative_to(ROOT).as_posix()}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify that tracked Codex persona files match generated output",
    )
    args = parser.parse_args(argv)
    try:
        return check_or_write(args.check)
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
