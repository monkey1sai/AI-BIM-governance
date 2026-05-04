#!/usr/bin/env bash
# 一鍵啟動 5 個服務 (Linux/macOS)。
# 注意：bim-streaming-server (Omniverse Kit GPU runtime) 主要在 Windows 開發，
# 本 script 不啟動它；若需要請另行 ./repo.sh launch。
# 對應的關閉指令：scripts/stop-all.sh
# 守則參考：docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
RUN_DIR="$SCRIPT_DIR/.run"
mkdir -p "$RUN_DIR"

SKIP_VIEWER=0
SKIP_COORDINATOR=0
HEALTH_TIMEOUT=30

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-viewer)        SKIP_VIEWER=1; shift ;;
    --skip-coordinator)   SKIP_COORDINATOR=1; shift ;;
    --health-timeout)     HEALTH_TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //'
      echo ""
      echo "Usage: $0 [--skip-viewer] [--skip-coordinator] [--health-timeout SECONDS]"
      exit 0 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

# Pick python: prefer .venv, then python3, then python
if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PYTHON="$REPO_ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
else
  PYTHON="$(command -v python || true)"
  if [[ -z "$PYTHON" ]]; then
    echo "ERROR: python 找不到，請先安裝或建立 .venv" >&2
    exit 1
  fi
fi

color_cyan="\033[36m"
color_green="\033[32m"
color_yellow="\033[33m"
color_dim="\033[2m"
color_reset="\033[0m"

is_running() {
  local name="$1"
  local pidfile="$RUN_DIR/$name.pid"
  [[ -f "$pidfile" ]] || return 1
  local pid; pid="$(cat "$pidfile" 2>/dev/null || true)"
  [[ -n "$pid" ]] || { rm -f "$pidfile"; return 1; }
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  else
    rm -f "$pidfile"
    return 1
  fi
}

start_service() {
  local name="$1"
  local workdir="$2"
  local cmd="$3"
  local pidfile="$RUN_DIR/$name.pid"
  local logfile="$RUN_DIR/$name.log"

  if is_running "$name"; then
    echo -e "${color_yellow}[skip ]${color_reset} $name 已在執行 (PID file 存在)"
    return 0
  fi

  echo -e "${color_cyan}[start]${color_reset} $name ..."
  # setsid 啟一個新的 process group，stop 時 kill -PG 可一次帶走子行程
  ( cd "$workdir" && exec setsid bash -c "$cmd" ) >"$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidfile"
  echo -e "       ${color_dim}PID=$pid  log=$logfile${color_reset}"
}

wait_health() {
  local name="$1"
  local url="$2"
  local timeout="$3"
  local start_ts; start_ts="$(date +%s)"

  while :; do
    if curl -sf -o /dev/null --max-time 3 "$url"; then
      echo -e "${color_green}[ok   ]${color_reset} $name ($url)"
      return 0
    fi
    local now; now="$(date +%s)"
    if (( now - start_ts >= timeout )); then
      echo -e "${color_yellow}[warn ]${color_reset} $name 在 ${timeout}s 內未通過健康檢查 ($url)"
      return 1
    fi
    sleep 0.5
  done
}

# === 啟動 5 個服務 ===

start_service "_s3_storage" \
  "$REPO_ROOT/_s3_storage" \
  "exec '$PYTHON' -m uvicorn app.main:app --host 127.0.0.1 --port 8002"

start_service "_bim-control" \
  "$REPO_ROOT/_bim-control" \
  "exec '$PYTHON' -m uvicorn app.main:app --host 127.0.0.1 --port 8001"

start_service "_conversion-service" \
  "$REPO_ROOT/_conversion-service" \
  "exec '$PYTHON' -m uvicorn app.main:app --host 127.0.0.1 --port 8003"

if [[ $SKIP_COORDINATOR -eq 0 ]]; then
  start_service "bim-review-coordinator" \
    "$REPO_ROOT/bim-review-coordinator" \
    "exec npm run dev"
fi

if [[ $SKIP_VIEWER -eq 0 ]]; then
  start_service "web-viewer-sample" \
    "$REPO_ROOT/web-viewer-sample" \
    "exec npm run dev -- --host 127.0.0.1"
fi

echo ""
echo -e "${color_cyan}=== Health probe ===${color_reset}"
wait_health "_s3_storage           (步驟 ①)" "http://127.0.0.1:8002/health" "$HEALTH_TIMEOUT" || true
wait_health "_bim-control          (步驟 ⑤)" "http://127.0.0.1:8001/health" "$HEALTH_TIMEOUT" || true
wait_health "_conversion-service   (步驟 ②)" "http://127.0.0.1:8003/health" "$HEALTH_TIMEOUT" || true
if [[ $SKIP_COORDINATOR -eq 0 ]]; then
  wait_health "bim-review-coordinator(步驟 ③)" "http://127.0.0.1:8004/health" "$HEALTH_TIMEOUT" || true
fi
if [[ $SKIP_VIEWER -eq 0 ]]; then
  wait_health "web-viewer-sample     (步驟 ④)" "http://127.0.0.1:5173" "$HEALTH_TIMEOUT" || true
fi

echo ""
echo -e "${color_cyan}=== Demo URLs ===${color_reset}"
echo "① 雲端倉庫       http://127.0.0.1:8002"
echo "② 模型轉換       http://127.0.0.1:8003"
echo "③ 審查協調       http://127.0.0.1:8004/ui"
echo "④ 瀏覽器審查端   http://127.0.0.1:5173"
echo "⑤ 主資料庫       http://127.0.0.1:8001"
echo ""
echo -e "${color_dim}停止所有服務：scripts/stop-all.sh${color_reset}"
echo -e "${color_dim}查看 log：     tail -f scripts/.run/<service>.log${color_reset}"
echo -e "${color_dim}註：bim-streaming-server (Kit GPU runtime) 在 Linux 不由本 script 啟動${color_reset}"
