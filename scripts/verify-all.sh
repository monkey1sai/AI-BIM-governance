#!/usr/bin/env bash
# 跨 repo verify 入口（POSIX 版）。對 current demo repos 依序跑 verify。
# 任一失敗即中斷（除非指定 --continue-on-error）。

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$REPO_ROOT/.venv/Scripts/python.exe"
if [ ! -x "$PYTHON" ]; then
    PYTHON="$REPO_ROOT/.venv/bin/python"
fi
if [ ! -x "$PYTHON" ]; then
    PYTHON="python"
fi

CONTINUE=0
TS_ONLY=0
PY_ONLY=0
STREAMING_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --continue-on-error) CONTINUE=1 ;;
        --ts-only) TS_ONLY=1 ;;
        --py-only) PY_ONLY=1 ;;
        --streaming-only) STREAMING_ONLY=1 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

declare -a TARGETS
PS=""
if command -v pwsh >/dev/null 2>&1; then
    PS="$(command -v pwsh)"
elif [ -x "/c/Program Files/PowerShell/7/pwsh.exe" ]; then
    PS="/c/Program Files/PowerShell/7/pwsh.exe"
elif [ -x "/mnt/c/Program Files/PowerShell/7/pwsh.exe" ]; then
    PS="/mnt/c/Program Files/PowerShell/7/pwsh.exe"
fi
PS_Q=""
if [ -n "$PS" ]; then
    printf -v PS_Q '%q' "$PS"
fi
NPM_VERIFY="npm run verify"
case "$REPO_ROOT" in
    /mnt/[a-zA-Z]/*|/[a-zA-Z]/*)
        if [ -n "$PS_Q" ]; then
            NPM_VERIFY="$PS_Q -NoProfile -Command 'npm.cmd run verify'"
        fi
        ;;
esac

if [ "$STREAMING_ONLY" -eq 1 ]; then
    if [ -z "$PS" ]; then
        echo "PowerShell 7 (pwsh) not found; cannot run bim-streaming-server checks." >&2
        exit 2
    fi
    TARGETS+=("bim-streaming-server|$PS_Q -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-stage-loading-contract.ps1")
elif [ "$TS_ONLY" -eq 0 ]; then
    # B-scheme T8 §9.1：default verify 不再依賴已刪 _bim-control / _worker；
    # 改以 repo-root tests/（外部平台 contracts + test-only fakes）作 Python 覆蓋。
    TARGETS+=("tests (contracts+fakes)|$PYTHON -m pytest tests -q -p no:cacheprovider")
fi
if [ "$STREAMING_ONLY" -eq 0 ] && [ "$PY_ONLY" -eq 0 ]; then
    TARGETS+=("bim-review-coordinator|$NPM_VERIFY")
    TARGETS+=("web-viewer-sample|$NPM_VERIFY")
fi
if [ "$STREAMING_ONLY" -eq 0 ] && [ "$TS_ONLY" -eq 0 ] && [ "$PY_ONLY" -eq 0 ] && [ -n "$PS" ]; then
    TARGETS+=("bim-streaming-server|$PS_Q -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-stage-loading-contract.ps1")
fi

PASSED=()
FAILED=()

for entry in "${TARGETS[@]}"; do
    name="${entry%%|*}"
    cmd="${entry#*|}"
    cwd="$REPO_ROOT/$name"
    if [ ! -d "$cwd" ]; then
        echo "[SKIP] $name — directory not found"
        continue
    fi
    echo ""
    echo "==> [$name] $cmd"
    ( cd "$cwd" && eval "$cmd" )
    code=$?
    if [ $code -ne 0 ]; then
        FAILED+=("$name")
        echo "[FAIL] $name (exit $code)"
        if [ "$CONTINUE" -eq 0 ]; then break; fi
    else
        PASSED+=("$name")
        echo "[OK]   $name"
    fi
done

echo ""
echo "======================================"
echo "Passed: ${PASSED[*]:-<none>}"
echo "Failed: ${FAILED[*]:-<none>}"
echo "======================================"

if [ "${#FAILED[@]}" -gt 0 ]; then exit 1; else exit 0; fi
