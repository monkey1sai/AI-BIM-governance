FROM node:20-bookworm-slim

ARG SERVICE_DIR
WORKDIR /workspace/${SERVICE_DIR}

COPY ${SERVICE_DIR}/package*.json ./
RUN npm install

COPY ${SERVICE_DIR}/ /workspace/${SERVICE_DIR}/

EXPOSE 5173 8004
