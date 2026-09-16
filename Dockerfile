# =============================================================================
# Agentic RAG Pipeline — Multi-Stage Production Dockerfile
# Base: python:3.11-slim | Runs as non-root user (UID 10001)
# Port: 8080 (Cloud Run standard)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: builder — Install & compile all wheels in an isolated environment
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS builder

# Build-time system dependencies for chromadb (hnswlib C++ compilation)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy only requirements first to leverage Docker layer caching:
# requirements.txt rarely changes → wheel install layer is cached on re-builds
COPY requirements.txt .

RUN pip install --upgrade pip \
    && pip wheel --no-cache-dir --no-deps --wheel-dir=/build/wheels -r requirements.txt \
    && pip install --no-cache-dir --prefix=/build/install -r requirements.txt


# -----------------------------------------------------------------------------
# Stage 2: runner — Lean production image with only the runtime artifacts
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS runner

LABEL maintainer="team@phoenix-corp.internal" \
      org.opencontainers.image.title="Agentic RAG Pipeline" \
      org.opencontainers.image.description="LangGraph Agentic RAG API with hybrid retrieval, semantic guardrails, and RBAC" \
      org.opencontainers.image.version="1.0.0"

# Minimal runtime libs only (no build toolchain in final image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Non-root security context: create appuser (UID 10001) with home directory
RUN groupadd --system --gid 10001 appgroup \
    && useradd --system --uid 10001 --gid appgroup --create-home --home-dir /home/appuser appuser

WORKDIR /app

# Copy pre-built Python packages from builder stage (avoids C compiler in runner)
COPY --from=builder /build/install /usr/local

# Copy application source code
COPY --chown=appuser:appgroup . .

# Create runtime data directories with correct ownership:
# data/sample_docs: source documents for ingestion
# data/users: per-user memory stores
# .chroma_db: ChromaDB vector store persistence
# /home/appuser/.cache & /tmp/.cache: ONNX / HuggingFace model download cache
RUN mkdir -p data/sample_docs data/users .chroma_db static/css static/js /home/appuser/.cache /tmp/.cache \
    && chown -R appuser:appgroup data .chroma_db static /home/appuser /tmp/.cache

# Drop root — run as non-privileged user
USER appuser

# Cloud Run / Render inject PORT env var; default 8080
ENV PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/appuser \
    XDG_CACHE_HOME=/home/appuser/.cache \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1

EXPOSE ${PORT}

# Liveness probe: lightweight GET /health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/health')" || exit 1

# Entrypoint: uvicorn (1 worker per container to preserve in-memory rate limiter / lock singletons
# and fit within Cloud Run's 1Gi RAM allocation without duplicating torch/model memory)
CMD uvicorn app:app \
    --host 0.0.0.0 \
    --port ${PORT} \
    --workers 1 \
    --timeout-keep-alive 30 \
    --log-level info

