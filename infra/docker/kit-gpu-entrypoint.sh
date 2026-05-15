#!/usr/bin/env bash
set -euo pipefail

echo "[runtime] AI-BIM Kit GPU container"
echo "[runtime] KIT_INSTANCE_ID=${KIT_INSTANCE_ID:-kit_local_gpu_001}"
echo "[runtime] NVIDIA_VISIBLE_DEVICES=${NVIDIA_VISIBLE_DEVICES:-unset}"

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi || true
else
  echo "[blocked] nvidia-smi not found inside container"
fi

LINUX_LAUNCHER="./_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh"
ALT_LAUNCHER="./repo.sh"

if [ -x "$LINUX_LAUNCHER" ]; then
  echo "[runtime] launching Linux Kit streaming app"
  exec "$LINUX_LAUNCHER" --no-window
fi

if [ -x "$ALT_LAUNCHER" ]; then
  echo "[runtime] repo.sh exists but no release launcher was found"
  echo "[blocked] build Linux Kit streaming app before declaring GPU runtime pass"
  tail -f /dev/null
fi

echo "[blocked] No Linux Omniverse Kit launcher found in bim-streaming-server container"
echo "[blocked] Expected: $LINUX_LAUNCHER"
tail -f /dev/null
