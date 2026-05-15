FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

WORKDIR /workspace/bim-streaming-server

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

COPY bim-streaming-server/ /workspace/bim-streaming-server/
COPY infra/docker/kit-gpu-entrypoint.sh /opt/runtime/kit-gpu-entrypoint.sh
RUN chmod +x /opt/runtime/kit-gpu-entrypoint.sh

EXPOSE 49100 47998 49101

ENTRYPOINT ["/opt/runtime/kit-gpu-entrypoint.sh"]
