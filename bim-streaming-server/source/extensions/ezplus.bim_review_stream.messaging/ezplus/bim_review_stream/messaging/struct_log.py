"""Cross-service structured log adapter (Python, streaming-server side).

Source of truth: docs/contracts/structured-log-schema.md
Schema artifact:  tests/contracts/structured-log/schema.json
Allow-list:       tests/contracts/structured-log/env-allowlist.json

Design constraints:
    * **No Kit / omniverse imports.** This module is pure Python and is
      importable in plain CPython (root .venv) so that contract tests can
      exercise the adapter without requiring the Kit harness. The Kit
      extension entry point may import it the same way.
    * **Coexists with carb.log_***. We do NOT replace ``carb.log_*``; the
      structured log baseline is an additive observability surface.
    * **Fail-soft.** Sink failures NEVER throw to callers; degraded records
      are written to ``logs/<service>/_recovery/`` and a ``[structLog sink
      failed]`` line is emitted to ``sys.stderr``.

Public API:
    create_logger(service, *, log_root=None, run_id=None, ...) -> StructLogger

The StructLogger exposes:
    debug / info / warn / error / fatal (raw)
    network / audit / lifecycle / anomaly / env_snapshot (semantic helpers)
    with_trace_id(trace_id) -> StructLogger (child sharing same sink)
    flush_and_close()
    records_written / records_dropped / last_failure / current_file properties
"""
from __future__ import annotations

import datetime as _dt
import io
import json
import os
import re
import secrets
import sys
import threading
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Set, Tuple

__all__ = [
    "StructLogger",
    "create_logger",
    "generate_run_id",
    "iso_utc_ms",
    "redact_env_value",
    "redact_data_before_write",
    "safe_dumps",
    "load_allowlist",
    "reset_allowlist_cache",
    "extract_stack_tail",
    "VALID_LEVELS",
    "VALID_EVENT_TYPES",
    "VALID_SERVICES",
    "LIFECYCLE_SUBJECT_KINDS",
    "NETWORK_PEERS",
    "NETWORK_PROTOCOLS",
    "ANOMALY_KINDS",
]

# ---------------------------------------------------------------------------
# Enumerations (mirror schema.json)
# ---------------------------------------------------------------------------

VALID_LEVELS: Tuple[str, ...] = ("debug", "info", "warn", "error", "fatal")
VALID_EVENT_TYPES: Tuple[str, ...] = (
    "logic_error",
    "operation_anomaly",
    "env_snapshot",
    "lifecycle",
    "audit",
    "network",
    "general",
)
VALID_SERVICES: Tuple[str, ...] = ("coordinator", "streaming-server", "viewer", "scripts")
LIFECYCLE_SUBJECT_KINDS: Tuple[str, ...] = (
    "review_session",
    "conversion_job",
    "kit_subprocess",
    "ifc_ready_job",
    "script_run",
    "outbox_delivery",
)
NETWORK_PEERS: Tuple[str, ...] = (
    "coordinator",
    "streaming-server",
    "external-edge",
    "external-cloud",
    "kit-subprocess",
    "viewer",
)
NETWORK_PROTOCOLS: Tuple[str, ...] = (
    "http",
    "websocket",
    "socket.io",
    "webrtc-signal",
    "datachannel",
)
ANOMALY_KINDS: Tuple[str, ...] = ("retry", "fallback", "timeout", "unexpected_state")

_SECRET_PATTERN_FALLBACK = re.compile(r"TOKEN|SECRET|KEY|PASSWORD|AUTH|CREDENTIAL", re.IGNORECASE)
_RUN_ID_PATTERN = re.compile(r"^run_\d{8}_\d{6}_[0-9a-f]{6}$")
MAX_REDACTION_DEPTH = 8

# ---------------------------------------------------------------------------
# Allow-list loading
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _AllowList:
    keys: frozenset
    secret_pattern: "re.Pattern[str]"
    source_path: Optional[Path]


_allowlist_cache: Optional[_AllowList] = None


