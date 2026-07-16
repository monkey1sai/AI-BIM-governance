#!/usr/bin/env python3
"""Trusted-controller runner for an ephemeral, detached PR validation worktree.

The file and its profile allowlist are meant to be executed from protected main.
The candidate commit is data: it is checked out only into a detached worktree.
"""

from __future__ import annotations

import argparse
import errno
import fnmatch
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

if os.name == "nt":
    import msvcrt
else:
    import fcntl


EXIT_CONTRACT = 20
EXIT_SCOPE = 21
EXIT_UNSAFE_PATH = 22
EXIT_VALIDATION = 30
EXIT_TIMEOUT = 31
EXIT_WORKTREE = 40
EXIT_CLEANUP = 41
EXIT_INTERNAL = 50

IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
PROFILE_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
SHA_RE = re.compile(r"^[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$")
FETCH_REF_RE = re.compile(r"^refs/(?:pull/[1-9][0-9]*/merge|heads/[A-Za-z0-9._/-]+)$")
SECRET_NAME_RE = re.compile(r"TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY", re.I)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sanitize_text(value: str) -> str:
    value = re.sub(r"(?i)(https?://)[^/@\s]+:[^/@\s]+@", r"\1[REDACTED]@", value)
    value = re.sub(r"(?i)(token|secret|password|api[_-]?key)\s*[=:]\s*\S+", r"\1=[REDACTED]", value)
    return value


class LifecycleError(RuntimeError):
    def __init__(self, message: str, *, code: int, status: str, error_code: str):
        super().__init__(message)
        self.code = code
        self.status = status
        self.error_code = error_code


class EventLog:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def write(self, event: str, **data: object) -> None:
        record = {"timestamp": iso_now(), "event": event, **data}
        encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        with self._lock, self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(encoded + "\n")
            handle.flush()


