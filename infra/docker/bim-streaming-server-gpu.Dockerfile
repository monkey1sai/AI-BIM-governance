FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS builder

WORKDIR /workspace/bim-streaming-server

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash build-essential ca-certificates curl git libfontconfig1 libgl1 libglib2.0-0 \
    libice6 libsm6 libx11-6 libxext6 libxrender1 python3 unzip \
    && rm -rf /var/lib/apt/lists/*

COPY bim-streaming-server/ /workspace/bim-streaming-server/
RUN find . -type f \( -name "*.sh" -o -path "./tools/packman/packman" \) -exec sed -i 's/\r$//' {} +
RUN chmod +x ./repo.sh
RUN ./repo.sh build
RUN test -x /workspace/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh || \
    (echo "failed_linux_kit_build: missing Linux Kit launcher after Docker build" && exit 1)
RUN test -x /workspace/bim-streaming-server/_build/linux-x86_64/release/kit/kit || \
    (echo "failed_linux_kit_build: missing Linux Kit executable after Docker build" && exit 1)
RUN ./repo.sh package --name ai_bim_streaming_server && \
    package_zip="$(find /workspace/bim-streaming-server -type f -name 'ai_bim_streaming_server*.zip' | head -n 1)" && \
    test -n "$package_zip" && \
    mkdir -p /workspace/bim-streaming-server-runtime/_build/linux-x86_64/release && \
    unzip -q "$package_zip" -d /workspace/bim-streaming-server-runtime/_build/linux-x86_64/release && \
    chmod +x /workspace/bim-streaming-server-runtime/_build/linux-x86_64/release/*.sh && \
    test -x /workspace/bim-streaming-server-runtime/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh && \
    test -x /workspace/bim-streaming-server-runtime/_build/linux-x86_64/release/kit/kit

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

WORKDIR /workspace/bim-streaming-server

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates libatomic1 libcurl4 libfontconfig1 libgl1 libglib2.0-0 libgomp1 \
    libice6 libsm6 libvulkan1 libx11-6 libxext6 libxrender1 libxt6 python3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /workspace/bim-streaming-server-runtime/ /workspace/bim-streaming-server/
COPY infra/docker/kit-gpu-entrypoint.sh /opt/runtime/kit-gpu-entrypoint.sh
RUN chmod +x /opt/runtime/kit-gpu-entrypoint.sh && \
    test -x /workspace/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh && \
    test -x /workspace/bim-streaming-server/_build/linux-x86_64/release/kit/kit

EXPOSE 49100 47998 49101

ENTRYPOINT ["/opt/runtime/kit-gpu-entrypoint.sh"]
