"""Observed architecture extraction and ratchet enforcement.

``scripts/lib/architecture_contract.py`` validates the *desired* architecture and
each change's *intended* delta. This module produces the *observed* architecture
by statically scanning committed source, then enforces a ratchet:

* every observed service dependency edge must either be recorded in the approved
  baseline or be declared by both the architecture contract and an architecture
  delta (``ARCH-CALL-001`` / ``ARCH-DELTA-001``);
* the number and identity of dependency cycles must never grow (``ARCH-GRAPH-001``).

Two properties are deliberate.

*Determinism*: the extractor uses only Python's standard library, reads committed
files, sorts every collection, emits repository-relative POSIX paths, and never
records timestamps or absolute paths. The same source tree therefore yields a
byte-identical report on Windows and Linux.

*Advisory-only GitNexus*: the change proposal originally named GitNexus as the
observation source. GitNexus is a code-intelligence index whose CLI has been
observed to fail with transport errors and to serve a stale index, so it cannot
back a fail-closed CI gate. It stays advisory; the gate reads source directly.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
import io
import json
from pathlib import Path
import re
import tokenize
from typing import Any, Iterable, Mapping, Sequence

from scripts.lib.architecture_contract import (
    ValidationIssue,
    _is_mapping,
    _is_sequence,
    _issue,
    _load_json,
    validate_schema_instance,
)

CONFIG_SCHEMA_VERSION = "ai-bim-observed-graph-config/v1"
BASELINE_SCHEMA_VERSION = "ai-bim-observed-baseline/v1"
REPORT_SCHEMA_VERSION = "ai-bim-observed-architecture-report/v1"
RATCHET_RESULT_SCHEMA_VERSION = "ai-bim-observed-architecture-ratchet-result/v1"

EXTRACTION_METHOD = "stdlib-static-source-scan"

CONFIG_RELATIVE_PATH = "architecture/observed-graph.config.json"
CONFIG_SCHEMA_RELATIVE_PATH = "architecture/observed-graph.config.schema.json"
BASELINE_RELATIVE_PATH = "architecture/observed-baseline.json"
BASELINE_SCHEMA_RELATIVE_PATH = "architecture/observed-baseline.schema.json"
CONTRACT_RELATIVE_PATH = "architecture/architecture-contract.json"
DELTA_DIRECTORY = "architecture/deltas"

SERVICE_GRAPH_SCOPE = "service-graph"
MODULE_GRAPH_SCOPE_PREFIX = "module-graph:"

BASELINE_EDGE_STATUSES = ("declared", "undeclared-edge", "undeclared-node")

_URL_PORT_PATTERN = re.compile(
    r"(?:https?|wss?)://(?P<host>[A-Za-z0-9._-]+):(?P<port>\d{2,5})"
)
_TS_IMPORT_PATTERNS = (
    re.compile(r"""\bfrom\s+(?P<q>['"])(?P<spec>[^'"]+)(?P=q)"""),
    re.compile(r"""\bimport\s+(?P<q>['"])(?P<spec>[^'"]+)(?P=q)"""),
    re.compile(r"""\bimport\s*\(\s*(?P<q>['"])(?P<spec>[^'"]+)(?P=q)\s*\)"""),
    re.compile(r"""\brequire\s*\(\s*(?P<q>['"])(?P<spec>[^'"]+)(?P=q)\s*\)"""),
)
_COMPOSE_SERVICE_HEADER = re.compile(r"^  (?P<name>[A-Za-z0-9._-]+):\s*$")
_COMPOSE_DEPENDS_ON = re.compile(r"^    depends_on:\s*$")
_COMPOSE_DEPENDS_ITEM = re.compile(r"^      -\s*(?P<name>[A-Za-z0-9._-]+)\s*$")
_COMPOSE_DEPENDS_MAP_ITEM = re.compile(r"^      (?P<name>[A-Za-z0-9._-]+):\s*$")


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class EdgeEvidence:
    """One explainable reason an observed service edge exists."""

    file: str
    line: int
    kind: str
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {"file": self.file, "line": self.line, "kind": self.kind, "detail": self.detail}

    @property
    def sort_key(self) -> tuple[str, int, str, str]:
        return (self.file, self.line, self.kind, self.detail)


@dataclass(frozen=True, slots=True)
class ObservedEdge:
    """A service-level dependency edge observed in committed source."""

    source: str
    target: str
    evidence: tuple[EdgeEvidence, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "from": self.source,
            "to": self.target,
            "evidence": [item.to_dict() for item in self.evidence],
        }

    @property
    def pair(self) -> tuple[str, str]:
        return (self.source, self.target)


@dataclass(frozen=True, slots=True)
class ObservedCycle:
    """A strongly connected component with at least two members."""

    scope: str
    members: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {"scope": self.scope, "members": list(self.members)}

    @property
    def signature(self) -> tuple[str, tuple[str, ...]]:
        return (self.scope, self.members)


