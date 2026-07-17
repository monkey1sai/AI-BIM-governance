FROM node:20-bookworm-slim

WORKDIR /workspace/web-viewer-sample

COPY web-viewer-sample/package*.json web-viewer-sample/.npmrc ./
RUN npm install -g npm@^10
RUN npm config --global set engine-strict true
RUN chown -R node:node /workspace/web-viewer-sample
USER node
RUN npm install

COPY --chown=node:node web-viewer-sample/ /workspace/web-viewer-sample/
RUN node scripts/sync-design-assets.mjs

EXPOSE 5173
