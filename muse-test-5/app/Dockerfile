FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH

COPY pyproject.toml uv.lock ./
# Only the headless shell: the sandbox never shows a window, and a new node pulls the image.
RUN uv sync --frozen --no-dev --no-install-project \
 && playwright install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/*

COPY muse ./muse

RUN useradd --uid 1000 --create-home muse
USER muse

# One image, three roles: the api, the sentinel (`-m muse.sentinel`) and each sandbox (`-m muse.sandbox`).
CMD ["python", "-m", "muse.api"]