@dataclass(frozen=True, slots=True)
class ObservedReport:
    """Deterministic observation of the repository's dependency structure."""

    nodes: tuple[str, ...]
    edges: tuple[ObservedEdge, ...]
    cycles: tuple[ObservedCycle, ...]
    module_graphs: tuple[Mapping[str, Any], ...]
    scanned_file_count: int
    unreadable_files: tuple[str, ...] = ()
    unparsed_files: tuple[str, ...] = ()

    @property
    def read_failures(self) -> list[ValidationIssue]:
        """A file that could not be read or parsed was not observed, so say so."""

        issues = [
            _issue(
                "observed.file.unreadable",
                relative,
                "Source file could not be read as UTF-8, so its dependencies were not observed.",
            )
            for relative in self.unreadable_files
        ]
        issues.extend(
            _issue(
                "observed.file.unparsed",
                relative,
                "Source file could not be parsed, so its dependencies were not observed.",
            )
            for relative in self.unparsed_files
        )
        return issues

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": REPORT_SCHEMA_VERSION,
            "extraction_method": EXTRACTION_METHOD,
            "nodes": list(self.nodes),
            "scanned_file_count": self.scanned_file_count,
            "unreadable_files": list(self.unreadable_files),
            "unparsed_files": list(self.unparsed_files),
            "service_edges": [edge.to_dict() for edge in self.edges],
            "cycles": [cycle.to_dict() for cycle in self.cycles],
            "module_graphs": [dict(graph) for graph in self.module_graphs],
        }

    def cycle_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {SERVICE_GRAPH_SCOPE: 0}
        for graph in self.module_graphs:
            counts[f"{MODULE_GRAPH_SCOPE_PREFIX}{graph['service']}"] = 0
        for cycle in self.cycles:
            counts[cycle.scope] = counts.get(cycle.scope, 0) + 1
        return counts


@dataclass(frozen=True, slots=True)
class RatchetResult:
    """Result returned by :func:`check_observed_architecture`."""

    repo_root: str
    report: ObservedReport | None
    issues: tuple[ValidationIssue, ...]
    compared: bool = False
    """True only when the observed graph was actually compared against the baseline.

    Every early return leaves this False, so a run that never reached the
    comparison cannot report ``passed`` merely because it collected no issues.
    """

    @property
    def error_count(self) -> int:
        return sum(issue.severity == "error" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(issue.severity == "warning" for issue in self.issues)

    @property
    def status(self) -> str:
        return "passed" if self.error_count == 0 and self.compared else "failed"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": RATCHET_RESULT_SCHEMA_VERSION,
            "status": self.status,
            "repo_root": self.repo_root,
            "compared": self.compared,
            "summary": {
                "errors": self.error_count,
                "warnings": self.warning_count,
                "issues": len(self.issues),
            },
            "report": self.report.to_dict() if self.report is not None else None,
            "issues": [issue.to_dict() for issue in self.issues],
        }


# --------------------------------------------------------------------------- #
# Source scanning helpers
# --------------------------------------------------------------------------- #


# Deliberately conservative. `<` and `>` are excluded because `</h1>` in JSX would
# otherwise open a regex and swallow the rest of the file; `}` is excluded because
# JSX text like `{a}/{b}` would do the same. Arithmetic operators are excluded too:
# a regex after `+` or `*` is vanishingly rare, while a false regex start silently
# deletes real URLs, which is the failure direction that weakens the gate.
_REGEX_PRECEDING = set("(,=:[!&|?{;") | {""}
_REGEX_PRECEDING_WORDS = {
    "return",
    "typeof",
    "instanceof",
    "case",
    "yield",
    "await",
    "void",
}


# A block comment may open at the start of a line, or after punctuation that ends an
# expression or statement. It may NOT open directly after an identifier or digit:
# that is how JSX text such as `<code>/api/kit/*</code>` opened a comment and erased
# every dependency between it and the next genuine `*/`. Refusing to strip an unusual
# trailing `x /* note */` is the safe direction — a URL inside an unstripped comment
# at worst produces a visible extra edge, while a wrongly stripped region is silent.
_BLOCK_COMMENT_PRECEDING = _REGEX_PRECEDING | set(")]")


def _regex_literal_may_start(prefix: str) -> bool:
    """Decide whether a ``/`` at this position opens a regex literal, not a divide.

    Getting this wrong in the permissive direction turns ``/["']/`` into an
    unbalanced quote, which swallows the rest of the line — including real URLs.
    """

    stripped = prefix.rstrip()
    if not stripped:
        return True
    last = stripped[-1]
    if last in _REGEX_PRECEDING:
        return True
    match = re.search(r"([A-Za-z_$][A-Za-z0-9_$]*)$", stripped)
    return bool(match and match.group(1) in _REGEX_PRECEDING_WORDS)


def _block_comment_may_start(prefix: str) -> bool:
    """Decide whether ``/*`` at this position opens a comment rather than being text."""

    stripped = prefix.rstrip()
    if not stripped:
        return True
    return stripped[-1] in _BLOCK_COMMENT_PRECEDING