def _default_allowlist_path() -> Path:
    here = Path(__file__).resolve()
    # bim-streaming-server/source/extensions/
    #   ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/struct_log.py
    # — climb 8 dirs to reach <repo-root>.
    candidate = (
        here.parent.parent.parent.parent.parent.parent.parent.parent
        / "tests"
        / "contracts"
        / "structured-log"
        / "env-allowlist.json"
    )
    return candidate


def load_allowlist(path: Optional[Path] = None) -> _AllowList:
    """Load the env allow-list and secret patterns from env-allowlist.json.

    Cached after first call. Use :func:`reset_allowlist_cache` to clear in
    tests.
    """
    global _allowlist_cache
    if _allowlist_cache is not None and (path is None or _allowlist_cache.source_path == path):
        return _allowlist_cache
    target = path or _default_allowlist_path()
    keys: frozenset = frozenset()
    pattern: "re.Pattern[str]" = _SECRET_PATTERN_FALLBACK
    if target.is_file():
        try:
            raw = json.loads(target.read_text(encoding="utf-8"))
            keys = frozenset(raw.get("allow_list", []))
            patterns = raw.get("secret_patterns")
            if patterns:
                pattern = re.compile("|".join(patterns), re.IGNORECASE)
        except Exception:
            pass
    _allowlist_cache = _AllowList(keys=keys, secret_pattern=pattern, source_path=target)
    return _allowlist_cache


def reset_allowlist_cache() -> None:
    """Test helper — force the next ``load_allowlist`` to re-read from disk."""
    global _allowlist_cache
    _allowlist_cache = None


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def generate_run_id(now: Optional[_dt.datetime] = None, random_hex: Optional[str] = None) -> str:
    """Return ``run_<YYYYMMDD>_<HHMMSS>_<6 lowercase hex>``.

    ``random_hex`` may be passed by tests for determinism.
    """
    now = now if now is not None else _dt.datetime.now(_dt.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=_dt.timezone.utc)
    else:
        now = now.astimezone(_dt.timezone.utc)
    hex_part = random_hex if random_hex is not None else secrets.token_hex(3)
    return f"run_{now:%Y%m%d}_{now:%H%M%S}_{hex_part}"


def iso_utc_ms(now: Optional[_dt.datetime] = None) -> str:
    """Return an ISO-8601 UTC timestamp with millisecond precision."""
    now = now if now is not None else _dt.datetime.now(_dt.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=_dt.timezone.utc)
    else:
        now = now.astimezone(_dt.timezone.utc)
    micro = now.microsecond
    ms = micro // 1000
    return f"{now:%Y-%m-%dT%H:%M:%S}.{ms:03d}Z"


def _date_dir_from_ts(ts: str) -> str:
    return ts[:10]


def _value_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, Mapping):
        return "object"
    return "string"


def redact_env_value(
    key: str,
    value: Any,
    allowlist: Optional[_AllowList] = None,
    source: str = "system",
) -> Dict[str, str]:
    """Apply the three-step env value redaction (schema §5.1)."""
    al = allowlist or load_allowlist()
    type_tag = _value_type(value)
    string_value = "" if value is None else str(value)
    if key in al.keys:
        return {
            "key": key,
            "source": source,
            "value_or_redacted": string_value,
            "type": type_tag,
        }
    if al.secret_pattern.search(key):
        return {
            "key": key,
            "source": source,
            "value_or_redacted": f"[REDACTED:type={type_tag}, len={len(string_value)}]",
            "type": type_tag,
        }
    return {
        "key": key,
        "source": source,
        "value_or_redacted": f"[TYPE:type={type_tag}, len={len(string_value)}]",
        "type": type_tag,
    }


