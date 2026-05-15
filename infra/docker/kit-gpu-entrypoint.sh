#!/usr/bin/env bash
set -euo pipefail

echo "[runtime] AI-BIM Kit GPU container"
echo "[runtime] KIT_INSTANCE_ID=${KIT_INSTANCE_ID:-kit_local_gpu_001}"
echo "[runtime] NVIDIA_VISIBLE_DEVICES=${NVIDIA_VISIBLE_DEVICES:-unset}"
echo "[runtime] KIT_SIGNALING_PORT=${KIT_SIGNALING_PORT:-49100}"
echo "[runtime] KIT_MEDIA_PORT=${KIT_MEDIA_PORT:-47998}"
echo "[runtime] KIT_CONTROL_PORT=${KIT_CONTROL_PORT:-49101}"

LINUX_LAUNCHER="/workspace/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh"
KIT_BINARY="/workspace/bim-streaming-server/_build/linux-x86_64/release/kit/kit"

if [ ! -x "$LINUX_LAUNCHER" ]; then
  echo "[failed_linux_kit_build] Linux Kit launcher missing from runtime image"
  echo "[failed_linux_kit_build] Expected: $LINUX_LAUNCHER"
  exit 64
fi

if [ ! -x "$KIT_BINARY" ]; then
  echo "[failed_linux_kit_build] Linux Kit executable missing from runtime image"
  echo "[failed_linux_kit_build] Expected: $KIT_BINARY"
  exit 64
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "[blocked_gpu_runtime_unavailable] nvidia-smi not found inside container"
  exit 75
fi

nvidia-smi || {
  echo "[blocked_gpu_runtime_unavailable] nvidia-smi failed inside container"
  exit 75
}

if ! ldconfig -p | grep -q "libGLX_nvidia.so.0"; then
  echo "[blocked_gpu_runtime_unavailable] NVIDIA graphics/Vulkan driver libraries not mounted in container"
  echo "[blocked_gpu_runtime_unavailable] Missing libGLX_nvidia.so.0"
  exit 75
fi

echo "[runtime] launching Linux Kit streaming app"
exec "$LINUX_LAUNCHER" --allow-root --no-window