def strip_typescript_comments(text: str) -> tuple[list[str], bool]:
    """Blank out TS/JS comments, preserving line numbering and string bodies.

    Returns ``(lines, clean)``. ``clean`` is False when the scanner finished in an
    unterminated block comment or template literal, which means its view of the
    file is untrustworthy and the caller must not treat the result as observed.
    """

    lines = text.splitlines()
    out: list[list[str]] = [list(line) for line in lines]

    # Absolute offsets let the scanner check that an opening delimiter actually
    # closes somewhere later. JSX text such as `<code>:8004 /api/kit/*</code>`
    # contains a literal `/*` that is not a comment; without this lookahead the
    # scanner would treat the rest of the file as commented out and silently lose
    # every dependency in it.
    offsets: list[int] = []
    running = 0
    for line in lines:
        offsets.append(running)
        running += len(line) + 1

    def closes_later(opener_end: int, closer: str) -> bool:
        return text.find(closer, opener_end) != -1

    row = 0
    col = 0
    state = "code"
    quote = ""
    char_class = False
    while row < len(lines):
        line = lines[row]
        if col >= len(line):
            if state in {"line_comment", "single", "double", "regex"}:
                # These cannot span a newline. Recover rather than bleeding on.
                state = "code"
                char_class = False
            row += 1
            col = 0
            continue
        char = line[col]
        nxt = line[col + 1] if col + 1 < len(line) else ""
        if state == "code":
            if char == "/" and nxt == "/" and (col == 0 or line[col - 1] != ":"):
                # `://` is a URL scheme separator, never a comment. Without this
                # guard a URL sitting in an unstripped region would be read as a
                # comment opener and would erase the rest of the line, which may
                # contain a genuine dependency.
                state = "line_comment"
                out[row][col] = " "
                continue
            if (
                char == "/"
                and nxt == "*"
                and _block_comment_may_start(line[:col])
                and closes_later(offsets[row] + col + 2, "*/")
            ):
                state = "block_comment"
                out[row][col] = " "
                out[row][col + 1] = " "
                col += 2
                continue
            if char == "/" and _regex_literal_may_start(line[:col]):
                state = "regex"
                char_class = False
                col += 1
                continue
            if char == "`" and not closes_later(offsets[row] + col + 1, "`"):
                col += 1
                continue
            if char in "'\"`":
                state = {"'": "single", '"': "double", "`": "template"}[char]
                quote = char
                col += 1
                continue
            col += 1
            continue
        if state == "line_comment":
            out[row][col] = " "
            col += 1
            continue
        if state == "block_comment":
            if char == "*" and nxt == "/":
                out[row][col] = " "
                out[row][col + 1] = " "
                col += 2
                state = "code"
                continue
            out[row][col] = " "
            col += 1
            continue
        if state == "regex":
            if char == "\\":
                col += 2
                continue
            if char == "[":
                char_class = True
            elif char == "]":
                char_class = False
            elif char == "/" and not char_class:
                state = "code"
            col += 1
            continue
        # inside a string or template literal
        if char == "\\":
            col += 2
            continue
        if char == quote:
            state = "code"
            quote = ""
        col += 1
    return ["".join(chars) for chars in out], state not in {"block_comment", "template"}


def _python_string_literals(text: str) -> list[tuple[int, str]]:
    """Return ``(line, value)`` for every string constant, comments excluded."""

    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        # ValueError covers source containing NUL bytes, which read_text accepts.
        return []
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            found.append((node.lineno, node.value))
        elif isinstance(node, ast.JoinedStr):
            for part in node.values:
                if isinstance(part, ast.Constant) and isinstance(part.value, str):
                    found.append((node.lineno, part.value))
    return found


@dataclass
class ScanDiagnostics:
    """Files the scan could not observe. Silence here would weaken the gate."""

    unreadable: list[str]
    unparsed: list[str]

    @classmethod
    def empty(cls) -> "ScanDiagnostics":
        return cls(unreadable=[], unparsed=[])


def _python_code_lines(text: str) -> list[str]:
    """Return the source with ``#`` comments removed, preserving line numbering.

    Uses :mod:`tokenize` so a ``#`` inside a string literal is never mistaken for
    the start of a comment.
    """

    lines = text.splitlines()
    out = [list(line) for line in lines]
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return lines
    for token in tokens:
        if token.type != tokenize.COMMENT:
            continue
        row = token.start[0] - 1
        if not 0 <= row < len(out):
            continue
        for column in range(token.start[1], min(token.end[1], len(out[row]))):
            out[row][column] = " "
    return ["".join(chars) for chars in out]


def _read_text(
    path: Path, *, relative: str | None = None, diagnostics: ScanDiagnostics | None = None
) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        if diagnostics is not None and relative is not None:
            diagnostics.unreadable.append(relative)
        return None


def _is_excluded(relative: str, config: Mapping[str, Any]) -> bool:
    probe = f"/{relative}"
    for fragment in config.get("exclude_path_fragments", []):
        if fragment in probe:
            return True
    name = relative.rsplit("/", 1)[-1]
    for suffix in config.get("exclude_file_suffixes", []):
        if name.endswith(suffix):
            return True
    for prefix in config.get("exclude_file_prefixes", []):
        if name.startswith(prefix):
            return True
    return False


def _suppression_patterns(config: Mapping[str, Any]) -> tuple[re.Pattern[str], ...]:
    """Compile the configured "this line is not an outbound call" patterns."""

    compiled: list[re.Pattern[str]] = []
    for entry in config.get("edge_suppression_line_patterns", []):
        if not _is_mapping(entry):
            continue
        raw = entry.get("pattern")
        if not isinstance(raw, str):
            continue
        try:
            compiled.append(re.compile(raw))
        except re.error:
            continue
    return tuple(compiled)


def _is_suppressed(line: str, patterns: Sequence[re.Pattern[str]]) -> bool:
    return any(pattern.search(line) for pattern in patterns)


def _iter_source_files(
    repo_root: Path, root_relative: str, suffixes: Sequence[str], config: Mapping[str, Any]
) -> list[Path]:
    base = repo_root / root_relative
    if not base.is_dir():
        return []
    found: list[Path] = []
    for path in base.rglob("*"):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        try:
            relative = path.relative_to(repo_root).as_posix()
        except ValueError:  # pragma: no cover - defensive
            continue
        if _is_excluded(relative, config):
            continue
        found.append(path)
    return sorted(found)


# --------------------------------------------------------------------------- #
# Module-level graph
# --------------------------------------------------------------------------- #


def _python_module_name(root: Path, path: Path) -> str:
    parts = list(path.relative_to(root).parts)
    if parts[-1] == "__init__.py":
        parts.pop()
    else:
        parts[-1] = parts[-1][: -len(".py")]
    return ".".join(parts)


