# ==============================================================================
# Stage 1: Build Frontend Assets
# ==============================================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
# Values shared with the backend, imported as @shared/<name>.json (see vite.config.ts)
COPY backend/assets/shared /app/backend/assets/shared
RUN npm run build

# ==============================================================================
# Stage 2: Python Runtime with Demucs, RoFormer & FFmpeg
# ==============================================================================
FROM python:3.12-slim AS runtime

# 1 installs the optional ML extras (RoFormer separation for the Balanced/Best presets);
# 0 builds a smaller image that always separates with Demucs (Fast)
ARG INSTALL_ML_EXTRAS=1

# Model weights live under /models (a named volume in docker-compose) so they survive
# rebuilds and are downloaded at most once
ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PORT=8000 \
    KARAOKE_DATA_DIR=/app/workspace_data \
    TORCH_HOME=/models/torch \
    HF_HOME=/models/hf \
    AUDIO_SEPARATOR_MODEL_DIR=/models/audio-separator \
    ALIGNMENT_MODEL_DIR=/models/mms_fa

# System dependencies: FFmpeg (libass, rubberband) for mixing and subtitle burn-in,
# libsamplerate for audio-separator, CJK/DejaVu fonts for lyrics in other scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    git \
    build-essential \
    libsamplerate0 \
    fonts-noto-cjk \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-optimized PyTorch first to keep image lightweight (~1.5GB vs ~6GB)
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install backend dependencies (and the optional ML extras)
COPY backend/requirements.txt backend/requirements-ml.txt /app/backend/
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
        -r /app/backend/requirements.txt \
    && if [ "$INSTALL_ML_EXTRAS" = "1" ]; then \
        pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
            -r /app/backend/requirements-ml.txt; \
    fi

# Pre-cache the Demucs weights so the Fast preset works offline from the first song.
# RoFormer weights (0.6-0.9 GB per model) download on first use into the models volume,
# or ahead of time with: docker compose exec karaoke-studio python -m backend.tools.fetch_models
RUN mkdir -p /models/torch /models/hf /models/audio-separator /models/mms_fa \
    && python -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs')"

# Copy application source
COPY backend /app/backend

# Copy compiled frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose HTTP port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Launch FastAPI server
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
