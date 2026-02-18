# Shared base with system dependencies
FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Model inference server ────────────────────────────────────────────────────
FROM base AS model
COPY model_server.py .
EXPOSE 8080
CMD ["uvicorn", "model_server:app", "--host", "0.0.0.0", "--port", "8080"]

# ── WebSocket streaming backend ───────────────────────────────────────────────
FROM base AS backend
COPY main.py .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