def _python_module_edges(
    root: Path,
    repo_root: Path,
    files: Sequence[Path],
    diagnostics: ScanDiagnostics,
) -> set[tuple[str, str]]:
    index = {_python_module_name(root, path) for path in files}
    edges: set[tuple[str, str]] = set()
    for path in files:
        relative = path.relative_to(repo_root).as_posix()
        text = _read_text(path, relative=relative, diagnostics=diagnostics)
        if text is None:
            continue
        try:
            tree = ast.parse(text)
        except (SyntaxError, ValueError):
            # ValueError covers source containing NUL bytes, which read_text accepts.
            diagnostics.unparsed.append(relative)
            continue
        current = _python_module_name(root, path)
        if path.name == "__init__.py":
            package_parts = current.split(".")
        else:
            package_parts = current.split(".")[:-1]
        package = [part for part in package_parts if part]
        for node in ast.walk(tree):
            targets: list[str] = []
            if isinstance(node, ast.Import):
                targets.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    depth = len(package) - (node.level - 1)
                    if depth < 0:
                        continue
                    prefix = ".".join(package[:depth] if node.level > 1 else package)
                    # When the importing module sits directly in the scan root the
                    # package prefix is empty. Joining unconditionally would yield
                    # ".sibling", which resolves to nothing and silently drops the
                    # edge — this is how kit-manager-api ended up with an empty graph.
                    if node.module:
                        module = f"{prefix}.{node.module}" if prefix else node.module
                    else:
                        module = prefix
                else:
                    module = node.module or ""
                if module:
                    targets.append(module)
                    targets.extend(
                        f"{module}.{alias.name}" for alias in node.names if alias.name != "*"
                    )
                elif node.level:
                    # `from . import sibling` at the scan root: the names are modules.
                    targets.extend(alias.name for alias in node.names if alias.name != "*")
            for target in targets:
                resolved = _resolve_python_target(target, index)
                if resolved is not None and resolved != current:
                    edges.add((current, resolved))
    return edges


def _resolve_python_target(dotted: str, index: set[str]) -> str | None:
    if not dotted or dotted.startswith("."):
        return None
    parts = dotted.split(".")
    while parts:
        candidate = ".".join(parts)
        if candidate and candidate in index:
            return candidate
        parts.pop()
    return None


def _typescript_module_edges(
    root: Path,
    repo_root: Path,
    files: Sequence[Path],
    diagnostics: ScanDiagnostics,
) -> set[tuple[str, str]]:
    known = {path.relative_to(root).as_posix() for path in files}
    edges: set[tuple[str, str]] = set()
    for path in files:
        relative = path.relative_to(repo_root).as_posix()
        text = _read_text(path, relative=relative, diagnostics=diagnostics)
        if text is None:
            continue
        current = path.relative_to(root).as_posix()
        stripped, clean = strip_typescript_comments(text)
        if not clean:
            diagnostics.unparsed.append(relative)
        for line in stripped:
            for pattern in _TS_IMPORT_PATTERNS:
                for match in pattern.finditer(line):
                    spec = match.group("spec")
                    if not spec.startswith("."):
                        continue
                    resolved = _resolve_typescript_target(path.parent, spec, root, known)
                    if resolved is not None and resolved != current:
                        edges.add((current, resolved))
    return edges


def _resolve_typescript_target(
    from_dir: Path, spec: str, root: Path, known: set[str]
) -> str | None:
    raw = (from_dir / spec).resolve()
    try:
        stem = raw.relative_to(root.resolve()).as_posix()
    except ValueError:
        return None
    candidates: list[str] = []
    for js_suffix, ts_suffix in ((".js", ".ts"), (".jsx", ".tsx"), (".mjs", ".ts"), (".cjs", ".ts")):
        if stem.endswith(js_suffix):
            candidates.append(stem[: -len(js_suffix)] + ts_suffix)
    candidates.extend(
        [stem, f"{stem}.ts", f"{stem}.tsx", f"{stem}/index.ts", f"{stem}/index.tsx"]
    )
    for candidate in candidates:
        if candidate in known:
            return candidate
    return None


# --------------------------------------------------------------------------- #
# Cycle detection
# --------------------------------------------------------------------------- #


def strongly_connected_cycles(edges: Iterable[tuple[str, str]]) -> list[tuple[str, ...]]:
    """Return every strongly connected component of size >= 2, deterministically.

    Uses an explicit stack so deeply nested module graphs cannot hit Python's
    recursion limit.
    """

    adjacency: dict[str, list[str]] = {}
    for source, target in edges:
        adjacency.setdefault(source, []).append(target)
        adjacency.setdefault(target, [])
    for node in adjacency:
        adjacency[node] = sorted(set(adjacency[node]))

    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    counter = 0
    components: list[tuple[str, ...]] = []

    for start in sorted(adjacency):
        if start in index:
            continue
        work: list[tuple[str, int]] = [(start, 0)]
        while work:
            node, child_position = work[-1]
            if child_position == 0:
                index[node] = counter
                low[node] = counter
                counter += 1
                stack.append(node)
                on_stack.add(node)
            recursed = False
            neighbours = adjacency[node]
            while child_position < len(neighbours):
                neighbour = neighbours[child_position]
                child_position += 1
                if neighbour not in index:
                    work[-1] = (node, child_position)
                    work.append((neighbour, 0))
                    recursed = True
                    break
                if neighbour in on_stack:
                    low[node] = min(low[node], index[neighbour])
            if recursed:
                continue
            work[-1] = (node, child_position)
            work.pop()
            if low[node] == index[node]:
                component: list[str] = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component.append(member)
                    if member == node:
                        break
                if len(component) > 1:
                    components.append(tuple(sorted(component)))
            if work:
                parent, parent_position = work[-1]
                low[parent] = min(low[parent], low[node])
    return sorted(components)


# --------------------------------------------------------------------------- #
# Service-level graph
# --------------------------------------------------------------------------- #


def _port_owner_index(config: Mapping[str, Any]) -> dict[int, str]:
    owners: dict[int, str] = {}
    for entry in config.get("service_roots", []):
        for port in entry.get("inbound_edge_ports", []):
            owners[int(port)] = str(entry["id"])
    return owners