def redact_data_before_write(
    data: Any,
    allowlist: Optional[_AllowList] = None,
    _active_path: Optional[Set[int]] = None,
    _depth: int = 0,
) -> Any:
    """Bounded, cycle-safe secret-key redaction for ordinary event data."""
    al = allowlist or load_allowlist()
    _active_path = set() if _active_path is None else _active_path
    if data is None or isinstance(data, (str, int, float, bool)):
        return data
    if _depth > MAX_REDACTION_DEPTH:
        return "[Truncated]"
    if isinstance(data, Mapping):
        ident = id(data)
        if ident in _active_path:
            return "[Circular]"
        _active_path.add(ident)
        try:
            out: Dict[str, Any] = {}
            for raw_key, value in data.items():
                key = str(raw_key)
                if al.secret_pattern.search(key) is not None:
                    out[key] = "[REDACTED]"
                else:
                    out[key] = redact_data_before_write(value, al, _active_path, _depth + 1)
            return out
        finally:
            _active_path.remove(ident)
    if isinstance(data, (list, tuple, set, frozenset)):
        ident = id(data)
        if ident in _active_path:
            return "[Circular]"
        _active_path.add(ident)
        try:
            return [redact_data_before_write(item, al, _active_path, _depth + 1) for item in data]
        finally:
            _active_path.remove(ident)
    return str(data)


