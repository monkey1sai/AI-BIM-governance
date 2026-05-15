FROM python:3.11-slim

ARG SERVICE_DIR
WORKDIR /workspace/${SERVICE_DIR}

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY ${SERVICE_DIR}/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY ${SERVICE_DIR}/ /workspace/${SERVICE_DIR}/

EXPOSE 8000