def _service_edges_from_source(
    repo_root: Path, config: Mapping[str, Any], diagnostics: ScanDiagnostics
) -> tuple[dict[tuple[str, str], list[EdgeEvidence]], int, list[Mapping[str, Any]]]:
    port_owner = _port_owner_index(config)
    suppression = _suppression_patterns(config)
    suffixes = config.get("source_suffixes", {})
    collected: dict[tuple[str, str], list[EdgeEvidence]] = {}
    module_graphs: list[Mapping[str, Any]] = []
    scanned = 0

    for entry in sorted(config.get("service_roots", []), key=lambda item: str(item["id"])):
        service_id = str(entry["id"])
        language = str(entry["language"])
        service_suffixes = suffixes.get(language, [])
        module_edges: set[tuple[str, str]] = set()
        module_nodes: set[str] = set()

        for root_relative in sorted(entry.get("roots", [])):
            files = _iter_source_files(repo_root, root_relative, service_suffixes, config)
            scanned += len(files)
            root_path = repo_root / root_relative

            for path in files:
                relative = path.relative_to(repo_root).as_posix()
                text = _read_text(path, relative=relative, diagnostics=diagnostics)
                if text is None:
                    continue
                # Suppression must be judged on code, never on comments. A line
                # reading `const api = "http://coordinator:8004"; // not a CORS thing`
                # would otherwise silently drop a real edge.
                if language == "python":
                    # Only string constants carry call targets, so comments and
                    # docstring prose can never manufacture an edge.
                    candidates = _python_string_literals(text)
                    context_lines = _python_code_lines(text)
                else:
                    stripped, clean = strip_typescript_comments(text)
                    if not clean:
                        diagnostics.unparsed.append(relative)
                    candidates = list(enumerate(stripped, start=1))
                    context_lines = stripped
                for line_number, value in candidates:
                    context = (
                        context_lines[line_number - 1]
                        if 0 < line_number <= len(context_lines)
                        else value
                    )
                    if _is_suppressed(context, suppression):
                        continue
                    for match in _URL_PORT_PATTERN.finditer(value):
                        target = port_owner.get(int(match.group("port")))
                        if target is None or target == service_id:
                            continue
                        collected.setdefault((service_id, target), []).append(
                            EdgeEvidence(
                                file=relative,
                                line=line_number,
                                kind="url-literal",
                                detail=f"{match.group('host')}:{match.group('port')}",
                            )
                        )

            if language == "python":
                edges = _python_module_edges(root_path, repo_root, files, diagnostics)
                module_nodes.update(_python_module_name(root_path, path) for path in files)
            else:
                edges = _typescript_module_edges(root_path, repo_root, files, diagnostics)
                module_nodes.update(path.relative_to(root_path).as_posix() for path in files)
            module_edges.update(edges)

        module_graphs.append(
            {
                "service": service_id,
                "module_count": len(module_nodes),
                "edge_count": len(module_edges),
                "cycles": [list(members) for members in strongly_connected_cycles(module_edges)],
            }
        )

    return collected, scanned, module_graphs


def _service_edges_from_compose(
    repo_root: Path, config: Mapping[str, Any], diagnostics: ScanDiagnostics
) -> dict[tuple[str, str], list[EdgeEvidence]]:
    port_owner = _port_owner_index(config)
    suppression = _suppression_patterns(config)
    compose_map = {
        str(item["compose_service"]): str(item["service"])
        for item in config.get("compose_service_map", [])
    }
    collected: dict[tuple[str, str], list[EdgeEvidence]] = {}

    for name in sorted(config.get("compose_files", [])):
        path = repo_root / name
        text = _read_text(path, relative=name, diagnostics=diagnostics)
        if text is None:
            continue
        relative = path.relative_to(repo_root).as_posix()
        current: str | None = None
        in_depends = False
        for number, line in enumerate(text.splitlines(), start=1):
            stripped = line.split("#", 1)[0].rstrip()
            header = _COMPOSE_SERVICE_HEADER.match(stripped)
            if header:
                current = compose_map.get(header.group("name"))
                in_depends = False
                continue
            if current is None:
                continue
            if _COMPOSE_DEPENDS_ON.match(stripped):
                in_depends = True
                continue
            if in_depends:
                item = _COMPOSE_DEPENDS_ITEM.match(stripped) or _COMPOSE_DEPENDS_MAP_ITEM.match(
                    stripped
                )
                if item:
                    target = compose_map.get(item.group("name"))
                    if target is not None and target != current:
                        collected.setdefault((current, target), []).append(
                            EdgeEvidence(
                                file=relative,
                                line=number,
                                kind="compose-depends-on",
                                detail=item.group("name"),
                            )
                        )
                    continue
                if stripped and not stripped.startswith("      "):
                    in_depends = False
            if _is_suppressed(stripped, suppression):
                continue
            for match in _URL_PORT_PATTERN.finditer(stripped):
                target = port_owner.get(int(match.group("port")))
                if target is None or target == current:
                    continue
                collected.setdefault((current, target), []).append(
                    EdgeEvidence(
                        file=relative,
                        line=number,
                        kind="compose-url",
                        detail=f"{match.group('host')}:{match.group('port')}",
                    )
                )
    return collected


