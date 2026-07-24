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
PROFILE="Developer"
PLAN_ONLY=0
PROFILE_ARG_PENDING=0
for arg in "$@"; do
    if [ "$PROFILE_ARG_PENDING" -eq 1 ]; then
        PROFILE="$arg"
        PROFILE_ARG_PENDING=0
        continue
    fi
    case "$arg" in
        --continue-on-error) CONTINUE=1 ;;
        --ts-only) TS_ONLY=1 ;;
        --py-only) PY_ONLY=1 ;;
        --streaming-only) STREAMING_ONLY=1 ;;
        --profile) PROFILE_ARG_PENDING=1 ;;
        --profile=*) PROFILE="${arg#*=}" ;;
        --plan-only) PLAN_ONLY=1 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done
if [ "$PROFILE_ARG_PENDING" -eq 1 ]; then
    echo "--profile requires a value" >&2
    exit 2
fi

case "$PROFILE" in
    Developer) ;;
    Deployment)
        echo "[PLAN] profile=deployment"
        echo "[EXECUTE] deployment required artifacts"
        echo "[EXECUTE] coordinator health"
        echo "[EXECUTE] governance health"
        echo "[EXECUTE] conversion health"
        echo "[EXECUTE] kit manager health"
        echo "[EXECUTE] viewer endpoint"
        echo "[OMIT] tests (contracts+fakes)"
        echo "[OMIT] bim-review-coordinator (full verify)"
        echo "[OMIT] web-viewer-sample (full verify)"
        echo "[OMIT] bim-streaming-server stage-loading contract"
        if [ "$PLAN_ONLY" -eq 1 ]; then exit 0; fi
        if [ ! -f "$REPO_ROOT/scripts/deploy.ps1" ] || [ ! -f "$REPO_ROOT/docs/plans/ai-bim-governance.css" ]; then
            echo "deployment required artifact missing" >&2
            exit 1
        fi
        for health_uri in \
            "http://127.0.0.1:8004/health" \
            "http://127.0.0.1:49102/health" \
            "http://127.0.0.1:49101/health" \
            "http://127.0.0.1:8010/health" \
            "http://127.0.0.1:5173/"; do
            if ! curl --fail --silent --show-error --max-time 10 "$health_uri" >/dev/null; then
                echo "deployment health check failed: $health_uri" >&2
                exit 1
            fi
        done
        exit 0
        ;;
    *) echo "unknown profile: $PROFILE" >&2; exit 2 ;;
esac

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
    TARGETS+=("tests|$PYTHON -m pytest tests -q -p no:cacheprovider")
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
