FROM node:18-bookworm-slim

WORKDIR /workspace/web-viewer-sample

COPY web-viewer-sample/package*.json web-viewer-sample/.npmrc ./
RUN npm install -g npm@^10
RUN npm config set engine-strict true
RUN npm install

COPY web-viewer-sample/ /workspace/web-viewer-sample/

EXPOSE 5173