def build_observed_report(repo_root: str | Path, config: Mapping[str, Any]) -> ObservedReport:
    """Scan committed source and return a deterministic observed dependency report."""

    root = Path(repo_root).resolve()
    diagnostics = ScanDiagnostics.empty()
    source_edges, scanned, module_graphs = _service_edges_from_source(root, config, diagnostics)
    compose_edges = _service_edges_from_compose(root, config, diagnostics)

    merged: dict[tuple[str, str], list[EdgeEvidence]] = {}
    for bucket in (source_edges, compose_edges):
        for pair, evidence in bucket.items():
            merged.setdefault(pair, []).extend(evidence)

    edges = tuple(
        ObservedEdge(
            source=pair[0],
            target=pair[1],
            evidence=tuple(sorted(set(merged[pair]), key=lambda item: item.sort_key)),
        )
        for pair in sorted(merged)
    )

    cycles: list[ObservedCycle] = [
        ObservedCycle(scope=SERVICE_GRAPH_SCOPE, members=members)
        for members in strongly_connected_cycles(edge.pair for edge in edges)
    ]
    for graph in module_graphs:
        scope = f"{MODULE_GRAPH_SCOPE_PREFIX}{graph['service']}"
        for members in graph["cycles"]:
            cycles.append(ObservedCycle(scope=scope, members=tuple(members)))

    nodes = sorted({str(entry["id"]) for entry in config.get("service_roots", [])})
    return ObservedReport(
        nodes=tuple(nodes),
        edges=edges,
        cycles=tuple(sorted(cycles, key=lambda item: item.signature)),
        module_graphs=tuple(module_graphs),
        scanned_file_count=scanned,
        unreadable_files=tuple(sorted(set(diagnostics.unreadable))),
        unparsed_files=tuple(sorted(set(diagnostics.unparsed))),
    )


# --------------------------------------------------------------------------- #
# Ratchet comparison
# --------------------------------------------------------------------------- #


def _contract_allowed_pairs(contract: Mapping[str, Any], config: Mapping[str, Any]) -> set[tuple[str, str]]:
    contract_to_node = {
        str(entry["contract_service"]): str(entry["id"])
        for entry in config.get("service_roots", [])
        if entry.get("contract_service")
    }
    allowed: set[tuple[str, str]] = set()
    services = contract.get("services")
    if not _is_sequence(services):
        return allowed
    for service in services:
        if not _is_mapping(service):
            continue
        source = contract_to_node.get(str(service.get("id")))
        if source is None:
            continue
        calls = service.get("may_call")
        if not _is_sequence(calls):
            continue
        for call in calls:
            if not _is_mapping(call):
                continue
            target = contract_to_node.get(str(call.get("target")))
            if target is not None:
                allowed.add((source, target))
    return allowed


def _delta_declared_pairs(
    repo_root: Path, config: Mapping[str, Any]
) -> tuple[set[tuple[str, str]], list[ValidationIssue]]:
    contract_to_node = {
        str(entry["contract_service"]): str(entry["id"])
        for entry in config.get("service_roots", [])
        if entry.get("contract_service")
    }
    issues: list[ValidationIssue] = []
    delta_root = repo_root / DELTA_DIRECTORY
    if not delta_root.is_dir():
        return set(), issues

    loaded: list[tuple[str, str, Mapping[str, Any]]] = []
    for path in sorted(delta_root.glob("*.json")):
        delta, load_issues = _load_json(path)
        issues.extend(load_issues)
        if not _is_mapping(delta):
            continue
        created_on = delta.get("created_on")
        loaded.append((created_on if isinstance(created_on, str) else "", path.name, delta))

    # Deltas are applied in chronological order rather than as a global
    # `added - removed` difference. A global difference would let one historical
    # removal permanently cancel a later, legitimate re-introduction of the edge.
    declared: set[tuple[str, str]] = set()
    for _, _, delta in sorted(loaded, key=lambda item: (item[0], item[1])):
        for key, add in (("added_dependency_edges", True), ("removed_dependency_edges", False)):
            entries = delta.get(key)
            if not _is_sequence(entries):
                continue
            for entry in entries:
                if not _is_mapping(entry):
                    continue
                source = contract_to_node.get(str(entry.get("from")))
                target = contract_to_node.get(str(entry.get("to")))
                if source is None or target is None:
                    continue
                if add:
                    declared.add((source, target))
                else:
                    declared.discard((source, target))
    return declared, issues


