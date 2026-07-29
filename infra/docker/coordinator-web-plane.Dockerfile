FROM node:20-bookworm-slim AS console-build

WORKDIR /workspace/web-viewer-sample

COPY web-viewer-sample/package*.json web-viewer-sample/.npmrc ./
RUN npm install -g npm@^10
RUN npm config --global set engine-strict true
RUN npm install

COPY web-viewer-sample/ /workspace/web-viewer-sample/
COPY tests/contracts/structured-log/env-allowlist.json /workspace/tests/contracts/structured-log/env-allowlist.json
# EdgeConsole.tsx imports ../../../docs/plans/ai-bim-governance.css (design token authority)
COPY docs/plans/ai-bim-governance.css /workspace/docs/plans/ai-bim-governance.css
RUN npm run build:ui

FROM node:20-bookworm-slim

WORKDIR /workspace/bim-review-coordinator

COPY bim-review-coordinator/package*.json ./
RUN npm install

COPY bim-review-coordinator/ /workspace/bim-review-coordinator/
COPY --from=console-build /workspace/web-viewer-sample/dist-ui /workspace/console-dist

ENV CONSOLE_DIST_DIR=/workspace/console-dist

EXPOSE 8004
