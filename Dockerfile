# ── Stage 1: Backend dependencies ─────────────────────────────
FROM mcr.microsoft.com/mirror/docker/library/python:3.11.14-slim-bookworm AS backend-build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
# Pre-install deps (cached layer) then copy source
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/src ./src
COPY backend/agents ./agents

# ── Stage 2: Frontend build ───────────────────────────────────
FROM mcr.microsoft.com/mirror/docker/library/node:20.19.5-bookworm-slim AS frontend-build

WORKDIR /app
COPY frontend ./frontend
RUN cd frontend && npm ci

ENV BACKEND_API_URL=http://127.0.0.1:8000
RUN cd frontend && npm run build

# ── Stage 3: Runtime ──────────────────────────────────────────
FROM mcr.microsoft.com/mirror/docker/library/python:3.11.14-slim-bookworm

ARG APP_VERSION="dev"
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"

# Node binary copied from frontend-build stage (no curl|bash install)
COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl supervisor \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

# Backend: virtual-env + source code + runtime assets (flat layout for Python imports)
COPY --from=backend-build /app/.venv ./.venv
COPY backend/src ./src
COPY backend/agents ./agents

# Frontend: Next.js standalone output + static assets + public files
COPY --from=frontend-build /app/frontend/.next/standalone ./frontend-standalone
COPY --from=frontend-build /app/frontend/.next/static ./frontend-standalone/frontend/.next/static
COPY --from=frontend-build /app/frontend/public ./frontend-standalone/frontend/public

# Changelog (served by /api/changelog route in the frontend)
COPY CHANGELOG.md ./CHANGELOG.md

# Supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/app.conf

# Writable directories for runtime data
RUN mkdir -p /app/output /app/tmp && chown -R appuser:appuser /app

ENV PATH="/app/.venv/bin:$PATH"
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_DATE=${BUILD_DATE}

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/api/agents || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/app.conf"]