def _load_baseline(
    repo_root: Path,
) -> tuple[Mapping[str, Any] | None, list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    baseline_path = repo_root / BASELINE_RELATIVE_PATH
    schema_path = repo_root / BASELINE_SCHEMA_RELATIVE_PATH

    schema, schema_issues = _load_json(schema_path)
    issues.extend(schema_issues)
    if not _is_mapping(schema):
        # A corrupt schema file would silently disable every required/enum check
        # below, so it fails rather than degrading to the hand-written checks.
        issues.append(
            _issue(
                "baseline.schema_not_object",
                BASELINE_SCHEMA_RELATIVE_PATH,
                "Baseline schema document must be a JSON object.",
            )
        )
    baseline, baseline_issues = _load_json(baseline_path)
    issues.extend(baseline_issues)
    if not _is_mapping(baseline):
        # `null`, `[]` and `123` are all valid JSON but not a baseline. Without an
        # explicit issue here the caller would return zero errors and read as passed.
        issues.append(
            _issue(
                "baseline.not_object",
                BASELINE_RELATIVE_PATH,
                "Baseline document must be a JSON object.",
            )
        )
        return None, issues
    if _is_mapping(schema):
        issues.extend(
            ValidationIssue(
                code=issue.code,
                path=f"{BASELINE_RELATIVE_PATH}:{issue.path}",
                message=issue.message,
                severity=issue.severity,
            )
            for issue in validate_schema_instance(baseline, schema)
        )
    if baseline.get("schema_version") != BASELINE_SCHEMA_VERSION:
        issues.append(
            _issue(
                "baseline.schema_version",
                BASELINE_RELATIVE_PATH,
                f"Baseline schema_version must be {BASELINE_SCHEMA_VERSION!r}.",
            )
        )
    # These repeat constraints the schema also expresses. They are duplicated on
    # purpose: the schema file is itself an input, and a governance gate should not
    # depend on a single point of failure to know what a valid baseline looks like.
    seen_pairs: set[tuple[str, str]] = set()
    entries = baseline.get("service_edges")
    for entry in entries if _is_sequence(entries) else []:
        if not _is_mapping(entry):
            continue
        status = entry.get("status")
        if status not in BASELINE_EDGE_STATUSES:
            issues.append(
                _issue(
                    "baseline.status_invalid",
                    BASELINE_RELATIVE_PATH,
                    f"Baseline edge {entry.get('from')} -> {entry.get('to')} has status "
                    f"{status!r}; expected one of {list(BASELINE_EDGE_STATUSES)}.",
                )
            )
        if status in {"undeclared-edge", "undeclared-node"} and not _is_mapping(entry.get("debt")):
            issues.append(
                _issue(
                    "baseline.debt_missing",
                    BASELINE_RELATIVE_PATH,
                    f"Baseline edge {entry.get('from')} -> {entry.get('to')} has status "
                    f"{status!r} and therefore requires a debt owner, reason, and target phase.",
                )
            )
        pair = (str(entry.get("from")), str(entry.get("to")))
        if pair in seen_pairs:
            issues.append(
                _issue(
                    "baseline.duplicate_edge",
                    BASELINE_RELATIVE_PATH,
                    f"Baseline lists edge {pair[0]} -> {pair[1]} more than once.",
                )
            )
        seen_pairs.add(pair)
    return baseline, issues


def _load_config(repo_root: Path) -> tuple[Mapping[str, Any] | None, list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    config, config_issues = _load_json(repo_root / CONFIG_RELATIVE_PATH)
    issues.extend(config_issues)
    schema, schema_issues = _load_json(repo_root / CONFIG_SCHEMA_RELATIVE_PATH)
    issues.extend(schema_issues)
    if not _is_mapping(schema):
        issues.append(
            _issue(
                "observed_config.schema_not_object",
                CONFIG_SCHEMA_RELATIVE_PATH,
                "Config schema document must be a JSON object.",
            )
        )
    if not _is_mapping(config):
        issues.append(
            _issue(
                "observed_config.not_object",
                CONFIG_RELATIVE_PATH,
                "Config document must be a JSON object.",
            )
        )
        return None, issues
    if _is_mapping(schema):
        issues.extend(
            ValidationIssue(
                code=issue.code,
                path=f"{CONFIG_RELATIVE_PATH}:{issue.path}",
                message=issue.message,
                severity=issue.severity,
            )
            for issue in validate_schema_instance(config, schema)
        )
    if config.get("schema_version") != CONFIG_SCHEMA_VERSION:
        issues.append(
            _issue(
                "observed_config.schema_version",
                CONFIG_RELATIVE_PATH,
                f"Config schema_version must be {CONFIG_SCHEMA_VERSION!r}.",
            )
        )
    issues.extend(_validate_config_roots(repo_root, config))
    return config, issues


def _validate_config_roots(
    repo_root: Path, config: Mapping[str, Any]
) -> list[ValidationIssue]:
    """A renamed or mistyped scan root must fail, never silently scan nothing.

    Skipping a directory silently disables cycle and edge detection for a whole
    service while still reporting zero errors, so the gate has to police its own
    inputs rather than trusting that the config still matches the tree.
    """

    issues: list[ValidationIssue] = []
    entries = config.get("service_roots")
    if not _is_sequence(entries):
        return issues
    for entry in entries:
        if not _is_mapping(entry):
            continue
        service_id = str(entry.get("id"))
        roots = entry.get("roots")
        if _is_sequence(roots):
            for root_relative in roots:
                if not isinstance(root_relative, str):
                    continue
                if not (repo_root / root_relative).is_dir():
                    issues.append(
                        _issue(
                            "observed_config.root_missing",
                            CONFIG_RELATIVE_PATH,
                            f"Scan root {root_relative!r} for service {service_id!r} does not "
                            "exist. A missing root silently disables observation for that service.",
                        )
                    )
        # Emptying inbound_edge_ports removes a service from the port ownership map,
        # so every future call to it becomes invisible instead of being flagged as a
        # new undeclared edge. Only a service explicitly declared as a browser client
        # may have no inbound ports.
        ports = entry.get("inbound_edge_ports")
        if _is_sequence(ports) and not ports and not entry.get("browser_client"):
            issues.append(
                _issue(
                    "observed_config.no_inbound_ports",
                    CONFIG_RELATIVE_PATH,
                    f"Service {service_id!r} declares no inbound_edge_ports and is not marked "
                    "browser_client. Calls to it would become undetectable rather than flagged.",
                )
            )
    return issues


def compare_observed_to_baseline(
    report: ObservedReport,
    *,
    baseline: Mapping[str, Any],
    allowed_pairs: set[tuple[str, str]],
    declared_pairs: set[tuple[str, str]],
) -> list[ValidationIssue]:
    """Apply the ratchet: no undeclared new edge, no new or extra cycle."""

    issues: list[ValidationIssue] = []
    baseline_entries = [
        entry
        for entry in baseline.get("service_edges", [])
        if _is_mapping(entry) and "from" in entry and "to" in entry
    ]
    baseline_edges = {(str(entry["from"]), str(entry["to"])) for entry in baseline_entries}
    observed_pairs = {edge.pair for edge in report.edges}

    # A baseline entry short-circuits the contract check, so the baseline itself has
    # to be honest: an entry claiming "declared" must actually be declared by the
    # contract. Otherwise any forbidden edge could be waved through by mislabelling it.
    for entry in baseline_entries:
        pair = (str(entry["from"]), str(entry["to"]))
        if entry.get("status") != "declared":
            continue
        if pair not in allowed_pairs:
            issues.append(
                _issue(
                    "baseline.declared_not_allowed",
                    BASELINE_RELATIVE_PATH,
                    f"Baseline edge {pair[0]} -> {pair[1]} claims status 'declared' but is not "
                    "permitted by architecture-contract.json may_call. Mislabelled baseline "
                    "entries would bypass the contract check.",
                )
            )

    for edge in report.edges:
        if edge.pair in baseline_edges:
            continue
        first = edge.evidence[0] if edge.evidence else None
        location = f" (first evidence {first.file}:{first.line})" if first else ""
        if edge.pair not in allowed_pairs:
            issues.append(
                _issue(
                    "observed.edge.not_allowed",
                    BASELINE_RELATIVE_PATH,
                    f"New dependency edge {edge.source} -> {edge.target} is not permitted by "
                    f"architecture-contract.json may_call{location}.",
                )
            )
        elif edge.pair not in declared_pairs:
            issues.append(
                _issue(
                    "observed.edge.undeclared",
                    BASELINE_RELATIVE_PATH,
                    f"New dependency edge {edge.source} -> {edge.target} is allowed by the contract "
                    f"but is not declared in any architecture/deltas/*.json "
                    f"added_dependency_edges{location}.",
                )
            )

    for pair in sorted(baseline_edges - observed_pairs):
        issues.append(
            _issue(
                "observed.edge.baseline_stale",
                BASELINE_RELATIVE_PATH,
                f"Baseline records dependency edge {pair[0]} -> {pair[1]} but it is no longer "
                "observed. Tighten the baseline.",
                severity="warning",
            )
        )

    baseline_cycles = {
        (str(entry["scope"]), tuple(str(member) for member in entry.get("members", [])))
        for entry in baseline.get("cycles", [])
        if _is_mapping(entry) and "scope" in entry
    }
    observed_cycles = {cycle.signature for cycle in report.cycles}

    for signature in sorted(observed_cycles - baseline_cycles):
        issues.append(
            _issue(
                "observed.cycle.new",
                BASELINE_RELATIVE_PATH,
                f"New dependency cycle in scope {signature[0]}: {', '.join(signature[1])}. "
                "ARCH-GRAPH-001 forbids adding cycles.",
            )
        )
    for signature in sorted(baseline_cycles - observed_cycles):
        issues.append(
            _issue(
                "observed.cycle.baseline_stale",
                BASELINE_RELATIVE_PATH,
                f"Baseline records a cycle in scope {signature[0]} ({', '.join(signature[1])}) "
                "that is no longer observed. Tighten the baseline.",
                severity="warning",
            )
        )

    baseline_counts = {
        str(entry["scope"]): int(entry["maximum"])
        for entry in baseline.get("cycle_budgets", [])
        if _is_mapping(entry)
        and "scope" in entry
        and isinstance(entry.get("maximum"), int)
        and not isinstance(entry.get("maximum"), bool)
    }
    for scope, count in sorted(report.cycle_counts().items()):
        maximum = baseline_counts.get(scope)
        if maximum is None:
            if count:
                issues.append(
                    _issue(
                        "observed.cycle.budget_missing",
                        BASELINE_RELATIVE_PATH,
                        f"Scope {scope} has {count} cycle(s) but no approved cycle budget.",
                    )
                )
            continue
        if count > maximum:
            issues.append(
                _issue(
                    "observed.cycle.count_increase",
                    BASELINE_RELATIVE_PATH,
                    f"Scope {scope} now has {count} cycle(s), above the approved budget of {maximum}.",
                )
            )

    return issues


def check_observed_architecture(repo_root: str | Path) -> RatchetResult:
    """Extract the observed architecture and enforce the ratchet against the baseline."""

    root = Path(repo_root).resolve()
    issues: list[ValidationIssue] = []

    config, config_issues = _load_config(root)
    issues.extend(config_issues)
    if config is None or any(issue.severity == "error" for issue in config_issues):
        return RatchetResult(repo_root=str(root), report=None, issues=tuple(issues))

    contract, contract_issues = _load_json(root / CONTRACT_RELATIVE_PATH)
    issues.extend(contract_issues)
    if not _is_mapping(contract):
        issues.append(
            _issue(
                "contract.not_object",
                CONTRACT_RELATIVE_PATH,
                "Architecture contract must be a JSON object.",
            )
        )
        return RatchetResult(repo_root=str(root), report=None, issues=tuple(_dedupe(issues)))

    report = build_observed_report(root, config)
    issues.extend(report.read_failures)

    baseline, baseline_issues = _load_baseline(root)
    issues.extend(baseline_issues)
    if baseline is None or any(issue.severity == "error" for issue in baseline_issues):
        return RatchetResult(repo_root=str(root), report=report, issues=tuple(_dedupe(issues)))

    allowed_pairs = _contract_allowed_pairs(contract, config)
    declared_pairs, delta_issues = _delta_declared_pairs(root, config)
    issues.extend(delta_issues)
    issues.extend(
        compare_observed_to_baseline(
            report,
            baseline=baseline,
            allowed_pairs=allowed_pairs,
            declared_pairs=declared_pairs,
        )
    )
    return RatchetResult(
        repo_root=str(root), report=report, issues=tuple(_dedupe(issues)), compared=True
    )


def _dedupe(issues: Iterable[ValidationIssue]) -> list[ValidationIssue]:
    return sorted(
        set(issues), key=lambda item: (item.severity, item.path, item.code, item.message)
    )


def render_report_json(report: ObservedReport) -> str:
    """Serialise the report deterministically (sorted keys, LF, trailing newline)."""

    return json.dumps(report.to_dict(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
