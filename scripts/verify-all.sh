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
TARGET_ID_ARG_PENDING=0
INVENTORY_PATH_ARG_PENDING=0
BASE_REF_ARG_PENDING=0
TIER_ARG_PENDING=0
SUBJECT=""
OUTCOME_OUT=""
TARGET_ID=""
INVENTORY_PATH=""
BASE_REF=""
BASE_SHA=""
TIER=""
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
    if [ "$TARGET_ID_ARG_PENDING" -eq 1 ]; then
        if [ -z "$arg" ]; then echo "--target-id requires a non-empty value" >&2; exit 2; fi
        TARGET_ID="$arg"; TARGET_ID_ARG_PENDING=0; continue
    fi
    if [ "$INVENTORY_PATH_ARG_PENDING" -eq 1 ]; then
        if [ -z "$arg" ]; then echo "--inventory-path requires a non-empty value" >&2; exit 2; fi
        INVENTORY_PATH="$arg"; INVENTORY_PATH_ARG_PENDING=0; continue
    fi
    if [ "$BASE_REF_ARG_PENDING" -eq 1 ]; then
        if [ -z "$arg" ]; then echo "--base requires a non-empty value" >&2; exit 2; fi
        BASE_REF="$arg"; BASE_REF_ARG_PENDING=0; continue
    fi
    if [ "$TIER_ARG_PENDING" -eq 1 ]; then
        TIER="$arg"; TIER_ARG_PENDING=0; continue
    fi
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
        --base) BASE_REF_ARG_PENDING=1 ;;
        --base=*)
            BASE_REF="${arg#*=}"
            if [ -z "$BASE_REF" ]; then echo "--base requires a non-empty value" >&2; exit 2; fi
            ;;
        --tier) TIER_ARG_PENDING=1 ;;
        --tier=*) TIER="${arg#*=}" ;;
        --subject) SUBJECT_ARG_PENDING=1 ;;
        --subject=*) SUBJECT="${arg#*=}" ;;
        --outcome-out) OUTCOME_ARG_PENDING=1 ;;
        --outcome-out=*) OUTCOME_OUT="${arg#*=}" ;;
        --target-id) TARGET_ID_ARG_PENDING=1 ;;
        --target-id=*)
            TARGET_ID="${arg#*=}"
            if [ -z "$TARGET_ID" ]; then echo "--target-id requires a non-empty value" >&2; exit 2; fi
            ;;
        --inventory-path) INVENTORY_PATH_ARG_PENDING=1 ;;
        --inventory-path=*)
            INVENTORY_PATH="${arg#*=}"
            if [ -z "$INVENTORY_PATH" ]; then echo "--inventory-path requires a non-empty value" >&2; exit 2; fi
            ;;
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
if [ "$TARGET_ID_ARG_PENDING" -eq 1 ] || [ "$INVENTORY_PATH_ARG_PENDING" -eq 1 ]; then
    echo "--target-id and --inventory-path require values" >&2
    exit 2
fi
if [ "$BASE_REF_ARG_PENDING" -eq 1 ]; then
    echo "--base requires a non-empty value" >&2
    exit 2
fi
if [ "$TIER_ARG_PENDING" -eq 1 ]; then
    echo "--tier requires a value (quick, pr, full)" >&2
    exit 2
fi
case "$TIER" in
    ""|quick|pr|full) ;;
    *) echo "--tier must be one of quick, pr, full" >&2; exit 2 ;;
esac
if [ -n "$TIER" ] && [ -n "$OUTCOME_OUT" ]; then
    echo "--tier cannot be combined with --outcome-out: a tiered run is not verification evidence" >&2
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
    Developer)
        if [ -n "$TARGET_ID" ] || [ -n "$INVENTORY_PATH" ]; then
            echo "TargetId and InventoryPath are supported only by the Deployment profile." >&2
            exit 2
        fi
        ;;
    Deployment)
        if [ "$TS_ONLY" -eq 1 ] || [ "$PY_ONLY" -eq 1 ] || [ "$STREAMING_ONLY" -eq 1 ] ||
           [ "$JSON" -eq 1 ] || [ "$FULL" -eq 1 ] || [ "${#CHANGED_PATHS[@]}" -gt 0 ] || [ -n "$BASE_REF" ] || [ -n "$TIER" ] ||
           [ -n "$SUBJECT" ] || [ -n "$OUTCOME_OUT" ]; then
            echo "Deployment is a legacy_profile_not_migrated adapter and does not accept Json, ChangedPath, Base, Tier, Full, Subject, or OutcomeOut." >&2
            exit 2
        fi
        if [ -z "$PS" ]; then
            echo "Deployment verification requires PowerShell 7 and the canonical verify-all.ps1 adapter." >&2
            exit 2
        fi
        declare -a DEPLOYMENT_ARGS=(-NoProfile -NonInteractive -File scripts/verify-all.ps1 -Profile Deployment)
        if [ "$PLAN_ONLY" -eq 1 ]; then DEPLOYMENT_ARGS+=(-PlanOnly); fi
        if [ -n "$TARGET_ID" ]; then DEPLOYMENT_ARGS+=(-TargetId "$TARGET_ID"); fi
        if [ -n "$INVENTORY_PATH" ]; then DEPLOYMENT_ARGS+=(-InventoryPath "$INVENTORY_PATH"); fi
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
# --base <ref>: derive changed paths with the exact command CI runs (ci.yml changes job),
# so the local plan and the CI plan are computed from identical input.
if [ -n "$BASE_REF" ]; then
    if [ "$FULL" -eq 1 ] || [ "${#CHANGED_PATHS[@]}" -gt 0 ]; then
        echo "--base cannot be combined with --changed-path or --full" >&2
        exit 2
    fi
    BASE_SHA="$(git -C "$REPO_ROOT" --no-optional-locks rev-parse --verify --quiet "${BASE_REF}^{commit}" 2>/dev/null)" || BASE_SHA=""
    if ! printf '%s' "$BASE_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
        echo "--base does not resolve to a commit: $BASE_REF" >&2
        exit 2
    fi
    CHANGED_PATHS_FILE="$(mktemp)"
    if ! git -C "$REPO_ROOT" -c core.quotepath=false --no-optional-locks diff --no-renames --name-only -z "$BASE_SHA...HEAD" > "$CHANGED_PATHS_FILE"; then
        rm -f "$CHANGED_PATHS_FILE"
        echo "--base diff failed for $BASE_REF...HEAD" >&2
        exit 2
    fi
    mapfile -d '' -t CHANGED_PATHS < "$CHANGED_PATHS_FILE"
    rm -f "$CHANGED_PATHS_FILE"
    if [ "${#CHANGED_PATHS[@]}" -eq 0 ]; then
        echo "--base $BASE_REF produced no changed paths relative to HEAD; nothing to verify." >&2
        exit 2
    fi
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
    if [ -n "$BASE_SHA" ]; then RUNNER_ARGS+=(--base "$BASE_SHA"); fi
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
if [ -n "$TIER" ]; then RUNNER_ARGS+=(--tier "$TIER"); fi

exec node "${RUNNER_ARGS[@]}"