class FileMutex:
    """Cross-process OS file lock used for coordination and lease ownership."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle: Any | None = None
        self.acquired = False

    def _open(self) -> None:
        if self.handle is not None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.handle = self.path.open("a+b")
            if os.fstat(self.handle.fileno()).st_size == 0:
                self.handle.write(b"\0")
                self.handle.flush()
        except OSError as exc:
            if self.handle is not None:
                self.handle.close()
                self.handle = None
            raise LifecycleError(
                f"could not open file lock {self.path.name}: {exc}",
                code=EXIT_CONTRACT,
                status="lease_failed",
                error_code="FILE_LOCK_OPEN_FAILED",
            ) from exc

    @staticmethod
    def _is_contention(exc: OSError) -> bool:
        return exc.errno in {errno.EACCES, errno.EAGAIN} or getattr(exc, "winerror", None) in {33, 36}

    def try_acquire(self) -> bool:
        if self.acquired:
            raise LifecycleError(
                f"file lock {self.path.name} is already held by this object",
                code=EXIT_CONTRACT,
                status="lease_failed",
                error_code="FILE_LOCK_DOUBLE_ACQUIRE",
            )
        self._open()
        assert self.handle is not None
        try:
            self.handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if self._is_contention(exc):
                return False
            self.handle.close()
            self.handle = None
            raise LifecycleError(
                f"file lock {self.path.name} failed: {exc}",
                code=EXIT_CONTRACT,
                status="lease_failed",
                error_code="FILE_LOCK_FAILED",
            ) from exc

        try:
            handle_stat = os.fstat(self.handle.fileno())
            path_stat = self.path.stat()
            if (handle_stat.st_dev, handle_stat.st_ino) != (path_stat.st_dev, path_stat.st_ino):
                raise OSError("lock path was replaced while acquiring it")
        except OSError as exc:
            try:
                if os.name == "nt":
                    self.handle.seek(0)
                    msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            finally:
                self.handle.close()
                self.handle = None
            raise LifecycleError(
                f"file lock {self.path.name} lost path identity: {exc}",
                code=EXIT_CONTRACT,
                status="lease_failed",
                error_code="FILE_LOCK_REPLACED",
            ) from exc

        self.acquired = True
        return True

    def acquire(self, timeout_seconds: float = 10.0) -> "FileMutex":
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        while True:
            if self.try_acquire():
                return self
            if time.monotonic() >= deadline:
                break
            time.sleep(min(0.02, max(0.0, deadline - time.monotonic())))
        self.release()
        raise LifecycleError(
            f"timed out acquiring file lock {self.path.name}",
            code=EXIT_CONTRACT,
            status="lease_timeout",
            error_code="FILE_LOCK_TIMEOUT",
        )

    def release(self) -> None:
        if self.handle is None:
            return
        release_error: OSError | None = None
        try:
            if self.acquired:
                self.handle.seek(0)
                try:
                    if os.name == "nt":
                        msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
                except OSError as exc:
                    release_error = exc
        finally:
            self.handle.close()
            self.handle = None
            self.acquired = False
        if release_error is not None:
            raise LifecycleError(
                f"could not release file lock {self.path.name}: {release_error}",
                code=EXIT_CLEANUP,
                status="cleanup_failed",
                error_code="FILE_LOCK_RELEASE_FAILED",
            ) from release_error

    def __enter__(self) -> "FileMutex":
        return self.acquire()

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.release()


def _absolute_host_search_path() -> str:
    """Return PATH entries that cannot resolve through the candidate cwd."""

    entries: list[str] = []
    for raw in os.environ.get("PATH", "").split(os.pathsep):
        raw = os.path.expandvars(raw.strip().strip('"'))
        if not raw:
            continue
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            continue
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if resolved.is_dir():
            entries.append(str(resolved))
    return os.pathsep.join(entries)


@lru_cache(maxsize=None)
def trusted_host_tool(name: str, *, required: bool = True) -> str:
    """Resolve a host tool only through absolute PATH directories."""

    extensions = [""]
    if os.name == "nt" and not Path(name).suffix:
        extensions = [
            extension.lower()
            for extension in os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(os.pathsep)
            if extension
        ]
    for directory in _absolute_host_search_path().split(os.pathsep):
        if not directory:
            continue
        for extension in extensions:
            candidate = Path(directory) / f"{name}{extension}"
            try:
                resolved = candidate.resolve(strict=True)
            except OSError:
                continue
            if resolved.is_absolute() and resolved.is_file() and (os.name == "nt" or os.access(resolved, os.X_OK)):
                return str(resolved)
    if required:
        raise LifecycleError(
            f"trusted host tool could not be resolved: {name}",
            code=EXIT_CONTRACT,
            status="blocked",
            error_code="HOST_TOOL_NOT_FOUND",
        )
    return ""


def run_git(
    repo: Path,
    arguments: list[str],
    *,
    timeout: int = 120,
    read_only: bool = False,
) -> str:
    command = [trusted_host_tool("git")]
    if read_only:
        command.append("--no-optional-locks")
    command.extend(["-c", f"safe.directory={repo}", "-C", str(repo), *arguments])
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LifecycleError(
            f"git command could not complete: {exc}",
            code=EXIT_WORKTREE,
            status="worktree_failed",
            error_code="GIT_EXECUTION_FAILED",
        ) from exc
    if completed.returncode != 0:
        detail = sanitize_text((completed.stderr or completed.stdout).strip())
        raise LifecycleError(
            f"git {' '.join(arguments[:2])} failed: {detail}",
            code=EXIT_WORKTREE,
            status="worktree_failed",
            error_code="GIT_COMMAND_FAILED",
        )
    return completed.stdout.strip()


@dataclass
class LeaseSpec:
    group: str
    capacity: int
    wait_timeout_seconds: int


class Lease:
    def __init__(
        self,
        *,
        root: Path,
        spec: LeaseSpec,
        invocation_id: str,
        workspace: Path,
        events: EventLog,
    ) -> None:
        self.root = root / ".leases" / spec.group
        self.spec = spec
        self.invocation_id = invocation_id
        self.workspace = workspace
        self.events = events
        self.token = uuid.uuid4().hex
        self.slot_index: int | None = None
        self.owner_path: Path | None = None
        self.slot_mutex: FileMutex | None = None
        self.wait_ms = 0

    def _owner(self) -> dict[str, object]:
        return {
            "schema_version": "ai-bim-host-lease/v2",
            "token": self.token,
            "group": self.spec.group,
            "invocation_id": self.invocation_id,
            "pid": os.getpid(),
            "workspace": str(self.workspace),
            "acquired_at": iso_now(),
        }

    def acquire(self) -> "Lease":
        if self.slot_mutex is not None:
            raise LifecycleError(
                f"host lease {self.spec.group} is already held by this object",
                code=EXIT_CONTRACT,
                status="lease_failed",
                error_code="LEASE_DOUBLE_ACQUIRE",
            )
        started = time.monotonic()
        deadline = started + self.spec.wait_timeout_seconds
        self.root.mkdir(parents=True, exist_ok=True)
        while time.monotonic() < deadline:
            for index in range(self.spec.capacity):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                mutex = FileMutex(self.root / f"slot-{index}.lock")
                try:
                    acquired = mutex.try_acquire()
                except LifecycleError:
                    mutex.release()
                    raise
                if not acquired:
                    mutex.release()
                    continue

                owner_path = self.root / f"slot-{index}.owner.json"
                stale_owner = owner_path.exists()
                try:
                    for stale_temporary in self.root.glob(f".slot-{index}.owner.json.*.tmp"):
                        stale_temporary.unlink()
                    atomic_write_json(owner_path, self._owner())
                    wait_ms = round((time.monotonic() - started) * 1000)
                    if stale_owner:
                        # The exclusive OS lock proves that no live holder owns
                        # this slot. Metadata may survive a killed process, but
                        # the kernel has already recovered the capacity.
                        self.events.write("stale_lease_reaped", group=self.spec.group, slot=index)
                    self.events.write(
                        "lease_acquired",
                        group=self.spec.group,
                        slot=index,
                        wait_ms=wait_ms,
                    )
                except BaseException as exc:
                    try:
                        if owner_path.exists():
                            current = json.loads(owner_path.read_text(encoding="utf-8"))
                            if current.get("token") == self.token:
                                owner_path.unlink()
                    except (OSError, ValueError, json.JSONDecodeError):
                        pass
                    mutex.release()
                    if isinstance(exc, LifecycleError):
                        raise
                    if not isinstance(exc, Exception):
                        raise
                    raise LifecycleError(
                        f"could not initialize host lease {self.spec.group}: {exc}",
                        code=EXIT_CONTRACT,
                        status="lease_failed",
                        error_code="LEASE_INITIALIZATION_FAILED",
                    ) from exc

                self.slot_index = index
                self.owner_path = owner_path
                self.slot_mutex = mutex
                self.wait_ms = wait_ms
                return self
            time.sleep(0.05)
        raise LifecycleError(
            f"timed out waiting for host lease {self.spec.group}",
            code=EXIT_CONTRACT,
            status="lease_timeout",
            error_code="LEASE_TIMEOUT",
        )

    def release(self) -> None:
        if self.slot_mutex is None:
            return
        release_error: Exception | None = None
        try:
            if self.owner_path is None:
                raise LifecycleError(
                    f"host lease owner path missing for {self.spec.group}",
                    code=EXIT_CLEANUP,
                    status="cleanup_failed",
                    error_code="LEASE_OWNER_MISSING",
                )
            owner = json.loads(self.owner_path.read_text(encoding="utf-8"))
            if owner.get("token") != self.token:
                raise LifecycleError(
                    f"host lease owner changed for {self.spec.group}",
                    code=EXIT_CLEANUP,
                    status="cleanup_failed",
                    error_code="LEASE_OWNER_CHANGED",
                )
            self.owner_path.unlink()
            self.events.write("lease_released", group=self.spec.group)
        except FileNotFoundError as exc:
            release_error = LifecycleError(
                f"host lease owner metadata missing for {self.spec.group}",
                code=EXIT_CLEANUP,
                status="cleanup_failed",
                error_code="LEASE_OWNER_MISSING",
            )
            release_error.__cause__ = exc
        except (AttributeError, TypeError, ValueError, json.JSONDecodeError) as exc:
            release_error = LifecycleError(
                f"host lease owner metadata invalid for {self.spec.group}",
                code=EXIT_CLEANUP,
                status="cleanup_failed",
                error_code="LEASE_OWNER_INVALID",
            )
            release_error.__cause__ = exc
        except Exception as exc:
            release_error = exc
        finally:
            try:
                self.slot_mutex.release()
            except Exception as exc:
                if release_error is None:
                    release_error = exc
            self.slot_index = None
            self.owner_path = None
            self.slot_mutex = None
        if release_error is not None:
            raise release_error


def lease_spec(raw: dict[str, Any]) -> LeaseSpec:
    try:
        group = str(raw["group"])
        capacity = int(raw["capacity"])
        wait = int(raw.get("wait_timeout_seconds", 60))
    except (KeyError, TypeError, ValueError) as exc:
        raise LifecycleError(
            f"invalid lease specification: {raw}",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_LEASE_SPEC",
        ) from exc
    if not PROFILE_RE.fullmatch(group) or not 1 <= capacity <= 32 or wait < 1:
        raise LifecycleError(
            f"unsafe lease specification: {raw}",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_LEASE_SPEC",
        )
    return LeaseSpec(group, capacity, wait)


def normalized(path: Path) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def is_within(candidate: Path, parent: Path) -> bool:
    candidate_value = normalized(candidate)
    parent_value = normalized(parent)
    try:
        return os.path.commonpath([candidate_value, parent_value]) == parent_value
    except ValueError:
        return False


def paths_overlap(first: Path, second: Path) -> bool:
    return is_within(first, second) or is_within(second, first)


def validate_repository_separation(controller: Path, candidate_git_repo: Path) -> None:
    if paths_overlap(controller, candidate_git_repo):
        raise LifecycleError(
            "candidate Git metadata and trusted controller must not contain one another",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="CANDIDATE_GIT_REPO_NOT_SEPARATE",
        )


def validate_workspace_root(controller: Path, workspace_root: Path, protected: Iterable[str]) -> None:
    if paths_overlap(workspace_root, controller):
        raise LifecycleError(
            "workspace root must be a sibling outside the controller checkout",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="WORKSPACE_INSIDE_CONTROLLER",
        )
    lowered_parts = {part.lower() for part in workspace_root.parts}
    if {".claude", ".codex", ".worktrees"} & lowered_parts:
        raise LifecycleError(
            "workspace root cannot use an agent cache or repo-local worktree directory",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="FORBIDDEN_WORKSPACE_ROOT",
        )
    for raw in protected:
        if os.name != "nt" and re.match(r"^[A-Za-z]:[\\/]", raw):
            continue
        protected_path = Path(raw).expanduser().resolve(strict=False)
        if paths_overlap(workspace_root, protected_path):
            raise LifecycleError(
                f"workspace root intersects protected deployment path: {protected_path}",
                code=EXIT_UNSAFE_PATH,
                status="unsafe_path",
                error_code="PROTECTED_PATH",
            )


def validate_evidence_root(
    controller: Path,
    candidate_git_repo: Path,
    workspace_root: Path,
    evidence_root: Path,
    protected: Iterable[str],
) -> None:
    peers = [controller, candidate_git_repo, workspace_root]
    for raw in protected:
        if os.name != "nt" and re.match(r"^[A-Za-z]:[\\/]", raw):
            continue
        peers.append(Path(raw).expanduser().resolve(strict=False))
    if any(paths_overlap(evidence_root, peer) for peer in peers):
        raise LifecycleError(
            "evidence root must be a dedicated sibling outside trusted, candidate, workspace, and deployment roots",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="EVIDENCE_ROOT_NOT_ISOLATED",
        )


def require_local_ntfs(path: Path, *, label: str) -> None:
    """Require Windows roots used for coordination to be fixed NTFS volumes."""

    if os.name != "nt":
        return

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetVolumePathNameW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
    kernel32.GetVolumePathNameW.restype = wintypes.BOOL
    kernel32.GetVolumeInformationW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.LPWSTR,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD),
        wintypes.LPWSTR,
        wintypes.DWORD,
    ]
    kernel32.GetVolumeInformationW.restype = wintypes.BOOL
    kernel32.GetDriveTypeW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetDriveTypeW.restype = wintypes.UINT
    volume_path = ctypes.create_unicode_buffer(261)
    if not kernel32.GetVolumePathNameW(str(path), volume_path, len(volume_path)):
        raise LifecycleError(
            f"could not resolve the host volume for {label}: winerror={ctypes.get_last_error()}",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="HOST_VOLUME_UNVERIFIABLE",
        )

    filesystem_name = ctypes.create_unicode_buffer(261)
    serial = wintypes.DWORD()
    maximum_component = wintypes.DWORD()
    flags = wintypes.DWORD()
    if not kernel32.GetVolumeInformationW(
        volume_path.value,
        None,
        0,
        ctypes.byref(serial),
        ctypes.byref(maximum_component),
        ctypes.byref(flags),
        filesystem_name,
        len(filesystem_name),
    ):
        raise LifecycleError(
            f"could not inspect the host volume for {label}: winerror={ctypes.get_last_error()}",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="HOST_VOLUME_UNVERIFIABLE",
        )

    drive_fixed = 3
    drive_type = int(kernel32.GetDriveTypeW(volume_path.value))
    if drive_type != drive_fixed or filesystem_name.value.upper() != "NTFS":
        raise LifecycleError(
            f"{label} must be on a fixed local NTFS volume",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="UNSAFE_HOST_VOLUME",
        )


WRITE_DENIED_ERRNOS = {errno.EACCES, errno.EPERM, errno.EROFS}


def require_file_not_writable(
    path: Path,
    *,
    label: str,
    writable_error: str,
    unverifiable_error: str,
) -> None:
    if path.is_symlink() or not path.is_file():
        raise LifecycleError(
            f"{label} must be an existing non-symlink file",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code=unverifiable_error,
        )
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_APPEND)
    except OSError as exc:
        if exc.errno in WRITE_DENIED_ERRNOS:
            return
        raise LifecycleError(
            f"could not verify {label} ACL: {exc}",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code=unverifiable_error,
        ) from exc
    else:
        os.close(descriptor)
        raise LifecycleError(
            f"{label} is writable by the validation identity",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code=writable_error,
        )


def require_directory_not_writable(
    path: Path,
    *,
    label: str,
    writable_error: str,
    unverifiable_error: str,
) -> None:
    if path.is_symlink() or not path.is_dir():
        raise LifecycleError(
            f"{label} must be an existing non-symlink directory",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code=unverifiable_error,
        )
    probe = path / f".ai-bim-write-probe-{uuid.uuid4().hex}"
    try:
        descriptor = os.open(probe, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except OSError as exc:
        if exc.errno in WRITE_DENIED_ERRNOS:
            return
        raise LifecycleError(
            f"could not verify {label} directory ACL: {exc}",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code=unverifiable_error,
        ) from exc
    else:
        os.close(descriptor)
        probe.unlink(missing_ok=True)
        raise LifecycleError(
            f"{label} directory is writable by the validation identity",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code=writable_error,
        )


def require_read_only_controller(controller: Path, trusted_files: Iterable[Path]) -> None:
    """Fail unless the validation identity cannot write the trusted surface.

    Production provisioning must own this snapshot with a different identity
    and deny this runner WRITE_DATA/APPEND_DATA/DELETE/WRITE_DAC. These direct
    probes verify effective data/directory writes; ownership/ACL policy remains
    a host provisioning responsibility.
    """

    require_directory_not_writable(
        controller.parent,
        label="trusted controller snapshot parent",
        writable_error="WRITABLE_TRUSTED_CONTROLLER",
        unverifiable_error="CONTROLLER_ACL_UNVERIFIABLE",
    )
    files = tuple(trusted_files)
    trusted_directories = {controller}
    for path in files:
        parent = path.parent
        while is_within(parent, controller):
            trusted_directories.add(parent)
            if parent == controller:
                break
            parent = parent.parent
    for directory in sorted(trusted_directories, key=lambda item: len(item.parts)):
        require_directory_not_writable(
            directory,
            label=f"trusted controller directory {directory.relative_to(controller) or '.'}",
            writable_error="WRITABLE_TRUSTED_CONTROLLER",
            unverifiable_error="CONTROLLER_ACL_UNVERIFIABLE",
        )
    for path in files:
        require_file_not_writable(
            path,
            label=f"trusted controller file {path.name}",
            writable_error="WRITABLE_TRUSTED_CONTROLLER",
            unverifiable_error="CONTROLLER_ACL_UNVERIFIABLE",
        )


def _is_replaceable_link(path: Path) -> bool:
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction and is_junction())


def snapshot_sealed_tree(root: Path, *, label: str, max_entries: int = 10_000) -> dict[str, str]:
    """Attest every entry in a dedicated, validation-read-only bundle."""

    if _is_replaceable_link(root) or not root.is_dir():
        raise LifecycleError(
            f"{label} must be an existing non-link directory",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="SEALED_BUNDLE_UNVERIFIABLE",
        )
    snapshot: dict[str, str] = {}
    entry_count = 0
    for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
        directory_names.sort()
        file_names.sort()
        current_path = Path(current)
        require_directory_not_writable(
            current_path,
            label=f"{label} directory",
            writable_error="WRITABLE_SEALED_BUNDLE",
            unverifiable_error="SEALED_BUNDLE_UNVERIFIABLE",
        )
        for name in directory_names:
            child = current_path / name
            entry_count += 1
            if entry_count > max_entries or _is_replaceable_link(child) or not child.is_dir():
                raise LifecycleError(
                    f"{label} contains an unsafe or excessive directory entry: {child}",
                    code=EXIT_UNSAFE_PATH,
                    status="unsafe_path",
                    error_code="SEALED_BUNDLE_UNVERIFIABLE",
                )
        for name in file_names:
            child = current_path / name
            entry_count += 1
            if entry_count > max_entries or _is_replaceable_link(child) or not child.is_file():
                raise LifecycleError(
                    f"{label} contains an unsafe or excessive file entry: {child}",
                    code=EXIT_UNSAFE_PATH,
                    status="unsafe_path",
                    error_code="SEALED_BUNDLE_UNVERIFIABLE",
                )
            require_file_not_writable(
                child,
                label=f"{label} file",
                writable_error="WRITABLE_SEALED_BUNDLE",
                unverifiable_error="SEALED_BUNDLE_UNVERIFIABLE",
            )
            snapshot[child.relative_to(root).as_posix()] = sha256_file(child)
    if not snapshot:
        raise LifecycleError(
            f"{label} contains no attested files",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="SEALED_BUNDLE_UNVERIFIABLE",
        )
    return snapshot


def sealed_tree_digest(snapshot: dict[str, str]) -> str:
    encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def validate_inputs(args: argparse.Namespace) -> None:
    if args.pr_number < 1 or args.attempt < 1:
        raise LifecycleError(
            "PR number and attempt must be positive",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_IDENTITY",
        )
    for label, value in (("run ID", args.run_id), ("invocation ID", args.invocation_id)):
        if not IDENTIFIER_RE.fullmatch(value):
            raise LifecycleError(
                f"invalid {label}",
                code=EXIT_CONTRACT,
                status="contract_failed",
                error_code="INVALID_IDENTITY",
            )
    for label, value in (("base SHA", args.base_sha), ("candidate SHA", args.candidate_sha)):
        if not SHA_RE.fullmatch(value):
            raise LifecycleError(
                f"{label} must be a full commit SHA",
                code=EXIT_CONTRACT,
                status="contract_failed",
                error_code="INVALID_SHA",
            )
    if args.profile and not PROFILE_RE.fullmatch(args.profile):
        raise LifecycleError(
            "invalid profile name",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_PROFILE",
        )
    if args.fetch_ref and not FETCH_REF_RE.fullmatch(args.fetch_ref):
        raise LifecycleError(
            "fetch ref is not an allowed PR merge or branch ref",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_FETCH_REF",
        )


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LifecycleError(
            f"could not read {label}: {exc}",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_JSON",
        ) from exc
    if not isinstance(payload, dict):
        raise LifecycleError(
            f"{label} must be a JSON object",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_JSON",
        )
    return payload


def verify_task_contract(
    contract: dict[str, Any], args: argparse.Namespace, profile: str
) -> list[str]:
    expected = {
        "schema_version": "ai-bim-task-contract/v1",
        "pr_number": args.pr_number,
        "base_sha": args.base_sha.lower(),
        "candidate_sha": args.candidate_sha.lower(),
        "local_validation_profile": profile,
    }
    for field, value in expected.items():
        actual = contract.get(field)
        if isinstance(value, str) and field.endswith("sha"):
            actual = str(actual).lower()
        if actual != value:
            raise LifecycleError(
                f"task contract mismatch for {field}",
                code=EXIT_CONTRACT,
                status="contract_failed",
                error_code="TASK_CONTRACT_MISMATCH",
            )
    if not re.fullmatch(r"[0-9a-f]{64}", str(contract.get("pr_body_sha256", ""))):
        raise LifecycleError(
            "task contract has no valid approved PR-body digest",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="TASK_CONTRACT_MISMATCH",
        )
    patterns = contract.get("expected_touch_set")
    if not isinstance(patterns, list) or not patterns:
        raise LifecycleError(
            "task contract has no expected touch set",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_TOUCH_SET",
        )
    normalized_patterns: list[str] = []
    for pattern in patterns:
        value = str(pattern).replace("\\", "/")
        if value.startswith(("/", "-")) or ".." in value.split("/"):
            raise LifecycleError(
                f"unsafe touch-set pattern: {value}",
                code=EXIT_CONTRACT,
                status="contract_failed",
                error_code="INVALID_TOUCH_SET",
            )
        normalized_patterns.append(value)
    return normalized_patterns


def check_scope(controller: Path, base_sha: str, candidate_sha: str, patterns: list[str]) -> list[str]:
    output = run_git(
        controller,
        ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", f"{base_sha}...{candidate_sha}"],
    )
    paths = [line.strip().replace("\\", "/") for line in output.splitlines() if line.strip()]
    violations = [path for path in paths if not any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)]
    if violations:
        raise LifecycleError(
            f"changed paths exceed task contract: {', '.join(violations[:20])}",
            code=EXIT_SCOPE,
            status="scope_failed",
            error_code="SCOPE_VIOLATION",
        )
    return paths


def trusted_python(controller: Path) -> str:
    override = os.environ.get("AI_BIM_VALIDATION_PYTHON")
    candidates = [
        override,
        str(controller / ".venv" / "Scripts" / "python.exe"),
        str(controller / ".venv" / "bin" / "python"),
        sys.executable,
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if not path.is_absolute():
            continue
        try:
            resolved = path.resolve(strict=True)
        except OSError:
            continue
        if resolved.is_file():
            return str(resolved)
    raise LifecycleError(
        "trusted validation Python could not be resolved",
        code=EXIT_CONTRACT,
        status="contract_failed",
        error_code="PYTHON_NOT_FOUND",
    )


def tool_context(
    controller: Path,
    workspace: Path,
    evidence: Path,
    compose_project: str,
    *,
    runtime_harness: Path | None = None,
    storage_root: Path | None = None,
    candidate_sha: str = "",
    invocation_id: str = "",
) -> dict[str, str]:
    return {
        "python": trusted_python(controller),
        "pwsh": trusted_host_tool("pwsh", required=False),
        "npm": trusted_host_tool("npm", required=False),
        "docker": trusted_host_tool("docker", required=False),
        "controller_repo": str(controller),
        "worktree": str(workspace),
        "evidence_dir": str(evidence),
        "compose_project": compose_project,
        "runtime_harness": str(runtime_harness) if runtime_harness is not None else "",
        "storage_root": str(storage_root) if storage_root is not None else "",
        "candidate_sha": candidate_sha,
        "invocation_id": invocation_id,
    }


def expand(value: str, context: dict[str, str]) -> str:
    try:
        return value.format_map(context)
    except (KeyError, ValueError) as exc:
        raise LifecycleError(
            f"profile contains an invalid placeholder: {value}",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_PROFILE_PLACEHOLDER",
        ) from exc


def child_environment(
    *, context: dict[str, str], args: argparse.Namespace, profile: str, storage_root: Path | None
) -> dict[str, str]:
    allowed = {
        "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC",
        "TEMP", "TMP", "TMPDIR", "HOME", "USER", "USERNAME", "USERPROFILE",
        "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
        "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "LANG", "LC_ALL", "CI",
        "NVM_HOME", "NVM_SYMLINK", "NODE_OPTIONS",
    }
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    environment.update(
        {
            "COMPOSE_PROJECT_NAME": context["compose_project"],
            "AI_BIM_VALIDATION_PROFILE": profile,
            "AI_BIM_VALIDATION_INVOCATION_ID": args.invocation_id,
            "AI_BIM_CANDIDATE_SHA": args.candidate_sha.lower(),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONUTF8": "1",
        }
    )
    return environment


def stop_process_tree(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            [trusted_host_tool("taskkill"), "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=3)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def json_selector(path: Path, selector: str) -> object:
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    for part in selector.split("."):
        if isinstance(payload, list):
            payload = payload[int(part)]
        elif isinstance(payload, dict):
            payload = payload[part]
        else:
            raise KeyError(part)
    return payload


def assert_json(path: Path, selector: str, expected: object) -> None:
    payload = json_selector(path, selector)
    if payload != expected:
        raise ValueError(f"selector {selector} expected {expected!r}, got {payload!r}")


ARTIFACT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$")


def assert_artifact_sha256(manifest_path: Path, selector: str, evidence: Path) -> None:
    entry = json_selector(manifest_path, selector)
    if not isinstance(entry, dict):
        raise ValueError(f"selector {selector} must identify an artifact object")
    name = entry.get("name")
    expected = entry.get("sha256")
    if not isinstance(name, str) or not ARTIFACT_NAME_RE.fullmatch(name) or name in {".", ".."}:
        raise ValueError(f"selector {selector} has an unsafe artifact name")
    if not isinstance(expected, str) or re.fullmatch(r"[0-9a-f]{64}", expected) is None:
        raise ValueError(f"selector {selector} has no lowercase SHA-256")

    sealed_root = manifest_path.parent.resolve(strict=True)
    artifact = sealed_root / name
    if _is_replaceable_link(artifact):
        raise ValueError(f"artifact {name} is a replaceable link")
    resolved = artifact.resolve(strict=True)
    if not resolved.is_file() or not is_within(resolved, sealed_root) or not is_within(resolved, evidence):
        raise ValueError(f"artifact {name} escaped the sealed evidence directory")
    observed = sha256_file(resolved)
    if observed != expected:
        raise ValueError(f"artifact {name} SHA-256 differs from the broker manifest")

    try:
        require_file_not_writable(
            resolved,
            label=f"broker artifact {name}",
            writable_error="WRITABLE_RUNTIME_EVIDENCE",
            unverifiable_error="RUNTIME_EVIDENCE_ACL_UNVERIFIABLE",
        )
        require_directory_not_writable(
            sealed_root,
            label="broker-sealed runtime evidence",
            writable_error="WRITABLE_RUNTIME_EVIDENCE",
            unverifiable_error="RUNTIME_EVIDENCE_ACL_UNVERIFIABLE",
        )
    except LifecycleError as exc:
        raise ValueError(str(exc)) from exc


def snapshot_protected_evidence(paths: Iterable[Path]) -> dict[Path, str]:
    snapshot: dict[Path, str] = {}
    for path in paths:
        try:
            unsafe = path.is_symlink() or not path.is_file()
            digest = "" if unsafe else sha256_file(path)
        except OSError:
            unsafe = True
            digest = ""
        if unsafe:
            raise LifecycleError(
                f"runner-owned evidence path is missing or unsafe: {path.name}",
                code=EXIT_VALIDATION,
                status="failed",
                error_code="EVIDENCE_TAMPERING_DETECTED",
            )
        snapshot[path] = digest
    return snapshot


def verify_protected_evidence(snapshot: dict[Path, str]) -> None:
    for path, expected in snapshot.items():
        try:
            changed = path.is_symlink() or not path.is_file() or sha256_file(path) != expected
        except OSError:
            changed = True
        if changed:
            raise LifecycleError(
                f"runner-owned evidence changed while candidate code was executing: {path.name}",
                code=EXIT_VALIDATION,
                status="failed",
                error_code="EVIDENCE_TAMPERING_DETECTED",
            )


def resolve_evidence_assertion_path(raw: str, evidence: Path, context: dict[str, str]) -> Path:
    candidate = Path(expand(raw, context)).expanduser()
    if not candidate.is_absolute() or candidate.is_symlink():
        raise ValueError("evidence assertion path must be an absolute non-symlink file")
    resolved = candidate.resolve(strict=True)
    if not resolved.is_file() or not is_within(resolved, evidence.resolve(strict=True)):
        raise ValueError("evidence assertion path escaped the runner-owned evidence directory")
    return resolved


TRUSTED_EXECUTABLE_TOKENS = {
    "{python}",
    "{pwsh}",
    "{npm}",
    "{docker}",
    "{runtime_harness}",
}


def run_step(
    step: dict[str, Any], *, workspace: Path, context: dict[str, str], environment: dict[str, str],
    evidence: Path, events: EventLog, cleanup: bool = False,
    protected_evidence: Iterable[Path] = (),
) -> dict[str, object]:
    name = str(step.get("name", "unnamed-step"))
    if not IDENTIFIER_RE.fullmatch(name):
        raise LifecycleError(
            "profile step name is unsafe",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_PROFILE_STEP_NAME",
        )
    command_raw = step.get("command")
    if not isinstance(command_raw, list) or not command_raw or not all(isinstance(v, str) for v in command_raw):
        raise LifecycleError(
            f"profile step {name} has no safe argument-vector command",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_PROFILE_COMMAND",
        )
    if command_raw[0] not in TRUSTED_EXECUTABLE_TOKENS:
        raise LifecycleError(
            f"profile step {name} does not select a trusted host executable",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="UNTRUSTED_PROFILE_EXECUTABLE",
        )
    command = [expand(value, context) for value in command_raw]
    executable = Path(command[0]).expanduser()
    if not executable.is_absolute():
        raise LifecycleError(
            f"profile step {name} host executable did not resolve to an absolute path",
            code=EXIT_CONTRACT,
            status="blocked",
            error_code="HOST_TOOL_NOT_FOUND",
        )
    try:
        executable = executable.resolve(strict=True)
    except OSError as exc:
        raise LifecycleError(
            f"profile step {name} host executable could not be resolved: {exc}",
            code=EXIT_CONTRACT,
            status="blocked",
            error_code="HOST_TOOL_NOT_FOUND",
        ) from exc
    if not executable.is_file() or is_within(executable, workspace):
        raise LifecycleError(
            f"profile step {name} executable is not a trusted host file",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="UNTRUSTED_PROFILE_EXECUTABLE",
        )
    command[0] = str(executable)
    relative_cwd = str(step.get("cwd", ".")).replace("\\", "/")
    cwd = (workspace / relative_cwd).resolve(strict=False)
    if not is_within(cwd, workspace) or not cwd.is_dir():
        raise LifecycleError(
            f"profile step {name} has unsafe cwd",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_PROFILE_CWD",
        )
    timeout = int(step.get("timeout_seconds", 900))
    if timeout < 1 or timeout > 14400:
        raise LifecycleError(
            f"profile step {name} has invalid timeout",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_PROFILE_TIMEOUT",
        )

    started = iso_now()
    events.write("cleanup_step_started" if cleanup else "validation_step_started", name=name)
    evidence_snapshot = snapshot_protected_evidence(protected_evidence)
    creation_flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        start_new_session=os.name != "nt",
        creationflags=creation_flags,
    )
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        stop_process_tree(process)
        stdout, stderr = process.communicate()
    verify_protected_evidence(evidence_snapshot)
    stdout = sanitize_text(stdout)
    stderr = sanitize_text(stderr)
    (evidence / f"{name}.stdout.log").write_text(stdout, encoding="utf-8")
    (evidence / f"{name}.stderr.log").write_text(stderr, encoding="utf-8")
    finished = iso_now()
    record = {
        "name": name,
        "started_at": started,
        "finished_at": finished,
        "exit_code": process.returncode,
        "timed_out": timed_out,
        "cleanup": cleanup,
    }
    events.write("cleanup_step_finished" if cleanup else "validation_step_finished", **record)
    if timed_out:
        raise LifecycleError(
            f"step {name} timed out after {timeout}s",
            code=EXIT_TIMEOUT,
            status="timeout",
            error_code="VALIDATION_TIMEOUT",
        )
    if process.returncode != 0:
        raise LifecycleError(
            f"step {name} failed with exit code {process.returncode}",
            code=EXIT_VALIDATION,
            status="failed",
            error_code="VALIDATOR_FAILED",
        )
    for assertion in step.get("assertions", []):
        assertion_type = assertion.get("type")
        try:
            assertion_path = resolve_evidence_assertion_path(str(assertion["path"]), evidence, context)
            if assertion_type == "json_equals":
                selector = str(assertion["selector"])
                expected = assertion.get("expected")
                if isinstance(expected, str):
                    expected = expand(expected, context)
                assert_json(assertion_path, selector, expected)
            elif assertion_type == "json_matches":
                selector = str(assertion["selector"])
                pattern = str(assertion.get("pattern", ""))
                if not pattern or len(pattern) > 256:
                    raise ValueError("json_matches requires a bounded pattern")
                observed = json_selector(assertion_path, selector)
                if not isinstance(observed, str) or re.fullmatch(pattern, observed) is None:
                    raise ValueError(f"selector {selector} did not match {pattern!r}")
            elif assertion_type == "artifact_sha256":
                assert_artifact_sha256(
                    assertion_path,
                    str(assertion["selector"]),
                    evidence.resolve(strict=True),
                )
            elif assertion_type == "file_not_writable":
                try:
                    require_file_not_writable(
                        assertion_path,
                        label=f"step {name} evidence file",
                        writable_error="WRITABLE_RUNTIME_EVIDENCE",
                        unverifiable_error="RUNTIME_EVIDENCE_ACL_UNVERIFIABLE",
                    )
                except LifecycleError as exc:
                    raise ValueError(str(exc)) from exc
            else:
                raise LifecycleError(
                    f"step {name} uses an unsupported assertion",
                    code=EXIT_CONTRACT,
                    status="contract_failed",
                    error_code="INVALID_ASSERTION",
                )
        except (OSError, ValueError, KeyError, IndexError, json.JSONDecodeError) as exc:
            raise LifecycleError(
                f"step {name} evidence assertion failed: {exc}",
                code=EXIT_VALIDATION,
                status="failed",
                error_code="EVIDENCE_ASSERTION_FAILED",
            ) from exc
    return record


def collect_artifacts(workspace: Path, evidence: Path, profile: dict[str, Any]) -> list[str]:
    collected: list[str] = []
    total = 0
    max_bytes = int(profile.get("max_collect_bytes", 536_870_912))
    for pattern in profile.get("collect", []):
        for source in workspace.glob(str(pattern)):
            if not source.is_file() or source.is_symlink():
                continue
            resolved = source.resolve(strict=True)
            if not is_within(resolved, workspace):
                continue
            size = source.stat().st_size
            if total + size > max_bytes:
                continue
            relative = source.relative_to(workspace)
            target = evidence / "collected" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            total += size
            collected.append(relative.as_posix())
    return collected


def worktree_paths(controller: Path) -> set[str]:
    output = run_git(controller, ["worktree", "list", "--porcelain"])
    return {
        normalized(Path(line[len("worktree ") :]))
        for line in output.splitlines()
        if line.startswith("worktree ")
    }


def execute(args: argparse.Namespace) -> int:
    validate_inputs(args)
    controller = args.controller_repo.expanduser().resolve(strict=True)
    if args.git_repo is None:
        if not args.test_mode:
            raise LifecycleError(
                "a separate mutable candidate Git repository is required",
                code=EXIT_UNSAFE_PATH,
                status="unsafe_path",
                error_code="CANDIDATE_GIT_REPO_REQUIRED",
            )
        candidate_git_repo = controller
    else:
        candidate_git_repo = args.git_repo.expanduser().resolve(strict=True)
    if not controller.is_dir() or not candidate_git_repo.is_dir():
        raise LifecycleError(
            "controller and candidate Git repository must be existing directories",
            code=EXIT_UNSAFE_PATH,
            status="unsafe_path",
            error_code="INVALID_REPOSITORY_ROOT",
        )
    workspace_root = args.workspace_root.expanduser().resolve(strict=False)
    evidence_root = args.evidence_root.expanduser().resolve(strict=False)
    profiles_path = args.profiles_path.expanduser().resolve(strict=True)
    trusted_profiles = (controller / "scripts" / "agent" / "validation-profiles.json").resolve(strict=False)
    if not args.test_mode and profiles_path != trusted_profiles:
        raise LifecycleError(
            "profile override is allowed only in test mode",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="UNTRUSTED_PROFILE_PATH",
        )

    if not args.test_mode:
        validate_repository_separation(controller, candidate_git_repo)
        require_read_only_controller(
            controller,
            (
                controller / ".git" / "HEAD",
                controller / ".git" / "index",
                controller / ".git" / "config",
                controller / "scripts" / "agent" / "resolve_pr_contract.py",
                controller / "scripts" / "agent" / "Invoke-EphemeralValidation.ps1",
                Path(__file__).resolve(strict=True),
                profiles_path,
                controller / "scripts" / "verify-all.ps1",
                controller / "scripts" / "verify-runtime-kit-launcher.ps1",
                controller / "scripts" / "lib" / "smoke-evidence.ps1",
                controller / "scripts" / "lib" / "StructLog.psm1",
            ),
        )

    controller_head_before = run_git(controller, ["rev-parse", "HEAD"], read_only=True).lower()
    controller_status_before = run_git(controller, ["status", "--porcelain"], read_only=True)
    allowlist_sha256_before = sha256_file(profiles_path)
    if not args.test_mode and controller_head_before != args.base_sha.lower():
        raise LifecycleError(
            "trusted controller HEAD does not equal the approved protected-base SHA",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="CONTROLLER_SHA_MISMATCH",
        )

    configuration = load_json(profiles_path, "validation profiles")
    protected_roots = [*configuration.get("protected_workspace_roots", []), str(candidate_git_repo)]
    validate_workspace_root(controller, workspace_root, protected_roots)
    validate_evidence_root(controller, candidate_git_repo, workspace_root, evidence_root, protected_roots)
    workspace_root.mkdir(parents=True, exist_ok=True)
    evidence_root.mkdir(parents=True, exist_ok=True)
    if not args.test_mode:
        require_local_ntfs(controller, label="trusted controller")
        require_local_ntfs(candidate_git_repo, label="candidate Git repository")
        require_local_ntfs(workspace_root, label="workspace and lease root")
        require_local_ntfs(evidence_root, label="validation evidence root")

    identity = f"pr-{args.pr_number}-run-{args.run_id}-attempt-{args.attempt}"
    workspace = workspace_root / f"pr-{args.pr_number}" / f"run-{args.run_id}-attempt-{args.attempt}"
    evidence = evidence_root / f"pr-{args.pr_number}" / f"run-{args.run_id}-attempt-{args.attempt}" / f"invocation-{args.invocation_id}"
    evidence.mkdir(parents=True, exist_ok=False)
    events = EventLog(evidence / "events.ndjson")
    events.write("invocation_started", identity=identity, candidate_sha=args.candidate_sha.lower())

    profile_name = args.profile
    contract: dict[str, Any] | None = None
    if args.task_contract:
        contract = load_json(args.task_contract.expanduser().resolve(strict=True), "task contract")
        contract_profile = str(contract.get("local_validation_profile", ""))
        if profile_name and profile_name != contract_profile:
            raise LifecycleError(
                "CLI profile differs from task contract",
                code=EXIT_CONTRACT,
                status="contract_failed",
                error_code="TASK_CONTRACT_MISMATCH",
            )
        profile_name = contract_profile
    if not profile_name or not PROFILE_RE.fullmatch(profile_name):
        raise LifecycleError(
            "a valid profile or task contract is required",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_PROFILE",
        )
    profiles = configuration.get("profiles")
    if not isinstance(profiles, dict) or profile_name not in profiles:
        raise LifecycleError(
            f"unknown validation profile: {profile_name}",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="UNKNOWN_PROFILE",
        )
    profile = profiles[profile_name]
    if not isinstance(profile, dict):
        raise LifecycleError(
            f"invalid validation profile: {profile_name}",
            code=EXIT_CONTRACT,
            status="contract_failed",
            error_code="INVALID_PROFILE",
        )
    required_platform = profile.get("required_platform")
    if required_platform and str(required_platform).lower() != platform.system().lower():
        raise LifecycleError(
            f"profile {profile_name} requires {required_platform}",
            code=EXIT_CONTRACT,
            status="blocked",
            error_code="PLATFORM_REQUIREMENT_NOT_MET",
        )

    storage_root: Path | None = None
    if args.storage_root and profile_name in {"kit-runtime", "full"}:
        storage_root_input = args.storage_root.expanduser()
        if storage_root_input.is_symlink():
            raise LifecycleError(
                "real IFC storage root cannot be a replaceable symlink",
                code=EXIT_UNSAFE_PATH,
                status="unsafe_path",
                error_code="UNSAFE_STORAGE_ROOT",
            )
        storage_root = storage_root_input.resolve(strict=True)
        if not storage_root.is_dir():
            raise LifecycleError(
                "storage root must be an existing directory",
                code=EXIT_UNSAFE_PATH,
                status="unsafe_path",
                error_code="INVALID_STORAGE_ROOT",
            )
        storage_forbidden = [controller, candidate_git_repo, workspace_root, evidence_root]
        for raw in configuration.get("protected_workspace_roots", []):
            if os.name != "nt" and re.match(r"^[A-Za-z]:[\\/]", str(raw)):
                continue
            storage_forbidden.append(Path(str(raw)).expanduser().resolve(strict=False))
        if any(paths_overlap(storage_root, path) for path in storage_forbidden):
            raise LifecycleError(
                "real IFC storage must be isolated from controller, candidate, workspace, evidence, and deployment roots",
                code=EXIT_UNSAFE_PATH,
                status="unsafe_path",
                error_code="UNSAFE_STORAGE_ROOT",
            )
        if not args.test_mode:
            for directory in (storage_root.parent, storage_root):
                require_directory_not_writable(
                    directory,
                    label="real IFC storage boundary",
                    writable_error="REAL_STORAGE_WRITABLE",
                    unverifiable_error="REAL_STORAGE_ACL_UNVERIFIABLE",
                )

    runtime_harness: Path | None = None
    runtime_harness_bundle: Path | None = None
    runtime_harness_snapshot: dict[str, str] | None = None
    if profile_name in {"kit-runtime", "full"}:
        if storage_root is None:
            raise LifecycleError(
                f"profile {profile_name} requires a real read-only IFC storage root",
                code=EXIT_CONTRACT,
                status="blocked",
                error_code="REAL_STORAGE_REQUIRED",
            )
        if args.runtime_harness is None:
            raise LifecycleError(
                f"profile {profile_name} requires the trusted local real-runtime harness",
                code=EXIT_CONTRACT,
                status="blocked",
                error_code="REAL_RUNTIME_HARNESS_REQUIRED",
            )
        runtime_harness_input = args.runtime_harness.expanduser()
        if runtime_harness_input.is_symlink():
            raise LifecycleError(
                "real-runtime harness entrypoint cannot be a replaceable symlink",
                code=EXIT_UNSAFE_PATH,
                status="unsafe_path",
                error_code="UNSAFE_REAL_RUNTIME_HARNESS",
            )
        runtime_harness = runtime_harness_input.resolve(strict=True)
        if (
            paths_overlap(runtime_harness, controller)
            or paths_overlap(runtime_harness, workspace_root)
            or paths_overlap(runtime_harness, candidate_git_repo)
            or paths_overlap(runtime_harness, evidence_root)
            or (storage_root is not None and paths_overlap(runtime_harness, storage_root))
            or not runtime_harness.is_file()
        ):
            raise LifecycleError(
                "real-runtime harness must be a protected executable outside candidate-writable roots",
                code=EXIT_UNSAFE_PATH,
                status="unsafe_path",
                error_code="UNSAFE_REAL_RUNTIME_HARNESS",
            )
        runtime_harness_bundle = runtime_harness.parent
        require_directory_not_writable(
            runtime_harness_bundle.parent,
            label="real-runtime harness bundle parent",
            writable_error="WRITABLE_REAL_RUNTIME_HARNESS",
            unverifiable_error="RUNTIME_HARNESS_ACL_UNVERIFIABLE",
        )
        runtime_harness_snapshot = snapshot_sealed_tree(
            runtime_harness_bundle,
            label="real-runtime harness bundle",
        )
        if runtime_harness.relative_to(runtime_harness_bundle).as_posix() not in runtime_harness_snapshot:
            raise LifecycleError(
                "real-runtime harness entrypoint is absent from the sealed bundle manifest",
                code=EXIT_UNSAFE_PATH,
                status="unsafe_path",
                error_code="SEALED_BUNDLE_UNVERIFIABLE",
            )

    compose_project = re.sub(r"[^a-z0-9_-]", "-", f"ai_bim_pr_{args.pr_number}_{args.run_id}_{args.attempt}".lower())[:63]
    result: dict[str, Any] = {
        "schema_version": "ai-bim-ephemeral-validation-result/v1",
        "invocation_id": args.invocation_id,
        "identity": identity,
        "pr_number": args.pr_number,
        "run_id": args.run_id,
        "attempt": args.attempt,
        "profile": profile_name,
        "trusted_controller_sha": controller_head_before,
        "allowlist_sha256": allowlist_sha256_before,
        "runtime_harness_bundle_sha256": (
            sealed_tree_digest(runtime_harness_snapshot) if runtime_harness_snapshot else None
        ),
        "base_sha": args.base_sha.lower(),
        "candidate_sha": args.candidate_sha.lower(),
        "pr_body_sha256": contract.get("pr_body_sha256") if contract else None,
        "observed_head_sha": None,
        "workspace_path": str(workspace),
        "workspace_created": False,
        "compose_project_name": compose_project,
        "changed_paths": [],
        "validation_started_at": None,
        "validation_finished_at": None,
        "validation_steps": [],
        "validation_exit_code": None,
        "status": "running",
        "error_code": None,
        "error": None,
        "locks": [],
        "collected_artifacts": [],
        "cleanup_status": "not_started",
        "cleanup_errors": [],
        "started_at": iso_now(),
        "finished_at": None,
    }
    result_path = evidence / "result.json"
    atomic_write_json(result_path, result)

    state_dir = workspace_root / ".runs" / identity
    state_dir.mkdir(parents=True, exist_ok=True)
    claim_path = state_dir / "claim.json"
    try:
        descriptor = os.open(claim_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump({"invocation_id": args.invocation_id, "started_at": iso_now()}, handle)
    except FileExistsError:
        result.update(
            {
                "status": "duplicate",
                "error_code": "DUPLICATE_INVOCATION",
                "error": f"duplicate delivery for {identity}",
                "validation_exit_code": EXIT_CONTRACT,
                "cleanup_status": "succeeded",
                "finished_at": iso_now(),
            }
        )
        events.write("invocation_finished", status="duplicate", cleanup_status="succeeded")
        atomic_write_json(result_path, result)
        print(result_path)
        return EXIT_CONTRACT

    metadata_spec = lease_spec(configuration.get("metadata_lock", {}))
    profile_leases: list[Lease] = []
    worktree_attempted = False
    worktree_created = False
    target_ref: str | None = None
    primary_error: LifecycleError | None = None

    try:
        metadata = Lease(
            root=workspace_root,
            spec=metadata_spec,
            invocation_id=args.invocation_id,
            workspace=workspace,
            events=events,
        ).acquire()
        try:
            if args.fetch_ref:
                ref_slug = re.sub(r"[^A-Za-z0-9._-]", "-", args.run_id)
                target_ref = f"refs/ai-bim-validation/pr-{args.pr_number}-run-{ref_slug}-attempt-{args.attempt}"
                run_git(candidate_git_repo, ["fetch", "--no-tags", "origin", f"+{args.fetch_ref}:{target_ref}"], timeout=300)
                fetched = run_git(candidate_git_repo, ["rev-parse", "--verify", f"{target_ref}^{{commit}}"])
                if fetched.lower() != args.candidate_sha.lower():
                    raise LifecycleError(
                        "fetched PR merge ref differs from the approved immutable candidate SHA",
                        code=EXIT_CONTRACT,
                        status="contract_failed",
                        error_code="CANDIDATE_SHA_CHANGED",
                    )
            else:
                run_git(candidate_git_repo, ["cat-file", "-e", f"{args.candidate_sha}^{{commit}}"])
            run_git(candidate_git_repo, ["cat-file", "-e", f"{args.base_sha}^{{commit}}"])
        finally:
            result["locks"].append({"group": metadata_spec.group, "wait_ms": metadata.wait_ms})
            metadata.release()

        patterns: list[str] | None = None
        if contract is not None:
            patterns = verify_task_contract(contract, args, profile_name)
            result["changed_paths"] = check_scope(candidate_git_repo, args.base_sha, args.candidate_sha, patterns)

        metadata = Lease(
            root=workspace_root,
            spec=metadata_spec,
            invocation_id=args.invocation_id,
            workspace=workspace,
            events=events,
        ).acquire()
        try:
            if workspace.exists():
                raise LifecycleError(
                    f"workspace already exists: {workspace}",
                    code=EXIT_WORKTREE,
                    status="worktree_failed",
                    error_code="WORKSPACE_COLLISION",
                )
            workspace.parent.mkdir(parents=True, exist_ok=True)
            worktree_attempted = True
            run_git(candidate_git_repo, ["worktree", "add", "--detach", str(workspace), args.candidate_sha], timeout=600)
            worktree_created = True
            result["workspace_created"] = True
            result["observed_head_sha"] = run_git(workspace, ["rev-parse", "HEAD"]).lower()
            if result["observed_head_sha"] != args.candidate_sha.lower():
                raise LifecycleError(
                    "detached worktree HEAD does not match candidate SHA",
                    code=EXIT_WORKTREE,
                    status="worktree_failed",
                    error_code="WORKTREE_SHA_MISMATCH",
                )
            events.write("worktree_created", path=str(workspace), head=result["observed_head_sha"])
        finally:
            result["locks"].append({"group": metadata_spec.group, "wait_ms": metadata.wait_ms})
            metadata.release()

        raw_locks = profile.get("locks", [])
        if not isinstance(raw_locks, list) or not raw_locks:
            raise LifecycleError(
                f"profile {profile_name} has no host resource lock",
                code=EXIT_CONTRACT,
                status="contract_failed",
                error_code="PROFILE_WITHOUT_LOCK",
            )
        for spec in sorted((lease_spec(item) for item in raw_locks), key=lambda item: item.group):
            lease = Lease(
                root=workspace_root,
                spec=spec,
                invocation_id=args.invocation_id,
                workspace=workspace,
                events=events,
            ).acquire()
            profile_leases.append(lease)
            result["locks"].append({"group": spec.group, "wait_ms": lease.wait_ms})

        context = tool_context(
            controller,
            workspace,
            evidence,
            compose_project,
            runtime_harness=runtime_harness,
            storage_root=storage_root,
            candidate_sha=args.candidate_sha.lower(),
            invocation_id=args.invocation_id,
        )
        environment = child_environment(
            context=context,
            args=args,
            profile=profile_name,
            storage_root=storage_root,
        )
        result["validation_started_at"] = iso_now()
        events.write("validation_started", profile=profile_name)
        steps = profile.get("steps")
        if not isinstance(steps, list) or not steps:
            raise LifecycleError(
                f"profile {profile_name} has no validation steps",
                code=EXIT_CONTRACT,
                status="contract_failed",
                error_code="PROFILE_WITHOUT_STEPS",
            )
        for step in steps:
            result["validation_steps"].append(
                run_step(
                    step,
                    workspace=workspace,
                    context=context,
                    environment=environment,
                    evidence=evidence,
                    events=events,
                    protected_evidence=(result_path, events.path),
                )
            )
        result["validation_finished_at"] = iso_now()
        result["validation_exit_code"] = 0
        result["status"] = "passed"
        events.write("validation_finished", status="passed")
    except LifecycleError as exc:
        primary_error = exc
        result["validation_finished_at"] = result["validation_finished_at"] or iso_now()
        result["validation_exit_code"] = exc.code
        result["status"] = exc.status
        result["error_code"] = exc.error_code
        result["error"] = sanitize_text(str(exc))
        events.write("validation_finished", status=exc.status, error_code=exc.error_code)
    except Exception as exc:  # defensive evidence path; never claim pass
        primary_error = LifecycleError(
            f"internal lifecycle failure: {exc}",
            code=EXIT_INTERNAL,
            status="internal_error",
            error_code="INTERNAL_ERROR",
        )
        result["validation_finished_at"] = result["validation_finished_at"] or iso_now()
        result["validation_exit_code"] = EXIT_INTERNAL
        result["status"] = "internal_error"
        result["error_code"] = "INTERNAL_ERROR"
        result["error"] = sanitize_text(str(exc))
        (evidence / "internal-error.log").write_text(sanitize_text(traceback.format_exc()), encoding="utf-8")
        events.write("validation_finished", status="internal_error", error_code="INTERNAL_ERROR")
    finally:
        if worktree_created:
            context = tool_context(
                controller,
                workspace,
                evidence,
                compose_project,
                runtime_harness=runtime_harness,
                storage_root=storage_root,
                candidate_sha=args.candidate_sha.lower(),
                invocation_id=args.invocation_id,
            )
            environment = child_environment(
                context=context,
                args=args,
                profile=profile_name,
                storage_root=storage_root,
            )
            for cleanup_step in profile.get("cleanup_steps", []):
                try:
                    run_step(
                        cleanup_step,
                        workspace=workspace,
                        context=context,
                        environment=environment,
                        evidence=evidence,
                        events=events,
                        cleanup=True,
                        protected_evidence=(result_path, events.path),
                    )
                except Exception as exc:
                    result["cleanup_errors"].append(sanitize_text(str(exc)))
            try:
                result["collected_artifacts"] = collect_artifacts(workspace, evidence, profile)
            except Exception as exc:
                result["cleanup_errors"].append(f"artifact collection failed: {sanitize_text(str(exc))}")

        for lease in reversed(profile_leases):
            try:
                lease.release()
            except Exception as exc:
                result["cleanup_errors"].append(f"lease release failed: {sanitize_text(str(exc))}")

        if worktree_attempted or target_ref:
            try:
                metadata = Lease(
                    root=workspace_root,
                    spec=metadata_spec,
                    invocation_id=args.invocation_id,
                    workspace=workspace,
                    events=events,
                ).acquire()
                try:
                    if worktree_attempted:
                        registered = normalized(workspace) in worktree_paths(candidate_git_repo)
                        if registered:
                            run_git(candidate_git_repo, ["worktree", "remove", "--force", str(workspace)], timeout=600)
                        elif workspace.exists():
                            if workspace.is_symlink() or not is_within(workspace, workspace_root):
                                raise LifecycleError(
                                    "partial worktree path became unsafe during cleanup",
                                    code=EXIT_CLEANUP,
                                    status="cleanup_failed",
                                    error_code="WORKTREE_CLEANUP_FAILED",
                                )
                            shutil.rmtree(workspace)
                        run_git(candidate_git_repo, ["worktree", "prune", "--expire", "now"], timeout=120)
                        if workspace.exists() or normalized(workspace) in worktree_paths(candidate_git_repo):
                            raise LifecycleError(
                                "worktree remained registered after cleanup",
                                code=EXIT_CLEANUP,
                                status="cleanup_failed",
                                error_code="WORKTREE_CLEANUP_FAILED",
                            )
                        events.write(
                            "worktree_removed" if worktree_created else "partial_worktree_removed",
                            path=str(workspace),
                        )
                        try:
                            workspace.parent.rmdir()
                        except OSError:
                            pass
                    if target_ref:
                        run_git(candidate_git_repo, ["update-ref", "-d", target_ref])
                        events.write("temporary_ref_removed", ref=target_ref)
                finally:
                    metadata.release()
            except Exception as exc:
                result["cleanup_errors"].append(sanitize_text(str(exc)))

        try:
            controller_head_after = run_git(controller, ["rev-parse", "HEAD"], read_only=True).lower()
            controller_status_after = run_git(controller, ["status", "--porcelain"], read_only=True)
            allowlist_sha256_after = sha256_file(profiles_path)
            result["trusted_controller_sha_after"] = controller_head_after
            result["allowlist_sha256_after"] = allowlist_sha256_after
            if controller_head_after != controller_head_before:
                result["cleanup_errors"].append("trusted controller HEAD changed during validation")
            if controller_status_after != controller_status_before:
                result["cleanup_errors"].append("trusted controller worktree changed during validation")
            if allowlist_sha256_after != allowlist_sha256_before:
                result["cleanup_errors"].append("trusted validation allowlist changed during validation")
        except Exception as exc:
            result["cleanup_errors"].append(f"controller integrity check failed: {sanitize_text(str(exc))}")

        if runtime_harness_bundle is not None and runtime_harness_snapshot is not None:
            try:
                runtime_harness_after = snapshot_sealed_tree(
                    runtime_harness_bundle,
                    label="real-runtime harness bundle",
                )
                result["runtime_harness_bundle_sha256_after"] = sealed_tree_digest(runtime_harness_after)
                if runtime_harness_after != runtime_harness_snapshot:
                    result["cleanup_errors"].append("real-runtime harness bundle changed during validation")
            except Exception as exc:
                result["cleanup_errors"].append(
                    f"real-runtime harness integrity check failed: {sanitize_text(str(exc))}"
                )

        result["cleanup_status"] = "succeeded" if not result["cleanup_errors"] else "failed"
        if result["cleanup_errors"] and primary_error is None:
            result["status"] = "cleanup_failed"
            result["error_code"] = "CLEANUP_FAILED"
            result["validation_exit_code"] = EXIT_CLEANUP
        result["finished_at"] = iso_now()
        events.write("invocation_finished", status=result["status"], cleanup_status=result["cleanup_status"])
        atomic_write_json(result_path, result)
        atomic_write_json(
            state_dir / "result.json",
            {
                "invocation_id": args.invocation_id,
                "status": result["status"],
                "result_path": str(result_path),
                "finished_at": result["finished_at"],
            },
        )

    print(result_path)
    if primary_error is not None:
        return primary_error.code
    if result["cleanup_status"] != "succeeded":
        return EXIT_CLEANUP
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--controller-repo", required=True, type=Path)
    parser.add_argument("--git-repo", type=Path)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--pr-number", required=True, type=int)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", required=True, type=int)
    parser.add_argument("--invocation-id", required=True)
    parser.add_argument("--workspace-root", required=True, type=Path)
    parser.add_argument("--evidence-root", required=True, type=Path)
    parser.add_argument("--profiles-path", required=True, type=Path)
    parser.add_argument("--task-contract", type=Path)
    parser.add_argument("--profile")
    parser.add_argument("--fetch-ref", default="")
    parser.add_argument("--storage-root", type=Path)
    parser.add_argument("--runtime-harness", type=Path)
    parser.add_argument("--test-mode", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return execute(args)
    except LifecycleError as exc:
        print(f"ephemeral validation rejected: {sanitize_text(str(exc))}", file=sys.stderr)
        return exc.code
    except Exception as exc:
        print(f"ephemeral validation failed internally: {sanitize_text(str(exc))}", file=sys.stderr)
        return EXIT_INTERNAL


if __name__ == "__main__":
    raise SystemExit(main())
