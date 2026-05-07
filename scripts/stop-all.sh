#!/usr/bin/env bash
# 一鍵關閉服務 (Linux/macOS)。
# 對 PID 所屬的整個 process group 送 SIGTERM，給 5 秒寬限後再 SIGKILL。

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RUN_DIR="$SCRIPT_DIR/.run"

KEEP_LOGS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-logs) KEEP_LOGS=1; shift ;;
    -h|--help) echo "Usage: $0 [--keep-logs]"; exit 0 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

if [[ ! -d "$RUN_DIR" ]]; then
  echo "[stop ] 沒有 scripts/.run/ 目錄，視為未啟動"
  exit 0
fi

shopt -s nullglob
pidfiles=( "$RUN_DIR"/*.pid )
if (( ${#pidfiles[@]} == 0 )); then
  echo "[stop ] 找不到任何 PID 檔，視為未啟動"
  exit 0
fi

color_cyan="\033[36m"
color_green="\033[32m"
color_yellow="\033[33m"
color_dim="\033[2m"
color_reset="\033[0m"
expected_ports=(8001 8004 8005 5173 49100 47998)

for f in "${pidfiles[@]}"; do
  name="$(basename "$f" .pid)"
  pid="$(cat "$f" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$f"
    continue
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    echo -e "${color_dim}[skip ] $name (PID=$pid) 已不存在${color_reset}"
    rm -f "$f"
    [[ $KEEP_LOGS -eq 0 ]] && rm -f "$RUN_DIR/$name.log"
    continue
  fi

  echo -e "${color_cyan}[stop ]${color_reset} $name (PID=$pid) ..."

  # 對整個 process group 送 SIGTERM；setsid 啟動的服務 PGID == PID
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$pgid" ]]; then
    kill -TERM "-$pgid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi

  # 等 5 秒給服務優雅關閉
  for _ in 1 2 3 4 5; do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done

  # 還沒死就 SIGKILL
  if kill -0 "$pid" 2>/dev/null; then
    if [[ -n "$pgid" ]]; then
      kill -KILL "-$pgid" 2>/dev/null || true
    else
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi

  rm -f "$f"
  [[ $KEEP_LOGS -eq 0 ]] && rm -f "$RUN_DIR/$name.log"
done

echo ""
sleep 1
still_up=()
for port in "${expected_ports[@]}"; do
  if command -v ss >/dev/null 2>&1; then
    if ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; then
      still_up+=("$port")
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"$port" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
      still_up+=("$port")
    fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -an 2>/dev/null | grep -E "[.:]$port[[:space:]].*LISTEN" >/dev/null; then
      still_up+=("$port")
    fi
  fi
done

if (( ${#still_up[@]} > 0 )); then
  echo -e "${color_yellow}[warn ]${color_reset} 以下 port 仍在 listen：${still_up[*]}"
else
  echo -e "${color_green}[done ]${color_reset} 全部服務已停止"
fi
