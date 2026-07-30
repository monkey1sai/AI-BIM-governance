FROM node:20-bookworm-slim AS build

WORKDIR /workspace/apps/kit-manager-web

COPY apps/kit-manager-web/package*.json ./
RUN npm install

COPY apps/kit-manager-web/ ./
ARG VITE_COORDINATOR_API_BASE=http://127.0.0.1:8004
ARG VITE_VIEWER_URL=http://127.0.0.1:5173
ENV VITE_COORDINATOR_API_BASE=${VITE_COORDINATOR_API_BASE}
ENV VITE_VIEWER_URL=${VITE_VIEWER_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY infra/docker/nginx-kit-manager.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/kit-manager-web/dist /usr/share/nginx/html
EXPOSE 80