def _sanitize_env_snapshot_vars(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    safe: List[Dict[str, Any]] = []
    for candidate in value:
        if not isinstance(candidate, Mapping):
            continue
        if not all(field in candidate for field in ("key", "source", "value_or_redacted", "type")):
            continue
        safe.append({
            "key": candidate["key"],
            "source": candidate["source"],
            "value_or_redacted": candidate["value_or_redacted"],
            "type": candidate["type"],
        })
    return safe


def _sanitize_record_data(
    event_type: str,
    data: Mapping[str, Any],
    allowlist: _AllowList,
) -> Dict[str, Any]:
    if event_type != "env_snapshot":
        return redact_data_before_write(data, allowlist)

    active_path = {id(data)}
    safe: Dict[str, Any] = {}
    for raw_key, value in data.items():
        key = str(raw_key)
        if key == "vars":
            safe["vars"] = _sanitize_env_snapshot_vars(value)
        elif allowlist.secret_pattern.search(key) is not None:
            safe[key] = "[REDACTED]"
        else:
            safe[key] = redact_data_before_write(value, allowlist, active_path, 1)
    return safe


def _safe_default(obj: Any) -> Any:
    if isinstance(obj, _dt.datetime):
        return iso_utc_ms(obj)
    if isinstance(obj, BaseException):
        return f"<exception:{type(obj).__name__}: {obj}>"
    if isinstance(obj, (bytes, bytearray)):
        try:
            return obj.decode("utf-8", errors="replace")
        except Exception:
            return repr(obj)
    return f"<unserializable:{type(obj).__name__}>"


def safe_dumps(record: Any) -> str:
    """``json.dumps`` with circular-reference protection and broad coercion."""
    try:
        return json.dumps(record, ensure_ascii=False, default=_safe_default)
    except (TypeError, ValueError):
        try:
            return json.dumps(_force_jsonable(record), ensure_ascii=False, default=_safe_default)
        except Exception as exc:  # pragma: no cover — final fallback
            return json.dumps({"_serialize_error": repr(exc)})


def _force_jsonable(value: Any, _seen: Optional[Set[int]] = None) -> Any:
    _seen = set() if _seen is None else _seen
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    ident = id(value)
    if ident in _seen:
        return "[Circular]"
    _seen.add(ident)
    if isinstance(value, Mapping):
        return {str(k): _force_jsonable(v, _seen) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_force_jsonable(item, _seen) for item in value]
    return _safe_default(value)


def extract_stack_tail(err: Optional[BaseException], maximum: int = 8) -> List[str]:
    """Return up to ``maximum`` lines of the traceback's tail."""
    if err is None:
        return []
    import traceback

    tb = err.__traceback__
    if tb is None:
        return []
    formatted = traceback.format_tb(tb)
    return [line.rstrip() for line in formatted[-maximum:]]


def _extract_caller_from_stack(stack_tail: Sequence[str], err: Optional[BaseException]) -> Optional[str]:
    """Return a ``file:line`` caller hint suitable for the schema's `caller`.

    Prefers the deepest stack frame from ``err.__traceback__``; falls back to
    parsing the first formatted stack entry.
    """
    if err is not None and err.__traceback__ is not None:
        import traceback

        frames = list(traceback.walk_tb(err.__traceback__))
        if frames:
            frame, lineno = frames[-1]
            filename = frame.f_code.co_filename
            return f"{filename}:{lineno}"
    if stack_tail:
        import re as _re

        match = _re.search(r'File\s+"([^"]+)",\s+line\s+(\d+)', stack_tail[0])
        if match:
            return f"{match.group(1)}:{match.group(2)}"
    return None


# ---------------------------------------------------------------------------
# StructLogger
# ---------------------------------------------------------------------------


@dataclass
class _LoggerRunState:
    service: str
    component: str
    run_id: str
    log_root: Path
    current_date: str
    current_file: Path
    records_written: int = 0
    records_dropped: int = 0
    last_failure: Optional[Dict[str, str]] = None
    ring_buffer: deque = field(default_factory=lambda: deque(maxlen=100))
    seq_by_trace: Dict[str, int] = field(default_factory=dict)
    closed: bool = False
    in_memory_only: bool = False
    record_sink: Optional[Callable[[Dict[str, Any]], None]] = None
    now_provider: Callable[[], _dt.datetime] = field(default=lambda: _dt.datetime.now(_dt.timezone.utc))
    lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass
class _LoggerState:
    trace_id: str
    run: _LoggerRunState


class StructLogger:
    """Cross-service structured log adapter — Python side.

    Use :func:`create_logger` to construct an instance. Children produced by
    :py:meth:`with_trace_id` share counters, last_failure, ring_buffer, and
    the per-trace seq map with the parent.
    """

    def __init__(self, state: _LoggerState, allowlist: _AllowList) -> None:
        self._state = state
        self._allowlist = allowlist

    # -- read-only views --------------------------------------------------

    @property
    def service(self) -> str:
        return self._state.run.service

    @property
    def run_id(self) -> str:
        return self._state.run.run_id

    @property
    def trace_id(self) -> str:
        return self._state.trace_id

    @property
    def current_file(self) -> Path:
        run = self._state.run
        with run.lock:
            return run.current_file

    @property
    def records_written(self) -> int:
        run = self._state.run
        with run.lock:
            return run.records_written

    @property
    def records_dropped(self) -> int:
        run = self._state.run
        with run.lock:
            return run.records_dropped

    @property
    def last_failure(self) -> Optional[Dict[str, str]]:
        run = self._state.run
        with run.lock:
            return run.last_failure

    # -- raw level helpers ------------------------------------------------

    def debug(self, component: str, msg: str, data: Optional[Mapping[str, Any]] = None) -> None:
        self._emit("debug", "general", component, msg, data)

    def info(self, component: str, msg: str, data: Optional[Mapping[str, Any]] = None) -> None:
        self._emit("info", "general", component, msg, data)

    def warn(self, component: str, msg: str, data: Optional[Mapping[str, Any]] = None) -> None:
        self._emit("warn", "general", component, msg, data)

    def error(
        self,
        component: str,
        msg: str,
        err: Optional[BaseException] = None,
        data: Optional[Mapping[str, Any]] = None,
    ) -> None:
        classified = self._classify_error(err)
        merged = dict(data or {})
        merged.setdefault("error", classified)
        caller = _extract_caller_from_stack(classified["stack_tail"], err)
        self._emit("error", "logic_error", component, msg, merged, caller=caller, error=classified)

    def fatal(
        self,
        component: str,
        msg: str,
        err: Optional[BaseException] = None,
        data: Optional[Mapping[str, Any]] = None,
    ) -> None:
        classified = self._classify_error(err)
        merged = dict(data or {})
        merged.setdefault("error", classified)
        caller = _extract_caller_from_stack(classified["stack_tail"], err)
        self._emit("fatal", "logic_error", component, msg, merged, caller=caller, error=classified)

    # -- semantic helpers -------------------------------------------------

    def network(
        self,
        component: str,
        msg: str,
        data: Mapping[str, Any],
        level: str = "info",
    ) -> None:
        self._emit(level, "network", component, msg, data)

    def audit(
        self,
        component: str,
        msg: str,
        data: Mapping[str, Any],
        level: str = "info",
    ) -> None:
        self._emit(level, "audit", component, msg, data)

    def lifecycle(
        self,
        component: str,
        msg: str,
        data: Mapping[str, Any],
        level: str = "info",
    ) -> None:
        self._emit(level, "lifecycle", component, msg, data)

    def anomaly(
        self,
        component: str,
        msg: str,
        data: Mapping[str, Any],
        level: str = "warn",
    ) -> None:
        self._emit(level, "operation_anomaly", component, msg, data)

    def env_snapshot(self, component: str, vars: Sequence[Mapping[str, Any]]) -> None:
        """Emit an env_snapshot record. ``vars`` is the redacted list."""
        sanitised = [dict(v) for v in vars]
        self._emit("info", "env_snapshot", component, "env snapshot", {"vars": sanitised})

    # -- child / lifecycle ------------------------------------------------

    def with_trace_id(self, trace_id: str) -> "StructLogger":
        """Return a child logger sharing sink/counters but with new trace_id."""
        child_state = _LoggerState(
            trace_id=trace_id,
            run=self._state.run,
        )
        return StructLogger(state=child_state, allowlist=self._allowlist)

    def flush_and_close(self) -> None:
        run = self._state.run
        with run.lock:
            run.closed = True

    # -- internal --------------------------------------------------------

    def _emit(
        self,
        level: str,
        event_type: str,
        component: str,
        msg: str,
        data: Optional[Mapping[str, Any]],
        *,
        caller: Optional[str] = None,
        error: Optional[Dict[str, Any]] = None,
    ) -> None:
        if level not in VALID_LEVELS:
            # Refuse to write nonsense; recorded as anomaly instead.
            self._emit(
                "warn",
                "operation_anomaly",
                component,
                "struct_log invalid level rejected",
                {"anomaly_kind": "unexpected_state", "reason": f"invalid level {level!r}"},
            )
            return
        run = self._state.run
        try:
            now = run.now_provider()
        except Exception:
            now = _dt.datetime.now(_dt.timezone.utc)
        ts = iso_utc_ms(now)
        trace_id = self._state.trace_id or f"script_{run.run_id}"
        with run.lock:
            seq = run.seq_by_trace.get(trace_id, 0) + 1
            run.seq_by_trace[trace_id] = seq
        try:
            safe_data = _sanitize_record_data(event_type, dict(data or {}), self._allowlist)
        except Exception:
            safe_data = {"redaction_failure": "[Truncated]"}
        record: Dict[str, Any] = {
            "ts": ts,
            "level": level,
            "event_type": event_type,
            "service": run.service,
            "component": component,
            "run_id": run.run_id,
            "trace_id": trace_id,
            "msg": msg,
            "data": safe_data,
            "seq": seq,
        }
        if caller:
            record["caller"] = caller
        if error:
            record["error"] = error
        self._write_record(record)

    def _write_record(self, record: Dict[str, Any]) -> None:
        state = self._state.run
        line = safe_dumps(record) + "\n"
        sink_failure_reason: str | None = None
        with state.lock:
            if state.closed:
                return
            record_sink = state.record_sink
            # Daily rotation, sink selection, file I/O and scalar counters share
            # one run-level critical section. External sinks/stdout stay outside
            # the lock so a blocking or re-entrant sink cannot deadlock peers.
            date_dir = _date_dir_from_ts(record["ts"])
            if date_dir != state.current_date:
                state.current_date = date_dir
                state.current_file = _file_path_for(state, date_dir)
                if not state.in_memory_only:
                    _ensure_dir(state.current_file.parent)
            if state.in_memory_only:
                state.records_written += 1
            else:
                try:
                    _ensure_dir(state.current_file.parent)
                    with state.current_file.open("a", encoding="utf-8") as fh:
                        fh.write(line)
                    state.records_written += 1
                except Exception as exc:
                    reason = f"{type(exc).__name__}: {exc}"
                    try:
                        recovery_dir = state.log_root / state.service / "_recovery"
                        _ensure_dir(recovery_dir)
                        recovery_file = recovery_dir / f"{state.current_date}-{state.run_id}.jsonl"
                        with recovery_file.open("a", encoding="utf-8") as fh:
                            fh.write(line)
                        state.records_written += 1
                        state.last_failure = {
                            "ts": iso_utc_ms(state.now_provider()),
                            "reason": f"{reason} (recovered)",
                        }
                    except Exception:
                        state.records_dropped += 1
                        state.last_failure = {
                            "ts": iso_utc_ms(state.now_provider()),
                            "reason": reason,
                        }
                        state.ring_buffer.append(record)
                        sink_failure_reason = reason
        if record_sink is not None:
            try:
                record_sink(record)
            except Exception:
                pass
        # stdout — best-effort
        try:
            sys.stdout.write(line)
            sys.stdout.flush()
        except Exception:
            pass
        if sink_failure_reason is not None:
            try:
                sys.stderr.write(f"[structLog sink failed: {sink_failure_reason}] {line}")
            except Exception:
                pass

    @staticmethod
    def _classify_error(err: Optional[BaseException]) -> Dict[str, Any]:
        if err is None:
            return {"name": "NoError", "message": "", "stack_tail": []}
        if isinstance(err, BaseException):
            return {
                "name": type(err).__name__,
                "message": str(err),
                "stack_tail": extract_stack_tail(err),
            }
        return {"name": "NonErrorThrown", "message": str(err), "stack_tail": []}


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _file_path_for(state: _LoggerRunState, date_dir: str) -> Path:
    return state.log_root / state.service / date_dir / f"{state.service}-{state.run_id}.jsonl"


def _ensure_dir(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        return True
    except Exception:
        return False


def _default_log_root() -> Path:
    env_root = os.environ.get("LOG_ROOT")
    if env_root:
        return Path(env_root)
    return Path.cwd() / "logs"


def _initial_trace_id(run_id: str) -> str:
    env_trace = os.environ.get("BIM_TRACE_ID")
    if env_trace:
        return env_trace
    return f"script_{run_id}"


def _collect_env_snapshot(allowlist: _AllowList) -> List[Dict[str, str]]:
    return [
        redact_env_value(key, os.environ[key], allowlist=allowlist, source="system")
        for key in sorted(os.environ.keys())
    ]


def create_logger(
    service: str,
    *,
    component: str = "bootstrap",
    log_root: Optional[os.PathLike] = None,
    run_id: Optional[str] = None,
    initial_trace_id: Optional[str] = None,
    now: Optional[Callable[[], _dt.datetime]] = None,
    skip_env_snapshot: bool = False,
    in_memory_only: bool = False,
    record_sink: Optional[Callable[[Dict[str, Any]], None]] = None,
    allowlist_path: Optional[os.PathLike] = None,
) -> StructLogger:
    """Construct a :class:`StructLogger`.

    Tests should pass ``log_root`` to a tmp directory and may pass
    ``skip_env_snapshot=True`` to bypass the startup env dump.
    """
    if service not in VALID_SERVICES:
        raise ValueError(f"Unknown service {service!r}; must be one of {VALID_SERVICES}")
    now_fn = now or (lambda: _dt.datetime.now(_dt.timezone.utc))
    try:
        initial_now = now_fn()
    except Exception:
        initial_now = _dt.datetime.now(_dt.timezone.utc)
    if run_id is None:
        run_id = generate_run_id(initial_now)
    elif not _RUN_ID_PATTERN.match(run_id):
        raise ValueError(f"Invalid run_id {run_id!r} — must match {_RUN_ID_PATTERN.pattern}")
    log_root_path = Path(log_root) if log_root is not None else _default_log_root()
    allowlist = load_allowlist(Path(allowlist_path) if allowlist_path is not None else None)
    trace_id = initial_trace_id or _initial_trace_id(run_id)
    date_dir = _date_dir_from_ts(iso_utc_ms(initial_now))
    run_state = _LoggerRunState(
        service=service,
        component=component,
        run_id=run_id,
        log_root=log_root_path,
        current_date=date_dir,
        current_file=log_root_path / service / date_dir / f"{service}-{run_id}.jsonl",
        in_memory_only=in_memory_only,
        record_sink=record_sink,
        now_provider=now_fn,
    )
    state = _LoggerState(trace_id=trace_id, run=run_state)
    if not in_memory_only:
        _ensure_dir(run_state.current_file.parent)
    logger = StructLogger(state=state, allowlist=allowlist)
    if not skip_env_snapshot:
        logger.env_snapshot(component, _collect_env_snapshot(allowlist))
    return logger
