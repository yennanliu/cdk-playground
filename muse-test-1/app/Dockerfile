FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/app/.venv/bin:$PATH

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project \
 && playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY muse ./muse

RUN useradd --uid 1000 --create-home muse && install -d -o muse /data
USER muse
ENV MUSE_DB=/data/muse.db

EXPOSE 8080
CMD ["python", "-m", "muse.api"]
