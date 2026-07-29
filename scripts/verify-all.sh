#!/usr/bin/env bash
# Cross-repository verification entrypoint (POSIX adapter).
# Developer planning and execution are delegated to the shared manifest runner.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/scripts/verification-manifest.json"
RUNNER="$REPO_ROOT/scripts/lib/verification-runner.mjs"

CONTINUE=0
TS_ONLY=0
PY_ONLY=0
STREAMING_ONLY=0
PROFILE="Developer"
PLAN_ONLY=0
JSON=0
FULL=0
PROFILE_ARG_PENDING=0
CHANGED_PATH_PENDING=0
SUBJECT_ARG_PENDING=0
OUTCOME_ARG_PENDING=0
SUBJECT=""
OUTCOME_OUT=""
declare -a CHANGED_PATHS=()

for arg in "$@"; do
    if [ "$PROFILE_ARG_PENDING" -eq 1 ]; then
        PROFILE="$arg"
        PROFILE_ARG_PENDING=0
        continue
    fi
    if [ "$CHANGED_PATH_PENDING" -eq 1 ]; then
        CHANGED_PATHS+=("$arg")
        CHANGED_PATH_PENDING=0
        continue
    fi
    if [ "$SUBJECT_ARG_PENDING" -eq 1 ]; then SUBJECT="$arg"; SUBJECT_ARG_PENDING=0; continue; fi
    if [ "$OUTCOME_ARG_PENDING" -eq 1 ]; then OUTCOME_OUT="$arg"; OUTCOME_ARG_PENDING=0; continue; fi
    case "$arg" in
        --continue-on-error) CONTINUE=1 ;;
        --ts-only) TS_ONLY=1 ;;
        --py-only) PY_ONLY=1 ;;
        --streaming-only) STREAMING_ONLY=1 ;;
        --profile) PROFILE_ARG_PENDING=1 ;;
        --profile=*) PROFILE="${arg#*=}" ;;
        --plan-only) PLAN_ONLY=1 ;;
        --json) JSON=1 ;;
        --full) FULL=1 ;;
        --changed-path) CHANGED_PATH_PENDING=1 ;;
        --changed-path=*) CHANGED_PATHS+=("${arg#*=}") ;;
        --subject) SUBJECT_ARG_PENDING=1 ;;
        --subject=*) SUBJECT="${arg#*=}" ;;
        --outcome-out) OUTCOME_ARG_PENDING=1 ;;
        --outcome-out=*) OUTCOME_OUT="${arg#*=}" ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done
if [ "$PROFILE_ARG_PENDING" -eq 1 ]; then
    echo "--profile requires a value" >&2
    exit 2
fi
if [ "$CHANGED_PATH_PENDING" -eq 1 ]; then
    echo "--changed-path requires a value" >&2
    exit 2
fi
if [ "$SUBJECT_ARG_PENDING" -eq 1 ] || [ "$OUTCOME_ARG_PENDING" -eq 1 ]; then
    echo "--subject and --outcome-out require values" >&2
    exit 2
fi
if [ -n "$OUTCOME_OUT" ] && { [ "$PLAN_ONLY" -eq 1 ] || [ "$JSON" -eq 1 ] || ! printf '%s' "$SUBJECT" | grep -Eq '^[0-9a-f]{40}$'; }; then
    echo "--outcome-out requires execution and a full lowercase --subject commit" >&2
    exit 2
fi
if [ "$JSON" -eq 1 ] && [ "$PLAN_ONLY" -ne 1 ]; then
    echo "--json is supported only with --plan-only" >&2
    exit 2
fi

PS=""
if command -v pwsh >/dev/null 2>&1; then
    PS="$(command -v pwsh)"
elif [ -x "/c/Program Files/PowerShell/7/pwsh.exe" ]; then
    PS="/c/Program Files/PowerShell/7/pwsh.exe"
elif [ -x "/mnt/c/Program Files/PowerShell/7/pwsh.exe" ]; then
    PS="/mnt/c/Program Files/PowerShell/7/pwsh.exe"
fi

case "$PROFILE" in
    Developer) ;;
    Deployment)
        if [ "$TS_ONLY" -eq 1 ] || [ "$PY_ONLY" -eq 1 ] || [ "$STREAMING_ONLY" -eq 1 ] ||
           [ "$JSON" -eq 1 ] || [ "$FULL" -eq 1 ] || [ "${#CHANGED_PATHS[@]}" -gt 0 ]; then
            echo "Deployment does not accept filters, JSON, full, or changed-path dispatch." >&2
            exit 2
        fi
        if [ -z "$PS" ]; then
            echo "Deployment verification requires PowerShell 7 and the canonical verify-all.ps1 adapter." >&2
            exit 2
        fi
        declare -a DEPLOYMENT_ARGS=(-NoProfile -NonInteractive -File scripts/verify-all.ps1 -Profile Deployment)
        if [ "$PLAN_ONLY" -eq 1 ]; then DEPLOYMENT_ARGS+=(-PlanOnly); fi
        (cd "$REPO_ROOT" && "$PS" "${DEPLOYMENT_ARGS[@]}")
        exit $?
        ;;
    *) echo "unknown profile: $PROFILE" >&2; exit 2 ;;
esac

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required to read the verification manifest." >&2
    exit 2
fi
if [ ! -f "$MANIFEST" ] || [ ! -f "$RUNNER" ]; then
    echo "Developer verification manifest or runner is missing." >&2
    exit 2
fi
if { [ "$FULL" -eq 1 ] || [ "${#CHANGED_PATHS[@]}" -gt 0 ]; } &&
   { [ "$TS_ONLY" -eq 1 ] || [ "$PY_ONLY" -eq 1 ] || [ "$STREAMING_ONLY" -eq 1 ]; }; then
    echo "changed-path/full dispatch cannot be combined with legacy Developer filters" >&2
    exit 2
fi

declare -a RUNNER_ARGS=(
    "$RUNNER"
    --repo-root "$REPO_ROOT"
    --manifest "$MANIFEST"
)
if [ "$FULL" -eq 1 ] || [ "${#CHANGED_PATHS[@]}" -gt 0 ]; then
    for changed_path in "${CHANGED_PATHS[@]}"; do
        RUNNER_ARGS+=(--path "$changed_path")
    done
    if [ "$FULL" -eq 1 ]; then RUNNER_ARGS+=(--full); fi
else
    if [ "$STREAMING_ONLY" -eq 1 ]; then
        RUNNER_ARGS+=(--default-profile developer-streaming)
    elif [ "$TS_ONLY" -eq 1 ] && [ "$PY_ONLY" -eq 1 ]; then
        RUNNER_ARGS+=(--default-profile developer-none)
    elif [ "$TS_ONLY" -eq 1 ]; then
        RUNNER_ARGS+=(--default-profile developer-ts)
    elif [ "$PY_ONLY" -eq 1 ]; then
        RUNNER_ARGS+=(--default-profile developer-py)
    else
        RUNNER_ARGS+=(--default-profile developer)
    fi
fi
if [ "$PLAN_ONLY" -eq 1 ]; then RUNNER_ARGS+=(--plan-only); fi
if [ "$JSON" -eq 1 ]; then RUNNER_ARGS+=(--json); fi
if [ "$CONTINUE" -eq 1 ]; then RUNNER_ARGS+=(--continue-on-error); fi
if [ -n "$SUBJECT" ]; then RUNNER_ARGS+=(--subject "$SUBJECT"); fi
if [ -n "$OUTCOME_OUT" ]; then RUNNER_ARGS+=(--outcome-out "$OUTCOME_OUT"); fi

exec node "${RUNNER_ARGS[@]}"
