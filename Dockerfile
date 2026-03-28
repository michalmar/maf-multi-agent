# ── Stage 1: Backend dependencies ─────────────────────────────
FROM python:3.11-slim AS backend-build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
# Pre-install deps (cached layer) then copy source
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY agents ./agents

# ── Stage 2: Frontend build ───────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /app
COPY frontend ./frontend
RUN cd frontend && npm ci

ENV BACKEND_API_URL=http://127.0.0.1:8000
RUN cd frontend && npm run build

# ── Stage 3: Runtime ──────────────────────────────────────────
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend: virtual-env + source code + runtime assets
COPY --from=backend-build /app/.venv ./.venv
COPY src ./src
COPY agents ./agents

# Frontend: Next.js standalone output + static assets + public files
COPY --from=frontend-build /app/frontend/.next/standalone ./frontend-standalone
COPY --from=frontend-build /app/frontend/.next/static ./frontend-standalone/frontend/.next/static
COPY --from=frontend-build /app/frontend/public ./frontend-standalone/frontend/public

# Supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/app.conf

COPY output ./output

ENV PATH="/app/.venv/bin:$PATH"
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/api/agents || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/app.conf"]
