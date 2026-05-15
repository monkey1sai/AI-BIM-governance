FROM node:20-bookworm-slim

WORKDIR /workspace/web-viewer-sample

COPY web-viewer-sample/package*.json web-viewer-sample/.npmrc ./
RUN npm install

COPY web-viewer-sample/ /workspace/web-viewer-sample/

EXPOSE 5173
